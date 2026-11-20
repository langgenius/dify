from __future__ import annotations

import dataclasses
import hashlib
import io
import json
import logging
from collections.abc import Buffer, Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import count
from typing import override
from urllib.parse import parse_qs, urlsplit

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import TestResponse

from controllers.openapi import _transfer, transfers
from controllers.openapi._catalog import current_catalog
from controllers.openapi._errors import OpenApiErrorCode
from controllers.openapi.transfers import DOWNLOAD_EVENT, NEXT_STEP, UPLOAD_EVENT
from extensions.ext_application_services import ApplicationServices
from repositories.file_transfer_repository import SQLAlchemyFileTransferRepository
from services.file_transfer import FileTransferService, TransferLimits, TransferTicket
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
    service: FileTransferService
    blobs: InMemoryBlobs
    clock: SettableClock

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
    blobs = InMemoryBlobs()
    clock = SettableClock(datetime(2026, 11, 20, 10, 0))
    tokens = count()
    service = FileTransferService(
        transfers=SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory),
        blobs=blobs,
        limits=_LIMITS,
        now=clock,
        new_token=lambda: f"token-{next(tokens)}",
    )
    services = dataclasses.replace(account_application_services, file_transfers=service)
    for module in (transfers, _transfer):
        monkeypatch.setattr(module, "application_services", lambda: services)
    return TransferWorld(admitted_bearer, service, blobs, clock)


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
