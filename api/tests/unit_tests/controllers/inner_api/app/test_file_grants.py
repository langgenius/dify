"""Tests for the AppDeploy file grant minting endpoint."""

import inspect
import os
from collections.abc import Callable
from pathlib import Path
from unittest.mock import MagicMock, patch

import jwt
import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from controllers.files.wraps import GrantedFileNotFoundError
from controllers.inner_api.app.file_grants import (
    EnterpriseFileGrantApi,
    GrantAppNotFoundError,
    GrantTtlTooLongError,
    InvalidSubjectError,
)
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from libs.file_grant import FILE_GRANT_AUDIENCE
from models.enums import CreatorUserRole, EndUserType
from models.model import App, EndUser, UploadFile
from models.tools import ToolFile
from services.file_grant_service import FileGrantService

CONTROLLER_MODULE = "controllers.inner_api.app.file_grants"
SERVICE_MODULE = "services.file_grant_service"

SECRET_KEY = "file-grant-test-secret-long-enough-for-hs256"
TENANT_ID = "11111111-1111-4111-8111-111111111111"
APP_ID = "22222222-2222-4222-8222-222222222222"
SUBJECT = "adp1.dGVzdC1zdWJqZWN0"


@pytest.fixture
def granted_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        SECRET_KEY=SECRET_KEY,
        FILES_URL="https://files.example.com",
        INTERNAL_FILES_URL="http://dify-api.dify.svc:5001",
        FILES_ACCESS_TIMEOUT=300,
    )


@pytest.fixture
def seeded_app(sqlite_session: Session) -> App:
    app_model = App(
        id=APP_ID,
        tenant_id=TENANT_ID,
        name="deployed app",
        mode="workflow",
        enable_site=True,
        enable_api=True,
    )
    sqlite_session.add(app_model)
    sqlite_session.commit()
    return app_model


def _mint(app: Flask, payload: dict[str, object]) -> dict[str, object]:
    handler = EnterpriseFileGrantApi()
    with app.test_request_context("/", method="POST", json=payload):
        with patch(f"{CONTROLLER_MODULE}.inner_api_ns") as mock_ns:
            mock_ns.payload = payload
            return inspect.unwrap(handler.post)(handler)


def _payload(**overrides: object) -> dict[str, object]:
    return {
        "tenant_id": TENANT_ID,
        "app_id": APP_ID,
        "subject": SUBJECT,
        "is_anonymous": True,
        "scopes": ["upload"],
        "ttl_seconds": 600,
    } | overrides


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


def _persist_tool_file(session: Session, *, owner_id: str, tenant_id: str = TENANT_ID) -> ToolFile:
    tool_file = ToolFile(
        user_id=owner_id,
        tenant_id=tenant_id,
        conversation_id=None,
        file_key="tools/chart.png",
        mimetype="image/png",
        name="chart.png",
        size=64,
    )
    session.add(tool_file)
    session.commit()
    return tool_file


@pytest.fixture
def sqlite_db(sqlite_engine: Engine):
    with patch(f"{SERVICE_MODULE}.db", MagicMock(engine=sqlite_engine)):
        yield


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_creates_exactly_one_end_user_and_reuses_it(app: Flask, sqlite_session: Session) -> None:
    first = _mint(app, _payload())
    second = _mint(app, _payload(ttl_seconds=900))

    end_users = list(sqlite_session.scalars(select(EndUser).where(EndUser.tenant_id == TENANT_ID)).all())
    assert len(end_users) == 1
    assert end_users[0].type == EndUserType.APP_DEPLOY
    assert end_users[0].session_id == FileGrantService.session_id_for_subject(SUBJECT)
    assert end_users[0].external_user_id == SUBJECT

    first_claims = jwt.decode(first["grant"], SECRET_KEY, algorithms=["HS256"], audience=FILE_GRANT_AUDIENCE)
    second_claims = jwt.decode(second["grant"], SECRET_KEY, algorithms=["HS256"], audience=FILE_GRANT_AUDIENCE)
    assert first_claims["sub"] == second_claims["sub"] == end_users[0].id
    assert first_claims["tenant_id"] == TENANT_ID
    assert first_claims["app_id"] == APP_ID
    assert first_claims["scopes"] == ["upload"]
    assert second["expires_at"] > first["expires_at"]


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_returns_dify_upload_limits(app: Flask, config_overrides: Callable[..., None]) -> None:
    config_overrides(
        UPLOAD_FILE_SIZE_LIMIT=15,
        UPLOAD_IMAGE_FILE_SIZE_LIMIT=10,
        UPLOAD_AUDIO_FILE_SIZE_LIMIT=50,
        UPLOAD_VIDEO_FILE_SIZE_LIMIT=100,
        WORKFLOW_FILE_UPLOAD_LIMIT=10,
        UPLOAD_FILE_BATCH_LIMIT=5,
    )

    response = _mint(app, _payload())

    assert response["limits"] == {
        "file_size_limit": 15,
        "image_file_size_limit": 10,
        "audio_file_size_limit": 50,
        "video_file_size_limit": 100,
        "workflow_file_upload_limit": 10,
        "batch_count_limit": 5,
    }


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_rejects_ttl_over_the_cap_before_touching_identity(app: Flask, sqlite_session: Session) -> None:
    with pytest.raises(GrantTtlTooLongError):
        _mint(app, _payload(ttl_seconds=7201))

    assert sqlite_session.scalars(select(EndUser)).all() == []


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_rejects_blank_subject(app: Flask) -> None:
    with pytest.raises(InvalidSubjectError):
        _mint(app, _payload(subject="   "))


@pytest.mark.usefixtures("granted_config", "sqlite_db")
def test_mint_rejects_unknown_app(app: Flask) -> None:
    with pytest.raises(GrantAppNotFoundError):
        _mint(app, _payload())


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_returns_strict_metadata_without_urls(app: Flask, sqlite_session: Session) -> None:
    owner_id = _mint(app, _payload())["grant"]
    owner_id = jwt.decode(owner_id, SECRET_KEY, algorithms=["HS256"], audience=FILE_GRANT_AUDIENCE)["sub"]
    upload_file = _persist_upload_file(sqlite_session, owner_id=owner_id)
    tool_file = _persist_tool_file(sqlite_session, owner_id=owner_id)

    response = _mint(
        app,
        _payload(file_ids=[{"id": upload_file.id, "kind": "upload"}, {"id": tool_file.id, "kind": "tool"}]),
    )

    assert response["files"] == [
        {
            "id": upload_file.id,
            "kind": "upload",
            "name": "report.pdf",
            "size": 2048,
            "extension": "pdf",
            "mime_type": "application/pdf",
        },
        {
            "id": tool_file.id,
            "kind": "tool",
            "name": "chart.png",
            "size": 64,
            "extension": "png",
            "mime_type": "image/png",
        },
    ]


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_fails_the_whole_strict_batch_on_one_miss(app: Flask, sqlite_session: Session) -> None:
    owner_id = jwt.decode(
        _mint(app, _payload())["grant"], SECRET_KEY, algorithms=["HS256"], audience=FILE_GRANT_AUDIENCE
    )["sub"]
    upload_file = _persist_upload_file(sqlite_session, owner_id=owner_id)

    with pytest.raises(GrantedFileNotFoundError):
        _mint(
            app,
            _payload(
                file_ids=[
                    {"id": upload_file.id, "kind": "upload"},
                    {"id": "33333333-3333-4333-8333-333333333333", "kind": "upload"},
                ]
            ),
        )


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_hides_files_owned_by_another_subject(app: Flask, sqlite_session: Session) -> None:
    other_owner = jwt.decode(
        _mint(app, _payload(subject="adp1.other"))["grant"],
        SECRET_KEY,
        algorithms=["HS256"],
        audience=FILE_GRANT_AUDIENCE,
    )["sub"]
    foreign_file = _persist_upload_file(sqlite_session, owner_id=other_owner)

    with pytest.raises(GrantedFileNotFoundError):
        _mint(app, _payload(file_ids=[{"id": foreign_file.id, "kind": "upload"}]))


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_reports_optional_files_item_by_item(app: Flask, sqlite_session: Session) -> None:
    owner_id = jwt.decode(
        _mint(app, _payload())["grant"], SECRET_KEY, algorithms=["HS256"], audience=FILE_GRANT_AUDIENCE
    )["sub"]
    upload_file = _persist_upload_file(sqlite_session, owner_id=owner_id)
    missing_id = "44444444-4444-4444-8444-444444444444"

    response = _mint(
        app,
        _payload(
            optional_file_ids=[
                {"id": upload_file.id, "kind": "upload"},
                {"id": missing_id, "kind": "tool"},
            ]
        ),
    )

    present, absent = response["optional_files"]
    assert present["ok"] is True
    assert present["name"] == "report.pdf"
    assert present["url"].startswith(f"https://files.example.com/files/api/{upload_file.id}/content?token=")
    assert present["internal_url"].startswith(
        f"http://dify-api.dify.svc:5001/files/api/{upload_file.id}/content?token="
    )
    assert absent == {
        "id": missing_id,
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
    assert response["files"] == []


SKIPPED_DIRECTORY_NAMES = frozenset({".git", ".venv", "__pycache__", "migrations", "node_modules", "tests"})


def test_app_deploy_end_users_have_exactly_one_writer() -> None:
    """``end_users`` has no unique constraint, so a second writer would fork identities."""

    api_root = Path(__file__).resolve().parents[5]
    assert api_root.name == "api"

    referencing_modules: set[str] = set()
    for directory, subdirectories, filenames in os.walk(api_root):
        subdirectories[:] = [name for name in subdirectories if name not in SKIPPED_DIRECTORY_NAMES]
        for filename in filenames:
            if not filename.endswith(".py"):
                continue
            path = Path(directory) / filename
            if "EndUserType.APP_DEPLOY" in path.read_text(encoding="utf-8"):
                referencing_modules.add(path.relative_to(api_root).as_posix())

    assert referencing_modules == {"services/file_grant_service.py"}
