from __future__ import annotations

import hashlib
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import datetime
from urllib.parse import urlsplit

import pytest
from flask import Flask, Response
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from constants import HEADER_NAME_FILE_RESULT
from constants.oauth_bearer import TokenType
from controllers.openapi._errors import OpenApiErrorCode, UploadTooLarge
from controllers.openapi._transfer import FileResult, answers_file_as_transfer
from libs.oauth_bearer import AuthContext
from models import Account
from services.skill_management_service import PublishedSkillArchive, SkillManagementService
from tests.unit_tests.controllers.openapi.test_transfers import (
    _HOST,
    _LIMITS,
    TransferWorld,
    _RecordingFiles,
    _uploaded_with_json,
    as_login,
    recording_files,
    world,
)

__all__ = ["recording_files", "world"]

_SKILL_ID = "11111111-1111-4111-8111-111111111111"
_ZIP = b"PK\x05\x06" + b"\0" * 18
_ASK_FOR_TRANSFER: dict[str, str] = {HEADER_NAME_FILE_RESULT: FileResult.TRANSFER.value}
_WRAPPER_CODE = answers_file_as_transfer(lambda: None).__code__


def _attachment(content: bytes, name: str = "skill.zip") -> Response:
    return Response(
        content, mimetype="application/zip", headers={"Content-Disposition": f"attachment; filename={name}"}
    )


def _as_caller(openapi_app: Flask, account_id: uuid.UUID, headers: dict[str, str]) -> AbstractContextManager[None]:
    auth = AuthContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        subject_email=None,
        subject_issuer=None,
        account_id=account_id,
        client_id="difyctl",
        token_id=uuid.UUID(int=3),
        expires_at=None,
    )
    return as_login(openapi_app, auth, "/openapi/v1/transfers", method="POST", base_url=_HOST, headers=headers)


@pytest.fixture
def caller_id(sqlite_session: Session) -> uuid.UUID:
    return uuid.UUID(sqlite_session.scalars(select(Account.id).where(Account.email == "caller@example.com")).one())


@pytest.fixture
def export_skill(
    world: TransferWorld, config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch
) -> Callable[[dict[str, str]], TestResponse]:
    config_overrides(ENABLE_SKILL=True)

    def export_draft_archive(_service: SkillManagementService, **_kwargs: object) -> PublishedSkillArchive:
        return PublishedSkillArchive(filename="skill.zip", mime_type="application/zip", payload=_ZIP)

    monkeypatch.setattr(SkillManagementService, "export_draft_archive", export_draft_archive)
    url = f"/openapi/v1/workspaces/{world.caller.workspace_id}/skills/{_SKILL_ID}/archive"

    def export(extra: dict[str, str]) -> TestResponse:
        return world.caller.client.get(url, headers={**world.caller.headers, **extra}, base_url=_HOST, buffered=True)

    return export


@pytest.mark.parametrize("extra", [{}, {HEADER_NAME_FILE_RESULT: "inline"}], ids=["no header", "unknown value"])
def test_without_the_transfer_header_the_file_is_returned_as_before(
    export_skill: Callable[[dict[str, str]], TestResponse], extra: dict[str, str]
) -> None:
    response = export_skill(extra)

    assert response.status_code == 200
    assert response.data == _ZIP
    assert response.headers["Content-Disposition"] == "attachment; filename=skill.zip"


def test_with_the_header_the_operation_answers_a_transfer(
    world: TransferWorld, export_skill: Callable[[dict[str, str]], TestResponse]
) -> None:
    response = export_skill(_ASK_FOR_TRANSFER)
    file = response.get_json()["file"]

    assert response.status_code == 200
    assert file["name"] == "skill.zip"
    assert (file["size"], file["sha256"]) == (len(_ZIP), hashlib.sha256(_ZIP).hexdigest())
    assert urlsplit(file["download_url"]).netloc == "dify.example"
    assert file["download_before"].endswith("Z")
    assert file["expires_at"].endswith("Z")
    assert datetime.fromisoformat(file["download_before"]) < datetime.fromisoformat(file["expires_at"])
    assert world.get(file["download_url"]).data == _ZIP


def test_the_result_id_goes_straight_into_a_file_field(
    world: TransferWorld,
    openapi_app: Flask,
    caller_id: uuid.UUID,
    recording_files: _RecordingFiles,
) -> None:
    with _as_caller(openapi_app, caller_id, _ASK_FOR_TRANSFER):
        result, _status = answers_file_as_transfer(lambda: _attachment(b"pkg", "pkg.zip"))()

    response = _uploaded_with_json(world, {"file": result.file.id})

    assert response.status_code == 201
    assert recording_files.received == [("pkg.zip", b"pkg", "application/zip")]


def test_an_error_answer_passes_through_with_the_header_set(
    world: TransferWorld, openapi_app: Flask, caller_id: uuid.UUID
) -> None:
    refused = Response('{"code": "skill_not_found"}', status=404, mimetype="application/json")

    with _as_caller(openapi_app, caller_id, _ASK_FOR_TRANSFER):
        response = answers_file_as_transfer(lambda: refused)()

    assert response.status_code == 404
    assert world.blobs.files == {}


def test_close_callbacks_run_after_parking(world: TransferWorld, openapi_app: Flask, caller_id: uuid.UUID) -> None:
    blobs_at_close: list[int] = []

    def view() -> Response:
        response = _attachment(b"pkg")
        response.call_on_close(lambda: blobs_at_close.append(len(world.blobs.files)))
        return response

    with _as_caller(openapi_app, caller_id, _ASK_FOR_TRANSFER):
        answers_file_as_transfer(view)()

    assert blobs_at_close == [0]
    assert len(world.blobs.files) == 1


def test_a_file_above_the_limit_is_refused_with_the_limit(
    world: TransferWorld, openapi_app: Flask, caller_id: uuid.UUID
) -> None:
    with _as_caller(openapi_app, caller_id, _ASK_FOR_TRANSFER), pytest.raises(UploadTooLarge) as error:
        answers_file_as_transfer(lambda: _attachment(b"x" * (_LIMITS.max_bytes + 1)))()

    assert error.value.error_code == OpenApiErrorCode.UPLOAD_TOO_LARGE
    assert f"{_LIMITS.max_bytes / 1024 / 1024:g} MiB" in str(error.value.description)
    assert world.blobs.files == {}


@pytest.mark.parametrize(
    ("mcp", "transfers"),
    [(True, False), (False, True), (False, False)],
    ids=["transfers off", "mcp off, transfers on", "both off"],
)
def test_with_transfers_off_the_header_answers_503_and_the_operation_does_not_run(
    export_skill: Callable[[dict[str, str]], TestResponse],
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
    mcp: bool,
    transfers: bool,
) -> None:
    config_overrides(OPENAPI_MCP_ENABLED=mcp, FILE_TRANSFER_ENABLED=transfers)

    def must_not_run(_service: SkillManagementService, **_kwargs: object) -> PublishedSkillArchive:
        raise AssertionError("the operation must not run while file transfers are off")

    monkeypatch.setattr(SkillManagementService, "export_draft_archive", must_not_run)

    response = export_skill(_ASK_FOR_TRANSFER)

    assert (response.status_code, response.get_json()["code"]) == (503, OpenApiErrorCode.FILE_TRANSFERS_DISABLED)


def test_with_transfers_off_a_call_without_the_header_still_gets_the_file(
    export_skill: Callable[[dict[str, str]], TestResponse], config_overrides: Callable[..., None]
) -> None:
    config_overrides(FILE_TRANSFER_ENABLED=False)

    response = export_skill({})

    assert response.status_code == 200
    assert response.data == _ZIP
