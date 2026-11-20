from __future__ import annotations

import dataclasses
import hashlib
import io
import json
import logging
import uuid
import zipfile
from collections.abc import Buffer, Callable, Iterator
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

from constants.oauth_bearer import TokenType
from controllers.openapi import _files, _transfer, transfers
from controllers.openapi._catalog import current_catalog
from controllers.openapi._contract import accepts
from controllers.openapi._errors import OpenApiErrorCode, SkillPackageInvalid, UploadArchiveInvalid
from controllers.openapi._models import FileUploadPayload, SkillImportPayload
from controllers.openapi._multipart import body_from_request
from controllers.openapi._upload import UploadParts, file_fields
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject
from controllers.openapi.skills import SkillImportApi
from controllers.openapi.transfers import DOWNLOAD_EVENT, NEXT_STEP, UPLOAD_EVENT
from extensions.ext_application_services import ApplicationServices
from libs.oauth_bearer import AuthContext, reset_auth_ctx, set_auth_ctx
from machinery.context import RequestContext
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
        "sh": f'curl -fsS -F "file=@<path to the file>" "{body["upload_url"]}"',
        "powershell": f'curl.exe -fsS -F "file=@<path to the file>" "{body["upload_url"]}"',
    }
    assert body["max_bytes"] == _LIMITS.max_bytes
    assert datetime.fromisoformat(body["upload_before"]) == world.clock.current + _LIMITS.upload_link_life
    assert datetime.fromisoformat(body["expires_at"]) == world.clock.current + _LIMITS.ttl


def test_prepare_for_a_folder_returns_the_zip_then_send_commands(world: TransferWorld) -> None:
    body = world.prepare(folder=True).get_json()
    url = body["upload_url"]

    assert body["upload_commands"] == {
        "sh": f'(cd "<folder>" && zip -r -q "$OLDPWD/upload.zip" .) && curl -fsS -F "file=@upload.zip" "{url}"',
        "powershell": 'Compress-Archive -Path "<folder>\\*" -DestinationPath upload.zip -Force; '
        f'curl.exe -fsS -F "file=@upload.zip" "{url}"',
    }


def test_prepare_refuses_an_unknown_field(world: TransferWorld) -> None:
    response = world.post(_PREPARE, json={"size": 1}, headers=world.caller.headers)

    assert response.status_code == 422


def test_an_upload_is_stored_and_answers_the_next_step_without_a_login(world: TransferWorld) -> None:
    prepared = world.prepare().get_json()

    response = world.upload(prepared["upload_url"])
    body = response.get_json()

    assert response.status_code == 200
    assert {key: body[key] for key in ("id", "name", "size", "sha256", "next")} == {
        "id": prepared["id"],
        "name": "a b.txt",
        "size": 5,
        "sha256": hashlib.sha256(b"hello").hexdigest(),
        "next": NEXT_STEP,
    }
    assert world.blobs.files == {f"file_transfers/{prepared['id']}": b"hello"}


def test_an_upload_cannot_be_fetched_back(world: TransferWorld) -> None:
    prepared = world.prepare().get_json()
    world.upload(prepared["upload_url"])

    response = world.get(prepared["upload_url"])

    assert response.status_code == 404
    assert response.get_json()["code"] == OpenApiErrorCode.UPLOAD_NOT_FOUND


def test_a_parked_file_downloads_as_an_attachment(world: TransferWorld) -> None:
    response = world.get(world.link(world.park()))

    assert response.status_code == 200
    assert response.data == b"hello"
    assert response.headers["Content-Type"] == "application/octet-stream"
    assert response.headers["Content-Disposition"] == "attachment; filename*=UTF-8''a%20b.txt"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_unknown_id_wrong_token_and_wrong_direction_all_answer_the_same_404(world: TransferWorld) -> None:
    prepared = world.prepare().get_json()
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


def _parsed[M: BaseModel](app: Flask, body: dict[str, object], model: type[M]) -> M:
    with app.test_request_context(json=body):
        reset = set_auth_ctx(_OWNER_AUTH)
        try:
            return model.model_validate(body_from_request(file_fields=file_fields(model)))
        finally:
            reset_auth_ctx(reset)


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


def test_the_same_id_works_in_a_second_call(world: TransferWorld, recording_files: _RecordingFiles) -> None:
    prepared = world.prepare().get_json()
    world.upload(prepared["upload_url"], content=b"%PDF", name="r.pdf")

    answers = [_uploaded_with_json(world, {"file": prepared["id"]}) for _ in range(2)]

    assert [answer.status_code for answer in answers] == [201, 201]
    assert len(recording_files.received) == 2


def test_named_files_and_lists_resolve_at_any_depth(world: TransferWorld, openapi_app: Flask) -> None:
    doc, first, second = (_received(world, f"{index}".encode(), f"{index}.txt") for index in range(3))

    body = _parsed(openapi_app, {"files": {"doc": doc, "pages": [first, second]}}, _Named)

    named = body.files
    assert isinstance(named["doc"], FileStorage)
    assert named["doc"].read() == b"0"
    pages = named["pages"]
    assert isinstance(pages, list)
    assert [(page.filename, page.read()) for page in pages] == [("1.txt", b"1"), ("2.txt", b"2")]


def test_a_folder_transfer_becomes_a_path_mapping(world: TransferWorld, openapi_app: Flask) -> None:
    world.install(_ZIP_LIMITS)
    folder = _received(world, zip_bytes({"SKILL.md": b"a", "s/run.py": b"b"}), "up.zip", folder=True)

    body = _parsed(openapi_app, {"files": folder}, _Named)

    assert list(body.files) == ["SKILL.md", "s/run.py"]
    run = body.files["s/run.py"]
    assert isinstance(run, FileStorage)
    assert (run.filename, run.content_type, run.read()) == ("run.py", "application/octet-stream", b"b")


def test_a_string_outside_a_file_field_is_left_alone(world: TransferWorld, openapi_app: Flask) -> None:
    doc = _received(world, b"x", "x.txt")

    body = _parsed(openapi_app, {"files": {"doc": doc}, "note": doc}, _Named)

    assert body.note == doc


def test_a_folder_id_in_a_single_file_field_is_a_422(world: TransferWorld, recording_files: _RecordingFiles) -> None:
    world.install(_ZIP_LIMITS)
    prepared = world.prepare(folder=True).get_json()
    world.upload(prepared["upload_url"], content=zip_bytes({"a.txt": b"a"}), name="up.zip")

    response = _uploaded_with_json(world, {"file": prepared["id"]})

    assert response.status_code == 422
    assert recording_files.received == []


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
    assert pending["upload_before"] in not_received.get_json()["message"]
    assert archive.value.description == (
        f"files: The folder's zip cannot be unpacked: archive is over the limit of {_LIMITS.max_unpacked_files} "
        "entries."
    )


def test_the_read_transaction_is_ended_before_a_transfer_is_loaded(
    world: TransferWorld, openapi_app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    doc = _received(world, b"x", "x.txt")
    in_transaction_at_load: list[bool] = []
    load = world.service.load

    def watched_load(owner_id: str, transfer_id: str) -> LoadedTransfer:
        in_transaction_at_load.append(sqlite_session.in_transaction())
        return load(owner_id, transfer_id)

    monkeypatch.setattr(world.service, "load", watched_load)
    sqlite_session.execute(text("SELECT 1"))
    ctx = Context(AccountSubject(_OWNER_AUTH), sqlite_session, {})

    def parsed(*, ctx: Context, body: FileUploadPayload) -> FileUploadPayload:
        del ctx
        return body

    handler = accepts(body=FileUploadPayload)(parsed)

    with openapi_app.test_request_context(json={"file": doc}):
        reset = set_auth_ctx(_OWNER_AUTH)
        try:
            handler(ctx=ctx)
        finally:
            reset_auth_ctx(reset)

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


def test_junk_in_the_zip_is_dropped_by_the_existing_folder_code(
    world: TransferWorld, openapi_app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    members = {"SKILL.md": b"a", ".DS_Store": b"j", "__MACOSX/._SKILL.md": b"j", "s/Thumbs.db": b"j"}

    assert _imported_paths(world, openapi_app, members, monkeypatch) == ["SKILL.md"]


@pytest.mark.parametrize("path", ["../x.md", "/abs.md", "a\\b.md"])
def test_a_hostile_path_in_the_zip_gets_the_operations_own_path_error(
    path: str, world: TransferWorld, openapi_app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(SkillPackageInvalid) as error:
        _imported_paths(world, openapi_app, {"SKILL.md": b"a", path: b"x"}, monkeypatch)

    assert error.value.details is not None
    assert [detail.loc for detail in error.value.details] == [[path]]


def test_a_zip_of_the_folder_itself_keeps_its_extra_first_segment(
    world: TransferWorld, openapi_app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The paths reach the operation as stored; the skill service then decides what a nested root means."""
    members = {"skill/SKILL.md": b"a", "skill/run.py": b"b"}

    assert _imported_paths(world, openapi_app, members, monkeypatch) == ["skill/SKILL.md", "skill/run.py"]


_MALFORMED_ID = "not-a-uuid"


def test_a_malformed_id_on_the_byte_route_answers_like_an_unknown_one(world: TransferWorld) -> None:
    url = f"{_HOST}/openapi/v1/transfers/{_MALFORMED_ID}?token=anything"

    answers = [world.get(url), world.upload(url)]

    assert [answer.status_code for answer in answers] == [404, 404]
    assert {answer.get_json()["code"] for answer in answers} == {OpenApiErrorCode.UPLOAD_NOT_FOUND}


def test_a_malformed_id_in_a_body_field_answers_like_an_unknown_one(
    world: TransferWorld, recording_files: _RecordingFiles
) -> None:
    response = _uploaded_with_json(world, {"file": _MALFORMED_ID})

    assert (response.status_code, response.get_json()["code"]) == (400, OpenApiErrorCode.UPLOAD_NOT_FOUND)
    assert recording_files.received == []
