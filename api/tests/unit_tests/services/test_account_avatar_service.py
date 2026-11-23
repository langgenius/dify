from collections.abc import Callable
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope
from core.db.session_factory import session_factory
from graphon.file import helpers as file_helpers
from machinery.context import RequestContext
from repositories.account.repository import SQLAlchemyAccountRepository
from services.account.avatar_url import build_account_avatar_url
from services.account_avatar_service import AccountAvatarService
from services.account_errors import AvatarFileNotFoundError
from tests.helpers.unit.model_factories import make_account, make_upload_file

_ACCOUNT_ID = "11111111-1111-1111-1111-111111111111"


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id=_ACCOUNT_ID,
        active_workspace_id="workspace-1",
    )


@pytest.fixture
def accounts(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyAccountRepository:
    return SQLAlchemyAccountRepository(session_factory=sqlite_session_factory)


@pytest.fixture
def avatar_service(accounts: SQLAlchemyAccountRepository) -> AccountAvatarService:
    return AccountAvatarService(
        avatars=accounts, sign_file_url=file_helpers.get_signed_file_url, console_api_url="https://console.example.com/"
    )


def test_resolve_passes_through_external_avatar_without_querying_uploads(
    accounts: SQLAlchemyAccountRepository,
    avatar_service: AccountAvatarService,
    mocker: MockerFixture,
) -> None:
    get_owned_file_id = mocker.spy(accounts, "get_owned_avatar_file_id")

    result = avatar_service.resolve(_context(), "https://cdn.example/avatar.png")

    assert result == "https://cdn.example/avatar.png"
    get_owned_file_id.assert_not_called()


def test_resolve_still_previews_unassigned_uploads_with_a_signed_url(
    avatar_service: AccountAvatarService,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(FILES_URL="https://files.example.com", SECRET_KEY="unit-secret")
    file_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(make_upload_file(file_id=file_id, created_by=_ACCOUNT_ID, extension="gif", mime_type="image/png"))

    result = urlsplit(avatar_service.resolve(_context(), file_id.replace("-", "")))

    assert result.netloc == "files.example.com"
    assert result.path == f"/files/{file_id}/file-preview"
    query = parse_qs(result.query)
    assert set(query) == {"timestamp", "nonce", "sign"}
    assert file_helpers.verify_file_signature(
        upload_file_id=file_id,
        timestamp=query["timestamp"][0],
        nonce=query["nonce"][0],
        sign=query["sign"][0],
    )


@pytest.mark.parametrize("exists", [False, True])
def test_resolve_rejects_missing_or_unowned_file(
    avatar_service: AccountAvatarService,
    sqlite_session_factory: sessionmaker[Session],
    exists: bool,
) -> None:
    file_id = str(uuid4())
    if exists:
        with sqlite_session_factory.begin() as session:
            session.add(
                make_upload_file(file_id=file_id, created_by="another-account", extension="png", mime_type="image/png")
            )
    with pytest.raises(AvatarFileNotFoundError):
        avatar_service.resolve(_context(), file_id)


def test_resolve_current_for_accounts_formats_canonical_links_for_uuid_aliases(
    avatar_service: AccountAvatarService, sqlite_session_factory: sessionmaker[Session]
) -> None:
    file_id = str(uuid4())
    account = make_account(account_id=_ACCOUNT_ID, email="avatar-owner@example.com")
    account.avatar = f"urn:uuid:{file_id.upper()}"
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [account, make_upload_file(file_id=file_id, created_by=_ACCOUNT_ID, extension="png", mime_type="image/png")]
        )
    compact_account_id = _ACCOUNT_ID.replace("-", "")

    assert avatar_service.resolve_current_for_accounts(account_ids=(compact_account_id,)) == {
        compact_account_id: f"https://console.example.com/console/api/accounts/{_ACCOUNT_ID}/avatars/{file_id}"
    }


def test_build_account_avatar_url_canonicalizes_ids_and_supports_relative_console_urls(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(CONSOLE_API_URL="")
    file_id, account_id = str(uuid4()), str(uuid4())
    external_url = "https://cdn.example.com/person.png"

    assert build_account_avatar_url(avatar=file_id.upper(), account_id=account_id.replace("-", "")) == (
        f"/console/api/accounts/{account_id}/avatars/{file_id}"
    )
    assert build_account_avatar_url(avatar=external_url, account_id=account_id) == external_url
    assert build_account_avatar_url(avatar="invalid", account_id=account_id) is None
    assert build_account_avatar_url(avatar=file_id, account_id="invalid") is None


def test_avatar_url_builders_respect_the_active_file_scope(
    avatar_service: AccountAvatarService,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(make_upload_file(file_id=file_id, created_by=_ACCOUNT_ID, extension="png", mime_type="image/png"))
    monkeypatch.setattr(session_factory, "create_session", sqlite_session_factory)
    scope = FileAccessScope(
        tenant_id="another-tenant",
        user_id=_ACCOUNT_ID,
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        with pytest.raises(ValueError, match="Upload file .* not found"):
            avatar_service.resolve(_context(), file_id)
        with pytest.raises(ValueError, match="Upload file .* not found"):
            build_account_avatar_url(avatar=file_id, account_id=_ACCOUNT_ID)
