"""Tests for the file endpoints reached with an AppDeploy file grant."""

import time
from collections.abc import Callable
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import UUID

import httpx
import jwt
import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from controllers.common.errors import FileTooLargeError
from controllers.files.api_files import (
    GrantedFileContentApi,
    GrantedFileResolveApi,
    GrantedFileUploadApi,
    GrantedRemoteFileUploadApi,
    ProducedFileApi,
)
from controllers.files.wraps import FileGrantInvalidError, GrantedFileNotFoundError
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from libs.file_grant import FILE_CONTENT_AUDIENCE, FileGrantScope, FileKind, issue_file_grant
from models.enums import CreatorUserRole, EndUserType
from models.model import EndUser, UploadFile
from models.tools import ToolFile

CONTROLLER_MODULE = "controllers.files.api_files"
SERVICE_MODULE = "services.file_grant_service"

SECRET_KEY = "file-grant-test-secret-long-enough-for-hs256"
TENANT_ID = "11111111-1111-4111-8111-111111111111"
OTHER_TENANT_ID = "1a1a1a1a-1111-4111-8111-111111111111"
APP_ID = "22222222-2222-4222-8222-222222222222"
FILE_ID = UUID("66666666-6666-4666-8666-666666666666")


@pytest.fixture(autouse=True)
def granted_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        SECRET_KEY=SECRET_KEY,
        FILES_URL="https://files.example.com",
        INTERNAL_FILES_URL="http://dify-api.dify.svc:5001",
        FILES_ACCESS_TIMEOUT=300,
    )


@pytest.fixture
def sqlite_db(sqlite_engine: Engine):
    with (
        patch(f"{SERVICE_MODULE}.db", MagicMock(engine=sqlite_engine)),
        patch(f"{CONTROLLER_MODULE}.db", MagicMock(engine=sqlite_engine)),
    ):
        yield


@pytest.fixture
def end_user(sqlite_session: Session) -> EndUser:
    record = EndUser(
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        type=EndUserType.APP_DEPLOY,
        is_anonymous=True,
        session_id="adp2:seeded",
        external_user_id="adp1.seeded",
    )
    sqlite_session.add(record)
    sqlite_session.commit()
    return record


def _bearer(*scopes: FileGrantScope, end_user_id: str, tenant_id: str = TENANT_ID) -> dict[str, str]:
    token, _ = issue_file_grant(
        end_user_id=end_user_id,
        tenant_id=tenant_id,
        app_id=APP_ID,
        scopes=scopes,
        ttl_seconds=600,
    )
    return {"Authorization": f"Bearer {token}"}


def _content_token(*, file_id: str, kind: FileKind, expires_in: int = 300) -> str:
    return jwt.encode(
        {
            "aud": FILE_CONTENT_AUDIENCE,
            "kind": str(kind),
            "file_id": file_id,
            "nonce": "0011223344556677",
            "exp": int(time.time()) + expires_in,
        },
        SECRET_KEY,
        algorithm="HS256",
    )


def _stub_upload_file(**overrides: object) -> SimpleNamespace:
    return SimpleNamespace(
        id="77777777-7777-4777-8777-777777777777",
        name="report.pdf",
        size=2048,
        extension="pdf",
        mime_type="application/pdf",
        **overrides,
    )


def _persist_upload_file(session: Session, *, owner_id: str, tenant_id: str = TENANT_ID) -> UploadFile:
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.OPENDAL,
        key="upload_files/report.pdf",
        name="report.pdf",
        size=2048,
        extension="pdf",
        mime_type="application/pdf",
        created_by=owner_id,
        created_by_role=CreatorUserRole.END_USER,
        created_at=naive_utc_now(),
        used=False,
    )
    session.add(upload_file)
    session.commit()
    return upload_file


def _persist_tool_file(session: Session, *, owner_id: str, mimetype: str = "image/png") -> ToolFile:
    tool_file = ToolFile(
        user_id=owner_id,
        tenant_id=TENANT_ID,
        conversation_id=None,
        file_key="tools/chart.png",
        mimetype=mimetype,
        name="chart.png",
        size=64,
    )
    session.add(tool_file)
    session.commit()
    return tool_file


@pytest.mark.usefixtures("sqlite_db")
def test_upload_stores_the_file_for_the_grant_end_user(app: Flask, end_user: EndUser) -> None:
    with patch(f"{CONTROLLER_MODULE}.FileService") as file_service:
        file_service.return_value.upload_file.return_value = _stub_upload_file()
        with app.test_request_context(
            "/files/api/upload",
            method="POST",
            headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id),
            data={"file": (BytesIO(b"pdf-bytes"), "report.pdf")},
            content_type="multipart/form-data",
        ):
            body, status = GrantedFileUploadApi().post()

    assert status == 201
    assert body["id"] == "77777777-7777-4777-8777-777777777777"
    assert body["extension"] == "pdf"
    assert body["url"].startswith(
        "https://files.example.com/files/api/77777777-7777-4777-8777-777777777777/content?token="
    )
    assert file_service.return_value.upload_file.call_args.kwargs["user"].id == end_user.id


@pytest.mark.usefixtures("sqlite_db")
def test_upload_rejects_a_grant_from_another_tenant(app: Flask, end_user: EndUser) -> None:
    with app.test_request_context(
        "/files/api/upload",
        method="POST",
        headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id, tenant_id=OTHER_TENANT_ID),
        data={"file": (BytesIO(b"pdf-bytes"), "report.pdf")},
        content_type="multipart/form-data",
    ):
        with pytest.raises(GrantedFileNotFoundError):
            GrantedFileUploadApi().post()


@pytest.mark.usefixtures("sqlite_db")
def test_upload_rejects_a_body_over_the_largest_limit(
    app: Flask, end_user: EndUser, config_overrides: Callable[..., None]
) -> None:
    config_overrides(
        UPLOAD_FILE_SIZE_LIMIT=1,
        UPLOAD_IMAGE_FILE_SIZE_LIMIT=1,
        UPLOAD_AUDIO_FILE_SIZE_LIMIT=1,
        UPLOAD_VIDEO_FILE_SIZE_LIMIT=1,
    )

    with app.test_request_context(
        "/files/api/upload",
        method="POST",
        headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id),
        data={"file": (BytesIO(b"0" * (1024 * 1024 + 1)), "big.bin")},
        content_type="multipart/form-data",
    ):
        with pytest.raises(FileTooLargeError):
            GrantedFileUploadApi().post()


@pytest.mark.usefixtures("sqlite_db")
def test_remote_upload_fetches_through_the_ssrf_safe_fetcher(app: Flask, end_user: EndUser) -> None:
    url = "https://example.com/docs/report.pdf"
    response = httpx.Response(200, content=b"pdf-bytes", request=httpx.Request("GET", url))

    with (
        patch(f"{CONTROLLER_MODULE}.remote_fetcher") as fetcher,
        patch(f"{CONTROLLER_MODULE}.FileService") as file_service,
    ):
        fetcher.make_request.return_value = response
        file_service.is_file_size_within_limit.return_value = True
        file_service.return_value.upload_file.return_value = _stub_upload_file()

        with app.test_request_context(
            "/files/api/remote-upload",
            method="POST",
            headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id),
            json={"url": url},
        ):
            with patch(f"{CONTROLLER_MODULE}.files_ns") as files_ns:
                files_ns.payload = {"url": url}
                body, status = GrantedRemoteFileUploadApi().post()

    assert status == 201
    assert body["id"] == "77777777-7777-4777-8777-777777777777"
    kwargs = file_service.return_value.upload_file.call_args.kwargs
    assert kwargs["source_url"] == url
    assert kwargs["content"] == b"pdf-bytes"
    assert kwargs["user"].id == end_user.id


@pytest.mark.usefixtures("sqlite_db")
def test_remote_upload_honours_the_size_precheck(app: Flask, end_user: EndUser) -> None:
    url = "https://example.com/docs/huge.pdf"
    response = httpx.Response(200, content=b"pdf-bytes", request=httpx.Request("GET", url))

    with (
        patch(f"{CONTROLLER_MODULE}.remote_fetcher") as fetcher,
        patch(f"{CONTROLLER_MODULE}.FileService") as file_service,
    ):
        fetcher.make_request.return_value = response
        file_service.is_file_size_within_limit.return_value = False

        with app.test_request_context(
            "/files/api/remote-upload",
            method="POST",
            headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id),
            json={"url": url},
        ):
            with patch(f"{CONTROLLER_MODULE}.files_ns") as files_ns:
                files_ns.payload = {"url": url}
                with pytest.raises(FileTooLargeError):
                    GrantedRemoteFileUploadApi().post()


def test_produced_stores_a_tool_file_and_returns_both_urls(app: Flask) -> None:
    tool_file = SimpleNamespace(
        id="88888888-8888-4888-8888-888888888888",
        name="chart.png",
        size=64,
        mimetype="image/png",
    )

    with patch(f"{CONTROLLER_MODULE}.ToolFileManager") as tool_file_manager:
        tool_file_manager.return_value.create_file_by_raw.return_value = tool_file
        with app.test_request_context(
            "/files/api/produced",
            method="POST",
            headers=_bearer(FileGrantScope.PRODUCE, end_user_id="99999999-9999-4999-8999-999999999999"),
            data={"file": (BytesIO(b"0" * 16), "chart.png")},
            content_type="multipart/form-data",
        ):
            body, status = ProducedFileApi().post()

    assert status == 201
    kwargs = tool_file_manager.return_value.create_file_by_raw.call_args.kwargs
    assert kwargs["user_id"] == "99999999-9999-4999-8999-999999999999"
    assert kwargs["tenant_id"] == TENANT_ID
    assert kwargs["conversation_id"] is None
    assert body["url"].startswith(f"https://files.example.com/files/api/{tool_file.id}/content?token=")
    assert body["internal_url"].startswith(f"http://dify-api.dify.svc:5001/files/api/{tool_file.id}/content?token=")


@pytest.mark.usefixtures("sqlite_db")
def test_resolve_signs_urls_per_item_and_hides_foreign_files(
    app: Flask, end_user: EndUser, sqlite_session: Session
) -> None:
    owned = _persist_upload_file(sqlite_session, owner_id=end_user.id)
    foreign = _persist_upload_file(sqlite_session, owner_id="00000000-0000-4000-8000-000000000000")
    payload = {
        "files": [
            {"id": owned.id, "kind": "upload"},
            {"id": foreign.id, "kind": "upload"},
        ]
    }

    with app.test_request_context(
        "/files/api/resolve",
        method="POST",
        headers=_bearer(FileGrantScope.RESOLVE, end_user_id=end_user.id),
        json=payload,
    ):
        with patch(f"{CONTROLLER_MODULE}.files_ns") as files_ns:
            files_ns.payload = payload
            body = GrantedFileResolveApi().post()

    resolved, hidden = body["files"]
    assert resolved["ok"] is True
    assert resolved["kind"] == "upload"
    assert resolved["extension"] == "pdf"
    assert resolved["url"].startswith(f"https://files.example.com/files/api/{owned.id}/content?token=")
    assert resolved["internal_url"].startswith(f"http://dify-api.dify.svc:5001/files/api/{owned.id}/content?token=")
    assert hidden == {
        "id": foreign.id,
        "ok": False,
        "kind": None,
        "name": None,
        "size": None,
        "extension": None,
        "mime_type": None,
        "url": None,
        "internal_url": None,
        "error": "not_found",
    }


@pytest.fixture
def stored_bytes():
    with patch(f"{SERVICE_MODULE}.storage") as storage:
        storage.load.return_value = iter([b"file-bytes"])
        yield storage


@pytest.mark.usefixtures("sqlite_db", "stored_bytes")
@pytest.mark.parametrize(
    ("mime_type", "expected_content_type", "expects_attachment", "expects_ranges"),
    [
        ("image/png", "image/png", False, False),
        ("image/webp", "image/webp", False, False),
        ("application/pdf", "application/octet-stream", True, False),
        ("image/svg+xml", "application/octet-stream", True, False),
        ("text/html", "application/octet-stream", True, False),
        ("audio/mpeg", "application/octet-stream", True, True),
    ],
)
def test_content_disposition_follows_the_inline_whitelist(
    app: Flask,
    sqlite_session: Session,
    mime_type: str,
    expected_content_type: str,
    expects_attachment: bool,
    expects_ranges: bool,
) -> None:
    tool_file = _persist_tool_file(sqlite_session, owner_id="anyone", mimetype=mime_type)
    token = _content_token(file_id=tool_file.id, kind=FileKind.TOOL)

    with app.test_request_context(f"/files/api/{tool_file.id}/content", query_string={"token": token}):
        response = GrantedFileContentApi().get(UUID(tool_file.id))

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Content-Type"].startswith(expected_content_type)
    assert ("Content-Disposition" in response.headers) is expects_attachment
    if expects_attachment:
        assert response.headers["Content-Disposition"] == "attachment; filename*=UTF-8''chart.png"
    assert (response.headers.get("Accept-Ranges") == "bytes") is expects_ranges
    assert response.headers["Content-Length"] == "64"


@pytest.mark.usefixtures("sqlite_db", "stored_bytes")
def test_content_rejects_an_expired_token(app: Flask, sqlite_session: Session) -> None:
    tool_file = _persist_tool_file(sqlite_session, owner_id="anyone")
    token = _content_token(file_id=tool_file.id, kind=FileKind.TOOL, expires_in=-1)

    with app.test_request_context(f"/files/api/{tool_file.id}/content", query_string={"token": token}):
        with pytest.raises(FileGrantInvalidError):
            GrantedFileContentApi().get(UUID(tool_file.id))


@pytest.mark.usefixtures("sqlite_db", "stored_bytes")
def test_content_rejects_a_token_minted_for_another_file(app: Flask, sqlite_session: Session) -> None:
    tool_file = _persist_tool_file(sqlite_session, owner_id="anyone")
    token = _content_token(file_id=str(FILE_ID), kind=FileKind.TOOL)

    with app.test_request_context(f"/files/api/{tool_file.id}/content", query_string={"token": token}):
        with pytest.raises(GrantedFileNotFoundError):
            GrantedFileContentApi().get(UUID(tool_file.id))


@pytest.mark.usefixtures("sqlite_db", "stored_bytes")
def test_content_rejects_a_token_naming_the_wrong_table(app: Flask, sqlite_session: Session) -> None:
    tool_file = _persist_tool_file(sqlite_session, owner_id="anyone")
    token = _content_token(file_id=tool_file.id, kind=FileKind.UPLOAD)

    with app.test_request_context(f"/files/api/{tool_file.id}/content", query_string={"token": token}):
        with pytest.raises(GrantedFileNotFoundError):
            GrantedFileContentApi().get(UUID(tool_file.id))


@pytest.mark.usefixtures("sqlite_db", "stored_bytes")
def test_content_rejects_a_file_grant_replayed_as_a_content_token(app: Flask, sqlite_session: Session) -> None:
    tool_file = _persist_tool_file(sqlite_session, owner_id="anyone")
    grant, _ = issue_file_grant(
        end_user_id="anyone",
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        scopes=[FileGrantScope.RESOLVE],
        ttl_seconds=600,
    )

    with app.test_request_context(f"/files/api/{tool_file.id}/content", query_string={"token": grant}):
        with pytest.raises(FileGrantInvalidError):
            GrantedFileContentApi().get(UUID(tool_file.id))
