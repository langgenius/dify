"""Tests for the AppDeploy file grant minting endpoint."""

import inspect
import os
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import jwt
import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from controllers.files.wraps import GrantedFileNotFoundError
from controllers.inner_api.app.file_grants import (
    MAX_RUN_GRANT_TTL_SECONDS,
    MAX_SESSION_GRANT_TTL_SECONDS,
    MAX_WORKFLOW_EXECUTION_SECONDS,
    RUN_GRANT_EXPIRY_GRACE_SECONDS,
    EnterpriseFileGrantApi,
    GrantAppNotFoundError,
    GrantTtlTooLongError,
    InvalidGrantRequestError,
    InvalidSubjectError,
)
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from libs.file_grant import FILE_GRANT_AUDIENCE
from models.enums import CreatorUserRole, EndUserType
from models.model import App, EndUser, UploadFile
from models.tools import ToolFile
from services import end_user_service
from services.end_user_service import EndUserService
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


def _subject_of(response: dict[str, object]) -> str:
    grant = response["grant"]
    assert isinstance(grant, str)
    return str(jwt.decode(grant, SECRET_KEY, algorithms=["HS256"], audience=FILE_GRANT_AUDIENCE)["sub"])


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
def sqlite_db(sqlite_engine: Engine) -> Iterator[None]:
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

    first_grant = first["grant"]
    second_grant = second["grant"]
    assert isinstance(first_grant, str)
    assert isinstance(second_grant, str)
    first_claims = jwt.decode(first_grant, SECRET_KEY, algorithms=["HS256"], audience=FILE_GRANT_AUDIENCE)
    second_claims = jwt.decode(second_grant, SECRET_KEY, algorithms=["HS256"], audience=FILE_GRANT_AUDIENCE)
    assert first_claims["sub"] == second_claims["sub"] == end_users[0].id
    assert first_claims["tenant_id"] == TENANT_ID
    assert first_claims["app_id"] == APP_ID
    assert first_claims["scopes"] == ["upload"]
    first_expires_at = first["expires_at"]
    second_expires_at = second["expires_at"]
    assert isinstance(first_expires_at, int)
    assert isinstance(second_expires_at, int)
    assert second_expires_at > first_expires_at


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
        _mint(app, _payload(ttl_seconds=MAX_SESSION_GRANT_TTL_SECONDS + 1))

    assert sqlite_session.scalars(select(EndUser)).all() == []


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_accepts_a_session_ttl_exactly_at_the_cap(app: Flask) -> None:
    before = int(time.time())

    response = _mint(app, _payload(ttl_seconds=MAX_SESSION_GRANT_TTL_SECONDS))

    expires_at = response["expires_at"]
    assert isinstance(expires_at, int)
    assert MAX_SESSION_GRANT_TTL_SECONDS <= expires_at - before <= MAX_SESSION_GRANT_TTL_SECONDS + 5


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_accepts_a_run_ttl_until_deadline_plus_grace(app: Flask) -> None:
    now = int(time.time())
    run_duration = MAX_RUN_GRANT_TTL_SECONDS - RUN_GRANT_EXPIRY_GRACE_SECONDS

    response = _mint(
        app,
        _payload(
            scopes=["resolve", "produce"],
            ttl_seconds=MAX_RUN_GRANT_TTL_SECONDS,
            run_deadline=now + run_duration,
        ),
    )

    expires_at = response["expires_at"]
    assert isinstance(expires_at, int)
    assert MAX_RUN_GRANT_TTL_SECONDS <= expires_at - now <= MAX_RUN_GRANT_TTL_SECONDS + 5


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_rejects_a_run_ttl_past_deadline_grace(app: Flask) -> None:
    now = int(time.time())

    with pytest.raises(GrantTtlTooLongError):
        _mint(
            app,
            _payload(
                scopes=["resolve", "produce"],
                ttl_seconds=MAX_RUN_GRANT_TTL_SECONDS + 1,
                run_deadline=now + MAX_WORKFLOW_EXECUTION_SECONDS,
            ),
        )


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_rejects_an_expired_run_deadline(app: Flask) -> None:
    with pytest.raises(InvalidGrantRequestError):
        _mint(
            app,
            _payload(scopes=["resolve", "produce"], ttl_seconds=1, run_deadline=int(time.time()) - 1),
        )


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_rejects_a_run_deadline_without_produce_scope(app: Flask) -> None:
    with pytest.raises(InvalidGrantRequestError):
        _mint(app, _payload(run_deadline=int(time.time()) + 60))


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_rejects_a_run_deadline_beyond_the_workflow_limit(app: Flask) -> None:
    with pytest.raises(InvalidGrantRequestError):
        _mint(
            app,
            _payload(
                scopes=["resolve", "produce"],
                run_deadline=int(time.time()) + MAX_WORKFLOW_EXECUTION_SECONDS + 1,
            ),
        )


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_caps_a_run_grant_at_deadline_plus_grace(app: Flask) -> None:
    now = int(time.time())
    run_deadline = now + 60

    response = _mint(
        app,
        _payload(
            scopes=["resolve", "produce"],
            ttl_seconds=1200,
            run_deadline=run_deadline,
        ),
    )

    expires_at = response["expires_at"]
    assert isinstance(expires_at, int)
    assert run_deadline + RUN_GRANT_EXPIRY_GRACE_SECONDS <= expires_at <= (
        run_deadline + RUN_GRANT_EXPIRY_GRACE_SECONDS + 1
    )


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
@pytest.mark.parametrize("ttl_seconds", [0, -1])
def test_mint_rejects_a_non_positive_ttl(app: Flask, ttl_seconds: int) -> None:
    with pytest.raises(InvalidGrantRequestError):
        _mint(app, _payload(ttl_seconds=ttl_seconds))


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
@pytest.mark.parametrize("subject", ["", "   ", "\t\n", "adp1.with\x00nul", "\x00"])
def test_mint_rejects_an_unusable_subject(app: Flask, subject: str, sqlite_session: Session) -> None:
    """A NUL would reach ``external_user_id`` verbatim and blow up on PostgreSQL."""

    with pytest.raises(InvalidSubjectError):
        _mint(app, _payload(subject=subject))

    assert sqlite_session.scalars(select(EndUser)).all() == []


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_folds_an_oversized_subject_into_one_identity(app: Flask, sqlite_session: Session) -> None:
    """``external_user_id`` truncates at 255, so ``session_id`` is what keeps them apart."""

    long_subject = "adp1." + "s" * 4000
    sibling = long_subject[:-1] + "t"

    first = _mint(app, _payload(subject=long_subject))
    again = _mint(app, _payload(subject=long_subject))
    other = _mint(app, _payload(subject=sibling))

    end_users = sqlite_session.scalars(select(EndUser).order_by(EndUser.created_at)).all()
    assert len(end_users) == 2
    assert all(len(end_user.external_user_id) == 255 for end_user in end_users)
    assert _subject_of(first) == _subject_of(again) != _subject_of(other)


@pytest.mark.usefixtures("granted_config", "sqlite_db")
def test_mint_rejects_unknown_app(app: Flask) -> None:
    with pytest.raises(GrantAppNotFoundError):
        _mint(app, _payload())


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_returns_strict_metadata_without_urls(app: Flask, sqlite_session: Session) -> None:
    owner_id = _subject_of(_mint(app, _payload()))
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
    owner_id = _subject_of(_mint(app, _payload()))
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
    other_owner = _subject_of(_mint(app, _payload(subject="adp1.other")))
    foreign_file = _persist_upload_file(sqlite_session, owner_id=other_owner)

    with pytest.raises(GrantedFileNotFoundError):
        _mint(app, _payload(file_ids=[{"id": foreign_file.id, "kind": "upload"}]))


@pytest.mark.usefixtures("granted_config", "seeded_app", "sqlite_db")
def test_mint_reports_optional_files_item_by_item(app: Flask, sqlite_session: Session) -> None:
    owner_id = _subject_of(_mint(app, _payload()))
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

    optional_files = response["optional_files"]
    assert isinstance(optional_files, list)
    present, absent = optional_files
    assert present["ok"] is True
    assert present["name"] == "report.pdf"
    assert present["url"].startswith(f"https://files.example.com/files/appdeploy/{upload_file.id}/content?token=")
    assert present["internal_url"].startswith(
        f"http://dify-api.dify.svc:5001/files/appdeploy/{upload_file.id}/content?token="
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


@pytest.mark.usefixtures("seeded_app")
def test_end_user_service_never_retypes_an_app_deploy_row(
    sqlite_engine: Engine,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Retyping would hide the row from the grant read and strand its files."""

    subject = "subject-that-also-reaches-the-service-api"
    session_id = FileGrantService.session_id_for_subject(subject)
    owner = EndUser(
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        type=EndUserType.APP_DEPLOY,
        is_anonymous=True,
        session_id=session_id,
        external_user_id=session_id,
    )
    sqlite_session.add(owner)
    sqlite_session.commit()
    owner_id = owner.id
    monkeypatch.setattr(end_user_service, "db", SimpleNamespace(engine=sqlite_engine))

    EndUserService.get_or_create_end_user_by_type(EndUserType.SERVICE_API, TENANT_ID, APP_ID, session_id)

    sqlite_session.expire_all()
    persisted_owner = sqlite_session.get(EndUser, owner_id)
    assert persisted_owner is not None
    assert persisted_owner.type == EndUserType.APP_DEPLOY


SKIPPED_DIRECTORY_NAMES = frozenset({".git", ".venv", "__pycache__", "migrations", "node_modules", "tests"})


def test_app_deploy_end_users_have_exactly_one_writer() -> None:
    """``end_users`` has no unique constraint, so a second writer would fork identities.

    ``end_user_service`` names the type only to exclude it from the legacy retype;
    the behavioural guard above is what holds that exclusion in place.
    """

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

    assert referencing_modules == {
        "services/end_user_service.py",
        "services/file_grant_service.py",
    }
