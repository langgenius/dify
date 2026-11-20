from __future__ import annotations

import hashlib
import uuid
from collections.abc import Callable, Generator
from contextlib import contextmanager
from datetime import datetime
from inspect import unwrap
from urllib.parse import urlsplit

import pytest
from flask import Flask, Response
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from constants import HEADER_NAME_FILE_RESULT
from constants.oauth_bearer import TokenType
from controllers.openapi._catalog import iter_handlers
from controllers.openapi._errors import OpenApiErrorCode, UploadTooLarge
from controllers.openapi._transfer import FileResult, answers_file_as_transfer
from controllers.openapi.auth.spec import Kind, spec_of
from libs.oauth_bearer import AuthContext, reset_auth_ctx, set_auth_ctx
from models import Account
from services.skill_management_service import PublishedSkillArchive, SkillManagementService
from tests.unit_tests.controllers.openapi.test_transfers import (
    _HOST,
    _LIMITS,
    TransferWorld,
    _RecordingFiles,
    _uploaded_with_json,
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


@contextmanager
def _as_caller(openapi_app: Flask, account_id: uuid.UUID, headers: dict[str, str]) -> Generator[None]:
    auth = AuthContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        subject_email=None,
        subject_issuer=None,
        account_id=account_id,
        client_id="difyctl",
        token_id=uuid.UUID(int=3),
        expires_at=None,
    )
    with openapi_app.test_request_context("/openapi/v1/transfers", method="POST", base_url=_HOST, headers=headers):
        reset = set_auth_ctx(auth)
        try:
            yield
        finally:
            reset_auth_ctx(reset)


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


def test_without_the_header_the_file_is_returned_as_before(
    export_skill: Callable[[dict[str, str]], TestResponse],
) -> None:
    response = export_skill({})

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
    assert datetime.fromisoformat(file["download_before"]) < datetime.fromisoformat(file["expires_at"])
    assert world.get(file["download_url"]).data == _ZIP


def test_an_unknown_header_value_is_ignored(export_skill: Callable[[dict[str, str]], TestResponse]) -> None:
    response = export_skill({HEADER_NAME_FILE_RESULT: "inline"})

    assert response.data == _ZIP


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


def _is_file_operation(view: object) -> bool:
    spec = spec_of(view)
    if spec is None:
        return False
    return spec.catalog.kind is Kind.FILE


def test_every_file_kind_route_is_wrapped(openapi_app: Flask) -> None:
    file_views = [view for _rule, _verb, view in iter_handlers(openapi_app) if _is_file_operation(view)]

    assert file_views
    for view in file_views:
        wrapper = unwrap(view, stop=lambda function: function.__code__ is _WRAPPER_CODE)
        assert wrapper.__code__ is _WRAPPER_CODE, view.__qualname__
