"""Tests for the file endpoints reached with an AppDeploy file grant."""

import time
from collections.abc import Callable
from datetime import datetime
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

from controllers.common.errors import (
    BlockedFileExtensionError,
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
)
from controllers.files.appdeploy_files import (
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

CONTROLLER_MODULE = "controllers.files.appdeploy_files"
SERVICE_MODULE = "services.file_grant_service"

SECRET_KEY = "file-grant-test-secret-long-enough-for-hs256"
TENANT_ID = "11111111-1111-4111-8111-111111111111"
OTHER_TENANT_ID = "1a1a1a1a-1111-4111-8111-111111111111"
APP_ID = "22222222-2222-4222-8222-222222222222"
FILE_ID = UUID("66666666-6666-4666-8666-666666666666")
UPLOAD_FILE_ID = "77777777-7777-4777-8777-777777777777"
UPLOADED_AT = datetime(2026, 8, 20, 12, 0)

# What ``POST /v1/files/upload`` answers with. The grant channel is a drop-in
# for it, so the whole key set travels together and a key dify leaves null must
# still be present and null here.
DIFY_UPLOAD_RESPONSE_KEYS = frozenset(
    {
        "id",
        "reference",
        "name",
        "size",
        "extension",
        "mime_type",
        "created_by",
        "created_at",
        "preview_url",
        "source_url",
        "original_url",
        "user_id",
        "tenant_id",
        "conversation_id",
        "file_key",
    }
)

# The subset dify's own web upload client reads, from
# ``web/app/components/base/file-uploader/utils.ts``.
WEB_CLIENT_KEYS = frozenset(
    {
        "id",
        "name",
        "size",
        "extension",
        "mime_type",
        "created_by",
        "created_at",
        "preview_url",
        "source_url",
    }
)


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
    with patch(f"{SERVICE_MODULE}.db", MagicMock(engine=sqlite_engine)):
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
    """Stand in for the ``upload_files`` row ``FileService`` hands back."""

    return SimpleNamespace(
        **{
            "id": UPLOAD_FILE_ID,
            "name": "report.pdf",
            "size": 2048,
            "extension": "pdf",
            "mime_type": "application/pdf",
            "tenant_id": TENANT_ID,
            "created_by": "99999999-9999-4999-8999-999999999999",
            "created_at": UPLOADED_AT,
            "source_url": "",
            **overrides,
        }
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
    with patch(f"{SERVICE_MODULE}.FileService") as file_service:
        file_service.return_value.upload_file.return_value = _stub_upload_file()
        with app.test_request_context(
            "/files/appdeploy/upload",
            method="POST",
            headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id),
            data={"file": (BytesIO(b"pdf-bytes"), "report.pdf")},
            content_type="multipart/form-data",
        ):
            body, status = GrantedFileUploadApi().post()

    assert status == 201
    assert body["id"] == UPLOAD_FILE_ID
    assert body["extension"] == "pdf"
    assert file_service.return_value.upload_file.call_args.kwargs["user"].id == end_user.id


@pytest.mark.usefixtures("sqlite_db")
def test_upload_answers_in_dify_s_own_upload_shape(app: Flask, end_user: EndUser) -> None:
    """A client moving off ``POST /v1/files/upload`` must not meet a second shape."""

    with patch(f"{SERVICE_MODULE}.FileService") as file_service:
        file_service.return_value.upload_file.return_value = _stub_upload_file(created_by=end_user.id)
        with app.test_request_context(
            "/files/appdeploy/upload",
            method="POST",
            headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id),
            data={"file": (BytesIO(b"pdf-bytes"), "report.pdf")},
            content_type="multipart/form-data",
        ):
            body, _ = GrantedFileUploadApi().post()

    source_url = body.pop("source_url")
    assert body == {
        "id": UPLOAD_FILE_ID,
        "reference": None,
        "name": "report.pdf",
        "size": 2048,
        "extension": "pdf",
        "mime_type": "application/pdf",
        "created_by": end_user.id,
        "created_at": int(UPLOADED_AT.timestamp()),
        "preview_url": None,
        "original_url": None,
        "user_id": None,
        "tenant_id": TENANT_ID,
        "conversation_id": None,
        "file_key": None,
    }
    assert source_url.startswith(f"https://files.example.com/files/appdeploy/{UPLOAD_FILE_ID}/content?token=")


@pytest.mark.usefixtures("sqlite_db")
def test_upload_carries_every_key_dify_s_web_client_reads(app: Flask, end_user: EndUser) -> None:
    with patch(f"{SERVICE_MODULE}.FileService") as file_service:
        file_service.return_value.upload_file.return_value = _stub_upload_file()
        with app.test_request_context(
            "/files/appdeploy/upload",
            method="POST",
            headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id),
            data={"file": (BytesIO(b"pdf-bytes"), "report.pdf")},
            content_type="multipart/form-data",
        ):
            body, _ = GrantedFileUploadApi().post()

    assert set(body) >= WEB_CLIENT_KEYS


@pytest.mark.usefixtures("sqlite_db")
def test_upload_rejects_a_grant_from_another_tenant(app: Flask, end_user: EndUser) -> None:
    with app.test_request_context(
        "/files/appdeploy/upload",
        method="POST",
        headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id, tenant_id=OTHER_TENANT_ID),
        data={"file": (BytesIO(b"pdf-bytes"), "report.pdf")},
        content_type="multipart/form-data",
    ):
        with pytest.raises(GrantedFileNotFoundError):
            GrantedFileUploadApi().post()


@pytest.mark.usefixtures("sqlite_db")
def test_upload_applies_the_shared_per_extension_size_limit(
    app: Flask, end_user: EndUser, config_overrides: Callable[..., None]
) -> None:
    config_overrides(UPLOAD_FILE_SIZE_LIMIT=1)

    with app.test_request_context(
        "/files/appdeploy/upload",
        method="POST",
        headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id),
        data={"file": (BytesIO(b"0" * (1024 * 1024 + 1)), "big.bin")},
        content_type="multipart/form-data",
    ):
        with pytest.raises(FileTooLargeError):
            GrantedFileUploadApi().post()


@pytest.mark.usefixtures("sqlite_db")
def test_upload_rejects_a_blacklisted_extension(
    app: Flask, end_user: EndUser, config_overrides: Callable[..., None]
) -> None:
    config_overrides(inner_UPLOAD_FILE_EXTENSION_BLACKLIST="exe")

    with app.test_request_context(
        "/files/appdeploy/upload",
        method="POST",
        headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id),
        data={"file": (BytesIO(b"MZ"), "payload.exe")},
        content_type="multipart/form-data",
    ):
        with pytest.raises(BlockedFileExtensionError):
            GrantedFileUploadApi().post()


@pytest.mark.usefixtures("sqlite_db")
def test_upload_rejects_a_request_carrying_no_file(app: Flask, end_user: EndUser) -> None:
    with app.test_request_context(
        "/files/appdeploy/upload",
        method="POST",
        headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id),
        data={"note": "no file here"},
        content_type="multipart/form-data",
    ):
        with pytest.raises(NoFileUploadedError):
            GrantedFileUploadApi().post()


@pytest.mark.usefixtures("sqlite_db")
def test_upload_rejects_a_batch_of_files(app: Flask, end_user: EndUser) -> None:
    with app.test_request_context(
        "/files/appdeploy/upload",
        method="POST",
        headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id),
        data={
            "file": (BytesIO(b"first"), "first.pdf"),
            "second": (BytesIO(b"second"), "second.pdf"),
        },
        content_type="multipart/form-data",
    ):
        with pytest.raises(TooManyFilesError):
            GrantedFileUploadApi().post()


@pytest.mark.usefixtures("sqlite_db")
def test_upload_rejects_a_file_without_a_name(app: Flask, end_user: EndUser) -> None:
    with app.test_request_context(
        "/files/appdeploy/upload",
        method="POST",
        headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id),
        data={"file": (BytesIO(b"nameless"), "")},
        content_type="multipart/form-data",
    ):
        with pytest.raises(FilenameNotExistsError):
            GrantedFileUploadApi().post()


@pytest.mark.usefixtures("sqlite_db")
def test_remote_upload_fetches_through_the_ssrf_safe_fetcher(app: Flask, end_user: EndUser) -> None:
    url = "https://example.com/docs/report.pdf"
    response = httpx.Response(200, content=b"pdf-bytes", request=httpx.Request("GET", url))

    with (
        patch(f"{CONTROLLER_MODULE}.remote_fetcher") as fetcher,
        patch(f"{SERVICE_MODULE}.FileService") as file_service,
    ):
        fetcher.make_request.return_value = response
        file_service.return_value.upload_file.return_value = _stub_upload_file()

        with app.test_request_context(
            "/files/appdeploy/remote-upload",
            method="POST",
            headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id),
            json={"url": url},
        ):
            with patch(f"{CONTROLLER_MODULE}.files_ns") as files_ns:
                files_ns.payload = {"url": url}
                body, status = GrantedRemoteFileUploadApi().post()

    assert status == 201
    assert body["id"] == UPLOAD_FILE_ID
    kwargs = file_service.return_value.upload_file.call_args.kwargs
    assert kwargs["source_url"] == url
    assert kwargs["content"] == b"pdf-bytes"
    assert kwargs["user"].id == end_user.id


@pytest.mark.usefixtures("sqlite_db")
def test_remote_upload_answers_in_the_same_shape_as_upload(app: Flask, end_user: EndUser) -> None:
    """Both ways in produce one ``upload_files`` row, so both answer alike."""

    url = "https://example.com/docs/report.pdf"
    response = httpx.Response(200, content=b"pdf-bytes", request=httpx.Request("GET", url))

    with (
        patch(f"{CONTROLLER_MODULE}.remote_fetcher") as fetcher,
        patch(f"{SERVICE_MODULE}.FileService") as file_service,
    ):
        fetcher.make_request.return_value = response
        file_service.return_value.upload_file.return_value = _stub_upload_file(source_url=url)

        with app.test_request_context(
            "/files/appdeploy/remote-upload",
            method="POST",
            headers=_bearer(FileGrantScope.UPLOAD, end_user_id=end_user.id),
            json={"url": url},
        ):
            with patch(f"{CONTROLLER_MODULE}.files_ns") as files_ns:
                files_ns.payload = {"url": url}
                body, _ = GrantedRemoteFileUploadApi().post()

    assert set(body) == DIFY_UPLOAD_RESPONSE_KEYS
    # The row records where the bytes came from; the response hands back the
    # signed URL that fetches them, exactly as dify's own remote upload does.
    assert body["source_url"].startswith(f"https://files.example.com/files/appdeploy/{UPLOAD_FILE_ID}/content?token=")


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
            "/files/appdeploy/remote-upload",
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

    with patch(f"{SERVICE_MODULE}.ToolFileManager") as tool_file_manager:
        tool_file_manager.return_value.create_file_by_raw.return_value = tool_file
        with app.test_request_context(
            "/files/appdeploy/produced",
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
    assert body["url"].startswith(f"https://files.example.com/files/appdeploy/{tool_file.id}/content?token=")
    assert body["internal_url"].startswith(
        f"http://dify-api.dify.svc:5001/files/appdeploy/{tool_file.id}/content?token="
    )


def test_produced_applies_the_shared_per_extension_size_limit(
    app: Flask, config_overrides: Callable[..., None]
) -> None:
    """``create_file_by_raw`` has no limit of its own, so nothing else would stop this."""

    config_overrides(UPLOAD_IMAGE_FILE_SIZE_LIMIT=1)

    with patch(f"{SERVICE_MODULE}.ToolFileManager") as tool_file_manager:
        with app.test_request_context(
            "/files/appdeploy/produced",
            method="POST",
            headers=_bearer(FileGrantScope.PRODUCE, end_user_id="99999999-9999-4999-8999-999999999999"),
            data={"file": (BytesIO(b"0" * (1024 * 1024 + 1)), "chart.png")},
            content_type="multipart/form-data",
        ):
            with pytest.raises(FileTooLargeError):
                ProducedFileApi().post()

    tool_file_manager.return_value.create_file_by_raw.assert_not_called()


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
        "/files/appdeploy/resolve",
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
    assert resolved["url"].startswith(f"https://files.example.com/files/appdeploy/{owned.id}/content?token=")
    assert resolved["internal_url"].startswith(
        f"http://dify-api.dify.svc:5001/files/appdeploy/{owned.id}/content?token="
    )
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


@pytest.mark.usefixtures("sqlite_db")
def test_resolve_answers_a_mixed_batch_item_by_item(app: Flask, end_user: EndUser, sqlite_session: Session) -> None:
    owned_upload = _persist_upload_file(sqlite_session, owner_id=end_user.id)
    owned_tool = _persist_tool_file(sqlite_session, owner_id=end_user.id)
    missing_id = "44444444-4444-4444-8444-444444444444"
    payload = {
        "files": [
            {"id": owned_upload.id, "kind": "upload"},
            {"id": missing_id, "kind": "upload"},
            # A real file, but looked up in the wrong table.
            {"id": owned_upload.id, "kind": "tool"},
            {"id": owned_tool.id, "kind": "tool"},
        ]
    }

    with app.test_request_context(
        "/files/appdeploy/resolve",
        method="POST",
        headers=_bearer(FileGrantScope.RESOLVE, end_user_id=end_user.id),
        json=payload,
    ):
        with patch(f"{CONTROLLER_MODULE}.files_ns") as files_ns:
            files_ns.payload = payload
            body = GrantedFileResolveApi().post()

    assert [(file["id"], file["ok"], file["kind"], file["error"]) for file in body["files"]] == [
        (owned_upload.id, True, "upload", None),
        (missing_id, False, None, "not_found"),
        (owned_upload.id, False, None, "not_found"),
        (owned_tool.id, True, "tool", None),
    ]


@pytest.mark.usefixtures("sqlite_db")
def test_resolve_returns_an_empty_batch_unchanged(app: Flask, end_user: EndUser) -> None:
    payload: dict[str, object] = {"files": []}

    with app.test_request_context(
        "/files/appdeploy/resolve",
        method="POST",
        headers=_bearer(FileGrantScope.RESOLVE, end_user_id=end_user.id),
        json=payload,
    ):
        with patch(f"{CONTROLLER_MODULE}.files_ns") as files_ns:
            files_ns.payload = payload
            assert GrantedFileResolveApi().post() == {"files": []}


@pytest.fixture
def stored_bytes():
    with patch(f"{SERVICE_MODULE}.storage") as storage:
        storage.load.return_value = iter([b"file-bytes"])
        yield storage


@pytest.mark.usefixtures("sqlite_db", "stored_bytes")
@pytest.mark.parametrize(
    ("mime_type", "expected_content_type", "expects_attachment"),
    [
        ("image/png", "image/png", False),
        ("image/jpeg", "image/jpeg", False),
        ("image/gif", "image/gif", False),
        ("image/webp", "image/webp", False),
        # Case and parameters are normalized before the whitelist is consulted.
        ("IMAGE/PNG; charset=binary", "image/png", False),
        ("application/pdf", "application/octet-stream", True),
        ("image/svg+xml", "application/octet-stream", True),
        ("text/html", "application/octet-stream", True),
        ("application/xhtml+xml", "application/octet-stream", True),
        ("text/javascript", "application/octet-stream", True),
        ("audio/mpeg", "application/octet-stream", True),
        ("video/mp4", "application/octet-stream", True),
    ],
)
def test_content_disposition_follows_the_inline_whitelist(
    app: Flask,
    sqlite_session: Session,
    mime_type: str,
    expected_content_type: str,
    expects_attachment: bool,
) -> None:
    tool_file = _persist_tool_file(sqlite_session, owner_id="anyone", mimetype=mime_type)
    token = _content_token(file_id=tool_file.id, kind=FileKind.TOOL)

    with app.test_request_context(f"/files/appdeploy/{tool_file.id}/content", query_string={"token": token}):
        response = GrantedFileContentApi().get(UUID(tool_file.id))

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Content-Type"].startswith(expected_content_type)
    assert ("Content-Disposition" in response.headers) is expects_attachment
    if expects_attachment:
        assert response.headers["Content-Disposition"] == "attachment; filename*=UTF-8''chart.png"
    # Range is never honoured here, so the hint must not be advertised either.
    assert "Accept-Ranges" not in response.headers
    assert response.headers["Content-Length"] == "64"


@pytest.mark.usefixtures("sqlite_db", "stored_bytes")
def test_content_downloads_a_file_with_no_recorded_mime_type(app: Flask, sqlite_session: Session) -> None:
    upload_file = _persist_upload_file(sqlite_session, owner_id="anyone")
    upload_file.mime_type = None
    sqlite_session.commit()
    token = _content_token(file_id=upload_file.id, kind=FileKind.UPLOAD)

    with app.test_request_context(f"/files/appdeploy/{upload_file.id}/content", query_string={"token": token}):
        response = GrantedFileContentApi().get(UUID(upload_file.id))

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Content-Type"].startswith("application/octet-stream")
    assert response.headers["Content-Disposition"] == "attachment; filename*=UTF-8''report.pdf"


@pytest.mark.usefixtures("sqlite_db", "stored_bytes")
def test_content_rejects_an_expired_token(app: Flask, sqlite_session: Session) -> None:
    tool_file = _persist_tool_file(sqlite_session, owner_id="anyone")
    token = _content_token(file_id=tool_file.id, kind=FileKind.TOOL, expires_in=-1)

    with app.test_request_context(f"/files/appdeploy/{tool_file.id}/content", query_string={"token": token}):
        with pytest.raises(FileGrantInvalidError):
            GrantedFileContentApi().get(UUID(tool_file.id))


@pytest.mark.usefixtures("sqlite_db", "stored_bytes")
def test_content_rejects_a_token_minted_for_another_file(app: Flask, sqlite_session: Session) -> None:
    tool_file = _persist_tool_file(sqlite_session, owner_id="anyone")
    token = _content_token(file_id=str(FILE_ID), kind=FileKind.TOOL)

    with app.test_request_context(f"/files/appdeploy/{tool_file.id}/content", query_string={"token": token}):
        with pytest.raises(GrantedFileNotFoundError):
            GrantedFileContentApi().get(UUID(tool_file.id))


@pytest.mark.usefixtures("sqlite_db", "stored_bytes")
def test_content_rejects_a_token_naming_the_wrong_table(app: Flask, sqlite_session: Session) -> None:
    tool_file = _persist_tool_file(sqlite_session, owner_id="anyone")
    token = _content_token(file_id=tool_file.id, kind=FileKind.UPLOAD)

    with app.test_request_context(f"/files/appdeploy/{tool_file.id}/content", query_string={"token": token}):
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

    with app.test_request_context(f"/files/appdeploy/{tool_file.id}/content", query_string={"token": grant}):
        with pytest.raises(FileGrantInvalidError):
            GrantedFileContentApi().get(UUID(tool_file.id))
