from __future__ import annotations

import dataclasses
import hashlib
import io
import json
import logging
import uuid
import zipfile
from collections.abc import Buffer, Callable, Generator, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from inspect import unwrap
from itertools import count
from typing import override
from urllib.parse import parse_qs, urlsplit

import pytest
from flask import Flask
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.datastructures import FileStorage
from werkzeug.test import TestResponse

from constants import BYTES_PER_MIB
from constants.oauth_bearer import TokenType
from controllers.openapi import _files, _mcp_tools, _transfer, transfers
from controllers.openapi._catalog import current_catalog
from controllers.openapi._contract import accepts
from controllers.openapi._errors import (
    OpenApiErrorCode,
    SkillPackageInvalid,
    UploadArchiveInvalid,
    UploadIsAFolder,
    UploadIsOneFile,
    UploadTooLarge,
)
from controllers.openapi._models import FileUploadPayload, SkillImportPayload
from controllers.openapi._multipart import body_from_request
from controllers.openapi._upload import UploadParts, file_fields, folder_fields
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject
from controllers.openapi.skills import SkillImportApi
from controllers.openapi.transfers import DOWNLOAD_EVENT, NEXT_STEPS, UPLOAD_EVENT
from extensions.ext_application_services import ApplicationServices
from libs.datetime_utils import to_utc_iso
from libs.oauth_bearer import AuthContext, reset_auth_ctx, set_auth_ctx
from machinery.context import RequestContext
from models.file_transfer import NAME_MAX_LENGTH
from repositories.file_transfer_repository import SQLAlchemyFileTransferRepository
from services.file_transfer import (
    FileTransferService,
    IncomingFile,
    LoadedTransfer,
    TransferLimits,
    TransferTicket,
)
from services.skill_management_service import SkillImportPayload as ServiceSkillImportPayload
from services.skill_management_service import SkillManagementService
from tests.helpers.unit.libs.zip_builder import zip_bytes
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld
from tests.unit_tests.services.file_transfer_fakes import InMemoryBlobs, SettableClock

_HOST = "https://dify.example"
_PREPARE = "/openapi/v1/transfers"
_LIMITS = TransferLimits(
    ttl=timedelta(minutes=40),
    upload_link_life=timedelta(minutes=4),
    download_link_life=timedelta(minutes=3),
    max_bytes=64,
    max_unpacked_bytes=256,
    max_unpacked_files=4,
    max_per_owner=5,
    max_active=2,
    busy_retry_after=timedelta(seconds=7),
)


@dataclass
class TransferWorld:
    caller: AdmittedWorld
    base_services: ApplicationServices
    repository: SQLAlchemyFileTransferRepository
    blobs: InMemoryBlobs
    clock: SettableClock
    new_token: Callable[[], str]
    service: FileTransferService = field(init=False)

    def __post_init__(self) -> None:
        self.install(_LIMITS)

    def install(self, limits: TransferLimits) -> None:
        """Postcondition: the routes use a service over the same rows, blobs and clock with ``limits``."""
        self.service = FileTransferService(
            transfers=self.repository, blobs=self.blobs, limits=limits, now=self.clock, new_token=self.new_token
        )

    def services(self) -> ApplicationServices:
        return dataclasses.replace(self.base_services, file_transfers=self.service)

    def prepare(self, *, folder: bool = False) -> TestResponse:
        body = {"folder": True} if folder else {}
        return self.post(_PREPARE, json=body, headers=self.caller.headers)

    def upload(self, url: str, content: bytes = b"hello", name: str = "a b.txt") -> TestResponse:
        return self.post(url, data={"file": (io.BytesIO(content), name)})

    def post(self, url: str, **kwargs: object) -> TestResponse:
        """A buffered request reads and closes its response, as a server does, so the slot is freed."""
        return self.caller.client.post(url, base_url=_HOST, buffered=True, **kwargs)

    def get(self, url: str) -> TestResponse:
        return self.caller.client.get(url, base_url=_HOST, buffered=True)

    def park(self, content: bytes = b"hello", name: str = "a b.txt") -> TransferTicket:
        return self.service.park("owner", name=name, mime_type="text/plain", content=content)

    def link(self, ticket: TransferTicket) -> str:
        return f"{_HOST}/openapi/v1/transfers/{ticket.transfer.id}?token={ticket.token}"


@pytest.fixture
def world(
    admitted_bearer: AdmittedWorld,
    account_application_services: ApplicationServices,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> TransferWorld:
    tokens = count()
    world = TransferWorld(
        caller=admitted_bearer,
        base_services=account_application_services,
        repository=SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory),
        blobs=InMemoryBlobs(),
        clock=SettableClock(datetime(2026, 11, 20, 10, 0)),
        new_token=lambda: f"token-{next(tokens)}",
    )
    for module in (transfers, _transfer):
        monkeypatch.setattr(module, "application_services", world.services)
    return world


@pytest.fixture
def every_slot_taken(world: TransferWorld) -> Iterator[None]:
    for _ in range(_LIMITS.max_active):
        assert world.service.take_slot()
    yield
    for _ in range(_LIMITS.max_active):
        world.service.free_slot()


def test_prepare_returns_an_id_a_url_on_the_callers_host_and_both_commands(world: TransferWorld) -> None:
    response = world.prepare()
    body = response.get_json()
    url = urlsplit(body["upload_url"])

    assert response.status_code == 201
    assert (url.scheme, url.netloc, url.path) == ("https", "dify.example", f"/openapi/v1/transfers/{body['id']}")
    assert list(parse_qs(url.query)) == ["token"]
    assert body["upload_commands"] == {
        "sh": f'curl -sS -F "file=@<path to the file>" "{body["upload_url"]}"',
        "powershell": f'curl.exe -sS -F "file=@<path to the file>" "{body["upload_url"]}"',
    }
    assert body["max_bytes"] == _LIMITS.max_bytes
    assert body["upload_before"] == to_utc_iso(world.clock.current + _LIMITS.upload_link_life)
    assert body["expires_at"] == to_utc_iso(world.clock.current + _LIMITS.ttl)
    assert body["upload_before"].endswith("Z")


def test_prepare_for_a_folder_streams_the_zip_into_the_send_command(world: TransferWorld) -> None:
    body = world.prepare(folder=True).get_json()
    url = body["upload_url"]

    assert body["upload_commands"] == {
        "sh": f'(cd "<folder>" && zip -r -q - .) | curl -sS -F "file=@-;filename=upload.zip" "{url}"',
        "powershell": 'Compress-Archive -Path "<folder>\\*" -DestinationPath upload.zip -Force; '
        f'curl.exe -sS -F "file=@upload.zip" "{url}"',
    }


def test_no_upload_command_hides_a_refusal_but_the_download_keeps_failing_loudly(world: TransferWorld) -> None:
    for folder in (False, True):
        commands = world.prepare(folder=folder).get_json()["upload_commands"]
        assert " -f" not in commands["sh"]
        assert " -f" not in commands["powershell"]
    assert "curl -fsSL -o" in _mcp_tools.mcp_instructions()


def test_prepare_refuses_an_unknown_field(world: TransferWorld) -> None:
    response = world.post(_PREPARE, json={"size": 1}, headers=world.caller.headers)

    assert response.status_code == 422


def test_an_upload_is_stored_and_answers_the_next_step_without_a_login(world: TransferWorld) -> None:
    prepared = world.prepare().get_json()

    response = world.upload(prepared["upload_url"])
    body = response.get_json()

    assert response.status_code == 200
    assert body["expires_at"] == to_utc_iso(world.clock.current + _LIMITS.ttl)
    assert {key: body[key] for key in ("id", "name", "size", "sha256", "next")} == {
        "id": prepared["id"],
        "name": "a b.txt",
        "size": 5,
        "sha256": hashlib.sha256(b"hello").hexdigest(),
        "next": NEXT_STEPS[False],
    }
    assert world.blobs.files == {f"file_transfers/{prepared['id']}": b"hello"}


def test_a_parked_file_downloads_as_an_attachment(world: TransferWorld) -> None:
    response = world.get(world.link(world.park()))

    assert response.status_code == 200
    assert response.data == b"hello"
    assert response.headers["Content-Type"] == "application/octet-stream"
    assert response.headers["Content-Disposition"] == "attachment; filename*=UTF-8''a%20b.txt"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Content-Length"] == str(len(b"hello"))


def test_a_download_streams_from_storage_and_holds_its_slot_until_closed(world: TransferWorld) -> None:
    response = world.caller.client.get(world.link(world.park()), base_url=_HOST)

    assert response.is_streamed
    assert response.data == b"hello"
    assert world.service.take_slot() is (_LIMITS.max_active > 1)
    response.close()
    assert world.service.take_slot() is True


def test_unknown_id_wrong_token_and_wrong_direction_all_answer_the_same_404(world: TransferWorld) -> None:
    prepared = world.prepare().get_json()
    world.upload(prepared["upload_url"])
    parked = world.park()
    wrong_token = f"{_HOST}/openapi/v1/transfers/{parked.transfer.id}?token=nope"
    unknown = f"{_HOST}/openapi/v1/transfers/00000000-0000-4000-8000-000000000000?token={parked.token}"

    answers = [
        world.get(wrong_token),
        world.get(unknown),
        world.get(f"{_HOST}/openapi/v1/transfers/{parked.transfer.id}"),
        world.upload(world.link(parked)),
        world.get(prepared["upload_url"]),
    ]

    assert [answer.status_code for answer in answers] == [404] * len(answers)
    assert {answer.get_json()["code"] for answer in answers} == {OpenApiErrorCode.UPLOAD_NOT_FOUND}


class _ExplodingStream(io.RawIOBase):
    """A request body that fails the test if anything reads it."""

    def __init__(self) -> None:
        self.read_attempts = 0

    @override
    def readable(self) -> bool:
        return True

    @override
    def seekable(self) -> bool:
        return True

    @override
    def seek(self, offset: int, whence: int = io.SEEK_SET, /) -> int:
        del offset, whence
        return 0

    @override
    def readinto(self, buffer: Buffer, /) -> int:
        del buffer
        self.read_attempts += 1
        raise AssertionError("the body was read")


def test_a_wrong_token_is_refused_before_the_body_is_read(world: TransferWorld) -> None:
    prepared = world.prepare().get_json()
    stream = _ExplodingStream()

    response = world.post(
        f"/openapi/v1/transfers/{prepared['id']}?token=nope",
        input_stream=stream,
        content_type="multipart/form-data; boundary=x",
        content_length=100,
    )

    assert response.status_code == 404
    assert stream.read_attempts == 0


def test_links_end_with_their_own_410(world: TransferWorld) -> None:
    prepared = world.prepare().get_json()
    parked = world.park()
    world.clock.advance(max(_LIMITS.upload_link_life, _LIMITS.download_link_life))

    upload = world.upload(prepared["upload_url"])
    download = world.get(world.link(parked))

    assert (upload.status_code, upload.get_json()["code"]) == (410, OpenApiErrorCode.UPLOAD_LINK_EXPIRED)
    assert upload.get_json()["message"] == "The upload link has expired. Prepare again."
    assert (download.status_code, download.get_json()["code"]) == (410, OpenApiErrorCode.DOWNLOAD_LINK_EXPIRED)


def test_different_bytes_for_a_received_upload_answer_409(world: TransferWorld) -> None:
    url = world.prepare().get_json()["upload_url"]
    world.upload(url)

    same = world.upload(url)
    different = world.upload(url, content=b"other")

    assert same.status_code == 200
    assert (different.status_code, different.get_json()["code"]) == (409, OpenApiErrorCode.UPLOAD_ALREADY_RECEIVED)


def test_a_folder_upload_that_is_not_a_zip_answers_400(world: TransferWorld) -> None:
    url = world.prepare(folder=True).get_json()["upload_url"]

    response = world.upload(url)

    assert (response.status_code, response.get_json()["code"]) == (400, OpenApiErrorCode.UPLOAD_NOT_A_ZIP)
    assert response.get_json()["message"] == "Send a zip of the folder's contents."


def test_a_folder_upload_answers_the_folder_next_step(world: TransferWorld) -> None:
    world.install(_ZIP_LIMITS)
    url = world.prepare(folder=True).get_json()["upload_url"]

    response = world.upload(url, content=zip_bytes({"a.txt": b"a"}), name="up.zip")

    assert response.get_json()["next"] == NEXT_STEPS[True]


def test_zero_parts_and_two_parts_are_refused(world: TransferWorld) -> None:
    url = world.prepare().get_json()["upload_url"]

    nothing = world.post(url, data={}, content_type="multipart/form-data")
    two = world.post(url, data={"a": (io.BytesIO(b"1"), "a.txt"), "b": (io.BytesIO(b"2"), "b.txt")})
    field = world.post(url, data={"note": "text"}, content_type="multipart/form-data")

    assert [answer.status_code for answer in (nothing, two, field)] == [400, 400, 400]
    assert world.blobs.files == {}


def test_one_request_over_the_cap_answers_413(world: TransferWorld) -> None:
    url = world.prepare().get_json()["upload_url"]

    response = world.upload(url, content=b"x" * (_LIMITS.max_bytes * 100))

    assert (response.status_code, response.get_json()["code"]) == (413, OpenApiErrorCode.UPLOAD_TOO_LARGE)
    assert world.blobs.files == {}


def test_a_file_just_over_the_limit_inside_the_cap_answers_413(world: TransferWorld) -> None:
    url = world.prepare().get_json()["upload_url"]

    response = world.upload(url, content=b"x" * (_LIMITS.max_bytes + 1))

    assert (response.status_code, response.get_json()["code"]) == (413, OpenApiErrorCode.UPLOAD_TOO_LARGE)


@pytest.mark.usefixtures("every_slot_taken")
def test_a_byte_request_beyond_the_slots_gets_429_with_the_configured_retry_after(world: TransferWorld) -> None:
    response = world.get(world.link(world.park()))

    assert (response.status_code, response.get_json()["code"]) == (429, OpenApiErrorCode.TRANSFERS_BUSY)
    assert response.headers["Retry-After"] == str(int(_LIMITS.busy_retry_after.total_seconds()))


def test_the_slot_is_freed_when_the_response_is_closed(world: TransferWorld) -> None:
    world.get(world.link(world.park()))

    taken = [world.service.take_slot() for _ in range(_LIMITS.max_active)]

    assert taken == [True] * _LIMITS.max_active


def test_upload_and_download_write_one_log_line_without_the_token(
    world: TransferWorld, caplog: pytest.LogCaptureFixture
) -> None:
    prepared = world.prepare().get_json()
    parked = world.park()
    token = parse_qs(urlsplit(prepared["upload_url"]).query)["token"][0]

    with caplog.at_level(logging.INFO, logger=transfers.__name__):
        world.upload(prepared["upload_url"])
        world.get(world.link(parked))

    records = [record for record in caplog.records if record.name == transfers.__name__]
    assert [record.__dict__["event"] for record in records] == [UPLOAD_EVENT, DOWNLOAD_EVENT]
    assert [record.__dict__["transfer_id"] for record in records] == [prepared["id"], parked.transfer.id]
    assert [record.__dict__["size"] for record in records] == [5, 5]
    for record in records:
        rendered = json.dumps(record.__dict__, default=str)
        assert token not in rendered
        assert parked.token not in rendered


def test_the_byte_route_needs_no_catalog_header_and_is_not_in_the_catalog(
    world: TransferWorld, openapi_app: Flask
) -> None:
    with openapi_app.test_request_context():
        raw, _ = current_catalog()
    ops = json.loads(raw)["ops"]

    assert world.get(world.link(world.park())).status_code == 200
    assert "prepare.upload" in ops
    assert all("{transfer_id}" not in entry["path"] for entry in ops.values() if "transfers" in entry["path"])


# Transfer ids in the file fields of a JSON body.

_OWNER = uuid.UUID(int=7)
_OWNER_AUTH = AuthContext(
    token_type=TokenType.OAUTH_ACCOUNT,
    subject_email="owner@example.com",
    subject_issuer="dify:account",
    account_id=_OWNER,
    client_id="difyctl",
    token_id=uuid.UUID(int=8),
    expires_at=None,
)
_ZIP_LIMITS = dataclasses.replace(_LIMITS, max_bytes=4096)


class _Named(BaseModel):
    files: UploadParts
    note: str = ""


@dataclass(frozen=True)
class _StoredUpload:
    id: str
    name: str
    size: int
    mime_type: str


@dataclass
class _RecordingFiles:
    received: list[tuple[str, bytes, str]] = field(default_factory=list)

    def upload_file(self, *, filename: str, content: bytes, mimetype: str, user: object) -> _StoredUpload:
        del user
        self.received.append((filename, content, mimetype))
        return _StoredUpload(id=str(uuid.UUID(int=9)), name=filename, size=len(content), mime_type=mimetype)


@dataclass(frozen=True)
class _FilesOnly:
    files: _RecordingFiles


def _received(world: TransferWorld, content: bytes, name: str, *, folder: bool = False) -> str:
    """Postcondition: the id of a transfer of ``_OWNER`` holding ``content``."""
    ticket = world.service.prepare(str(_OWNER), folder=folder)
    world.service.receive(
        ticket.transfer.id, ticket.token, IncomingFile(name=name, mime_type="text/plain", content=content)
    )
    return ticket.transfer.id


@contextmanager
def as_login(app: Flask, auth: AuthContext, *args: object, **kwargs: object) -> Generator[None]:
    """A test request context whose login is ``auth``."""
    with app.test_request_context(*args, **kwargs):
        reset = set_auth_ctx(auth)
        try:
            yield
        finally:
            reset_auth_ctx(reset)


def _parsed[M: BaseModel](app: Flask, body: dict[str, object], model: type[M]) -> M:
    with as_login(app, _OWNER_AUTH, json=body):
        return model.model_validate(
            body_from_request(file_fields=file_fields(model), folder_fields=folder_fields(model))
        )


def _uploaded_with_json(world: TransferWorld, body: dict[str, object]) -> TestResponse:
    return world.post(f"/openapi/v1/apps/{world.caller.app_id}/files", json=body, headers=world.caller.headers)


@pytest.fixture
def recording_files(monkeypatch: pytest.MonkeyPatch) -> _RecordingFiles:
    files = _RecordingFiles()
    monkeypatch.setattr(_files, "application_services", lambda: _FilesOnly(files=files))
    return files


def test_json_file_field_takes_a_file_transfer(world: TransferWorld, recording_files: _RecordingFiles) -> None:
    prepared = world.prepare().get_json()
    world.upload(prepared["upload_url"], content=b"%PDF", name="r.pdf")

    response = _uploaded_with_json(world, {"file": prepared["id"]})

    assert response.status_code == 201
    assert response.get_json()["name"] == "r.pdf"
    assert recording_files.received == [("r.pdf", b"%PDF", "application/pdf")]


def test_named_files_and_lists_resolve_at_any_depth(world: TransferWorld, openapi_app: Flask) -> None:
    doc, first, second = (_received(world, f"{index}".encode(), f"{index}.txt") for index in range(3))

    body = _parsed(openapi_app, {"files": {"doc": doc, "pages": [first, second]}, "note": doc}, _Named)

    named = body.files
    assert isinstance(named["doc"], FileStorage)
    assert named["doc"].read() == b"0"
    pages = named["pages"]
    assert isinstance(pages, list)
    assert [(page.filename, page.read()) for page in pages] == [("1.txt", b"1"), ("2.txt", b"2")]
    assert body.note == doc


def test_a_folder_transfer_becomes_a_path_mapping(world: TransferWorld, openapi_app: Flask) -> None:
    world.install(_ZIP_LIMITS)
    folder = _received(world, zip_bytes({"SKILL.md": b"a", "s/run.py": b"b"}), "up.zip", folder=True)

    body = _parsed(openapi_app, {"files": folder}, _Named)

    assert list(body.files) == ["SKILL.md", "s/run.py"]
    run = body.files["s/run.py"]
    assert isinstance(run, FileStorage)
    assert (run.filename, run.content_type, run.read()) == ("run.py", "application/octet-stream", b"b")


def test_a_folder_id_in_a_single_file_field_is_a_400_that_says_what_to_send(
    world: TransferWorld, recording_files: _RecordingFiles
) -> None:
    world.install(_ZIP_LIMITS)
    prepared = world.prepare(folder=True).get_json()
    world.upload(prepared["upload_url"], content=zip_bytes({"a.txt": b"a"}), name="up.zip")

    response = _uploaded_with_json(world, {"file": prepared["id"]})

    assert response.status_code == 400
    assert response.get_json()["code"] == OpenApiErrorCode.UPLOAD_IS_A_FOLDER
    assert response.get_json()["message"] == f"file: {UploadIsAFolder.description}"
    assert recording_files.received == []


@pytest.mark.parametrize(
    ("body", "field"),
    [({"files": {"doc": "<folder>"}}, "files"), ({"files": {"pages": ["<folder>"]}}, "files")],
    ids=["named", "listed"],
)
def test_a_folder_id_inside_a_mapping_is_one_file_and_refused(
    world: TransferWorld, openapi_app: Flask, body: dict[str, object], field: str
) -> None:
    world.install(_ZIP_LIMITS)
    folder = _received(world, zip_bytes({"a.txt": b"a"}), "up.zip", folder=True)
    sent = json.loads(json.dumps(body).replace("<folder>", folder))

    with pytest.raises(UploadIsAFolder) as refused:
        _parsed(openapi_app, sent, _Named)

    assert refused.value.description == f"{field}: {UploadIsAFolder.description}"


def test_a_single_file_id_where_a_folder_is_expected_is_a_400_that_says_what_to_send(
    world: TransferWorld, openapi_app: Flask
) -> None:
    single = _received(world, b"a", "a.txt")

    with pytest.raises(UploadIsOneFile) as refused:
        _parsed(openapi_app, {"files": single}, _Named)

    assert refused.value.code == 400
    assert refused.value.error_code == OpenApiErrorCode.UPLOAD_IS_ONE_FILE
    assert refused.value.description == f"files: {UploadIsOneFile.description}"


def test_the_fields_a_folder_may_fill_are_the_mappings_of_parts() -> None:
    assert folder_fields(_Named) == {"files"}
    assert folder_fields(SkillImportPayload) == {"files"}
    assert not folder_fields(FileUploadPayload)


def test_each_refusal_names_the_field_and_the_next_step(world: TransferWorld, openapi_app: Flask) -> None:
    unknown = _uploaded_with_json(world, {"file": "00000000-0000-4000-8000-000000000000"})
    pending = world.prepare().get_json()
    not_received = _uploaded_with_json(world, {"file": pending["id"]})
    world.install(_ZIP_LIMITS)
    crowded = _received(
        world, zip_bytes({str(index): b"" for index in range(_LIMITS.max_unpacked_files + 1)}), "up.zip", folder=True
    )

    with pytest.raises(UploadArchiveInvalid) as archive:
        _parsed(openapi_app, {"files": crowded}, _Named)

    assert (unknown.status_code, unknown.get_json()["code"]) == (400, OpenApiErrorCode.UPLOAD_NOT_FOUND)
    assert unknown.get_json()["message"].startswith("file: No upload 00000000-0000-4000-8000-000000000000 for this")
    assert unknown.get_json()["message"].endswith("Prepare and send again.")
    assert (not_received.status_code, not_received.get_json()["code"]) == (400, OpenApiErrorCode.UPLOAD_NOT_RECEIVED)
    assert "no file reached this server" in not_received.get_json()["message"]
    assert pending["upload_before"].endswith("Z")
    assert f"before {pending['upload_before']}," in not_received.get_json()["message"]
    assert archive.value.description == (
        f"files: The folder's zip cannot be unpacked: archive is over the limit of {_LIMITS.max_unpacked_files} "
        "entries."
    )


class _TwoFields(BaseModel):
    files: UploadParts
    more: UploadParts


_REQUEST_TOO_LARGE = "The files of this request together are above this server's limit of"


def _sized(world: TransferWorld, size: int) -> str:
    return _received(world, b"x" * size, f"{size}.txt")


def test_ids_in_lists_nested_dicts_and_two_fields_count_against_one_request_total(
    world: TransferWorld, openapi_app: Flask
) -> None:
    doc, page, extra = _sized(world, 30), _sized(world, 30), _sized(world, 10)

    with pytest.raises(UploadTooLarge) as refused:
        _parsed(openapi_app, {"files": {"doc": doc, "pages": [page]}, "more": {"extra": extra}}, _TwoFields)

    description = refused.value.description
    assert description is not None
    assert description.startswith(f"more: {_REQUEST_TOO_LARGE} ")
    assert f"{_LIMITS.max_bytes / BYTES_PER_MIB:g} MiB." in description


def test_ids_that_together_fill_the_request_limit_exactly_load(world: TransferWorld, openapi_app: Flask) -> None:
    doc, page = _sized(world, 30), _sized(world, _LIMITS.max_bytes - 30)

    body = _parsed(openapi_app, {"files": {"doc": doc}, "more": {"pages": [page]}}, _TwoFields)

    assert isinstance(body.files["doc"], FileStorage)
    assert isinstance(body.more["pages"], list)


def test_the_same_id_twice_counts_twice(world: TransferWorld, openapi_app: Flask) -> None:
    half_and_more = _sized(world, _LIMITS.max_bytes // 2 + 1)

    once = _parsed(openapi_app, {"files": {"pages": [half_and_more]}}, _Named)
    with pytest.raises(UploadTooLarge) as refused:
        _parsed(openapi_app, {"files": {"pages": [half_and_more, half_and_more]}}, _Named)

    assert isinstance(once.files["pages"], list)
    description = refused.value.description
    assert description is not None
    assert description.startswith(f"files: {_REQUEST_TOO_LARGE} ")


def test_a_folder_unpacking_past_what_the_request_has_left_is_refused_as_the_request(
    world: TransferWorld, openapi_app: Flask
) -> None:
    roomy = dataclasses.replace(_LIMITS, max_bytes=300)
    world.install(roomy)
    big = _sized(world, 250)
    folder = _received(world, zip_bytes({"a.txt": b"x" * 60}), "up.zip", folder=True)

    with pytest.raises(UploadTooLarge) as refused:
        _parsed(openapi_app, {"files": {"big": big}, "more": folder}, _TwoFields)

    description = refused.value.description
    assert description is not None
    assert description.startswith(f"more: {_REQUEST_TOO_LARGE} ")
    assert f"{roomy.max_bytes / BYTES_PER_MIB:g} MiB." in description


def test_the_read_transaction_is_ended_before_a_transfer_is_loaded(
    world: TransferWorld, openapi_app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    doc = _received(world, b"x", "x.txt")
    in_transaction_at_load: list[bool] = []
    load = world.service.load

    def watched_load(owner_id: str, transfer_id: str, *, may_hold: int, folder: bool) -> LoadedTransfer:
        in_transaction_at_load.append(sqlite_session.in_transaction())
        return load(owner_id, transfer_id, may_hold=may_hold, folder=folder)

    monkeypatch.setattr(world.service, "load", watched_load)
    sqlite_session.execute(text("SELECT 1"))
    ctx = Context(AccountSubject(_OWNER_AUTH), sqlite_session, {})

    def parsed(*, ctx: Context, body: FileUploadPayload) -> FileUploadPayload:
        del ctx
        return body

    handler = accepts(body=FileUploadPayload)(parsed)

    with as_login(openapi_app, _OWNER_AUTH, json={"file": doc}):
        handler(ctx=ctx)

    assert in_transaction_at_load == [False]


@pytest.mark.usefixtures("every_slot_taken")
def test_an_operation_that_reads_a_transfer_gets_429_when_no_slot_is_free(
    world: TransferWorld, recording_files: _RecordingFiles
) -> None:
    doc = world.service.prepare("anyone", folder=False).transfer.id

    response = _uploaded_with_json(world, {"file": doc})

    assert (response.status_code, response.get_json()["code"]) == (429, OpenApiErrorCode.TRANSFERS_BUSY)
    assert recording_files.received == []


# Review focus: what a folder's zip can hold reaches the operation's own rules.


def _imported_paths(
    world: TransferWorld, openapi_app: Flask, members: dict[str, bytes], monkeypatch: pytest.MonkeyPatch
) -> list[str]:
    """Postcondition: the paths in the archive ``import.skill`` hands its service for a folder transfer."""
    world.install(_ZIP_LIMITS)
    folder = _received(world, zip_bytes(members), "up.zip", folder=True)
    archives: list[bytes] = []

    def import_skill(_service: SkillManagementService, **kwargs: object) -> dict[str, object]:
        payload = kwargs["payload"]
        assert isinstance(payload, ServiceSkillImportPayload)
        archives.append(payload.content)
        return {"id": "s", "name": "n", "updated_at": 1, "files": []}

    monkeypatch.setattr(SkillManagementService, "import_skill", import_skill)
    body = _parsed(openapi_app, {"files": folder}, SkillImportPayload)
    context = RequestContext(request_id="r", trace_id=None, account_id=str(_OWNER), active_workspace_id="ws")
    with openapi_app.test_request_context():
        unwrap(SkillImportApi.post)(SkillImportApi(), context, "ws", body=body)
    with zipfile.ZipFile(io.BytesIO(archives[0])) as archive:
        return archive.namelist()


@pytest.mark.parametrize(("path", "refused"), [("../x.md", "../x.md"), ("/abs.md", "/abs.md"), ("..\\x.md", "../x.md")])
def test_a_hostile_path_in_the_zip_gets_the_operations_own_path_error(
    path: str, refused: str, world: TransferWorld, openapi_app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(SkillPackageInvalid) as error:
        _imported_paths(world, openapi_app, {"SKILL.md": b"a", path: b"x"}, monkeypatch)

    assert error.value.details is not None
    assert [detail.loc for detail in error.value.details] == [[refused]]


# Spellings of an issued id that ``uuid.UUID`` parses but the server never issues, and one that is no UUID.
_OTHER_SPELLINGS: dict[str, Callable[[str], str]] = {
    "upper case": str.upper,
    "no hyphens": lambda issued: issued.replace("-", ""),
    "braces": lambda issued: f"{{{issued}}}",
    "urn prefix": lambda issued: f"urn:uuid:{issued}",
    "not a uuid": lambda _issued: "not-a-uuid",
}
_SPELLINGS = pytest.mark.parametrize("spelling", list(_OTHER_SPELLINGS.values()), ids=list(_OTHER_SPELLINGS))


@_SPELLINGS
def test_another_spelling_of_an_id_on_the_byte_route_answers_like_an_unknown_one(
    world: TransferWorld, spelling: Callable[[str], str]
) -> None:
    ticket = world.park()
    url = f"{_HOST}/openapi/v1/transfers/{spelling(ticket.transfer.id)}?token={ticket.token}"

    answers = [world.get(url), world.upload(url)]

    assert [answer.status_code for answer in answers] == [404, 404]
    assert {answer.get_json()["code"] for answer in answers} == {OpenApiErrorCode.UPLOAD_NOT_FOUND}
    assert world.get(world.link(ticket)).status_code == 200


@_SPELLINGS
def test_another_spelling_of_an_id_in_a_body_field_answers_like_an_unknown_one(
    world: TransferWorld, recording_files: _RecordingFiles, spelling: Callable[[str], str]
) -> None:
    prepared = world.prepare().get_json()
    world.upload(prepared["upload_url"], content=b"%PDF", name="r.pdf")

    response = _uploaded_with_json(world, {"file": spelling(prepared["id"])})
    refused_received = list(recording_files.received)
    issued = _uploaded_with_json(world, {"file": prepared["id"]})

    assert (response.status_code, response.get_json()["code"]) == (400, OpenApiErrorCode.UPLOAD_NOT_FOUND)
    assert refused_received == []
    assert issued.status_code == 201


@pytest.mark.usefixtures("every_slot_taken")
def test_a_wrong_download_token_is_refused_before_a_slot_is_needed(world: TransferWorld) -> None:
    parked = world.park()

    response = world.get(f"{_HOST}/openapi/v1/transfers/{parked.transfer.id}?token=nope")

    assert (response.status_code, response.get_json()["code"]) == (404, OpenApiErrorCode.UPLOAD_NOT_FOUND)


def test_a_file_name_longer_than_its_column_answers_400(world: TransferWorld) -> None:
    url = world.prepare().get_json()["upload_url"]

    response = world.upload(url, name="x" * (NAME_MAX_LENGTH + 1))

    assert (response.status_code, response.get_json()["code"]) == (400, OpenApiErrorCode.UPLOAD_FIELD_TOO_LONG)
    assert response.get_json()["message"] == (
        f"The file name is longer than {NAME_MAX_LENGTH} characters. Send the file under a shorter one."
    )
    assert world.blobs.files == {}


# The switches: file transfers are on only while OPENAPI_MCP_ENABLED and FILE_TRANSFER_ENABLED are both true.

_OFF = pytest.mark.parametrize(
    ("mcp", "transfers"),
    [(True, False), (False, True), (False, False)],
    ids=["transfers off", "mcp off, transfers on", "both off"],
)


def _switches(config_overrides: Callable[..., None], *, mcp: bool, transfers: bool) -> None:
    config_overrides(OPENAPI_MCP_ENABLED=mcp, FILE_TRANSFER_ENABLED=transfers)


def _is_disabled(response: TestResponse) -> bool:
    return (response.status_code, response.get_json()["code"]) == (503, OpenApiErrorCode.FILE_TRANSFERS_DISABLED)


@_OFF
def test_with_transfers_off_prepare_answers_503_and_creates_nothing(
    world: TransferWorld, config_overrides: Callable[..., None], mcp: bool, transfers: bool
) -> None:
    _switches(config_overrides, mcp=mcp, transfers=transfers)

    response = world.prepare()

    assert _is_disabled(response)
    assert world.repository.owned(owner_id=world.caller.member_id) == []


@_OFF
def test_with_transfers_off_the_byte_route_answers_503_and_moves_no_bytes(
    world: TransferWorld, config_overrides: Callable[..., None], mcp: bool, transfers: bool
) -> None:
    incoming = world.service.prepare("owner", folder=False)
    parked = world.park()
    stored = dict(world.blobs.files)
    _switches(config_overrides, mcp=mcp, transfers=transfers)

    upload = world.upload(world.link(incoming))
    download = world.get(world.link(parked))

    assert _is_disabled(upload)
    assert _is_disabled(download)
    assert world.blobs.files == stored
    assert world.service.take_slot()
    world.service.free_slot()


@_OFF
def test_with_transfers_off_an_id_in_a_file_field_answers_503_and_the_operation_does_not_run(
    world: TransferWorld,
    recording_files: _RecordingFiles,
    config_overrides: Callable[..., None],
    mcp: bool,
    transfers: bool,
) -> None:
    prepared = world.prepare().get_json()
    world.upload(prepared["upload_url"], content=b"%PDF", name="r.pdf")
    _switches(config_overrides, mcp=mcp, transfers=transfers)

    response = _uploaded_with_json(world, {"file": prepared["id"]})

    assert _is_disabled(response)
    assert recording_files.received == []


def test_with_both_switches_on_transfers_work(
    world: TransferWorld, recording_files: _RecordingFiles, config_overrides: Callable[..., None]
) -> None:
    _switches(config_overrides, mcp=True, transfers=True)
    prepared = world.prepare().get_json()

    received = world.upload(prepared["upload_url"], content=b"%PDF", name="r.pdf")
    used = _uploaded_with_json(world, {"file": prepared["id"]})

    assert received.status_code == 200
    assert used.status_code == 201
    assert recording_files.received == [("r.pdf", b"%PDF", "application/pdf")]
