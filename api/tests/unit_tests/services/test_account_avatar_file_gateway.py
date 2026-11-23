from collections.abc import Callable
from datetime import UTC, datetime
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope
from core.db.session_factory import session_factory
from extensions.storage.storage_type import StorageType
from models.account import Tenant
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.account_avatar_file_gateway import (
    SQLAlchemyAccountAvatarFileGateway,
    build_account_avatar_url,
    get_signed_avatar_url,
)
from tests.helpers.unit.model_factories import make_account, make_upload_file


def _persist_upload_file(
    session: Session,
    *,
    file_id: str,
    account_id: str,
    extension: str = "png",
    mime_type: str = "image/png",
) -> None:
    tenant = Tenant(name=f"Tenant {file_id}")
    tenant.id = f"tenant-{file_id}"
    upload_file = UploadFile(
        tenant_id=tenant.id,
        storage_type=StorageType.LOCAL,
        key=f"avatar.{extension}",
        name=f"avatar.{extension}",
        size=128,
        extension=extension,
        mime_type=mime_type,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account_id,
        created_at=datetime.now(UTC).replace(tzinfo=None),
        used=False,
    )
    upload_file.id = file_id
    session.add_all([tenant, upload_file])
    session.commit()


def test_gateway_batch_resolves_current_eligible_avatars_with_uuid_aliases(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(CONSOLE_API_URL="https://console.example.com/")
    account_id, external_account_id, unowned_account_id, unsafe_account_id = (str(uuid4()) for _ in range(4))
    file_id, unsafe_file_id = str(uuid4()), str(uuid4())
    _persist_upload_file(sqlite_session, file_id=file_id, account_id=account_id)
    _persist_upload_file(
        sqlite_session,
        file_id=unsafe_file_id,
        account_id=unsafe_account_id,
        extension="svg",
        mime_type="image/svg+xml",
    )
    owner = make_account(account_id=account_id, email="owner@example.com")
    owner.avatar = f"urn:uuid:{file_id.upper()}"
    external = make_account(account_id=external_account_id, email="external@example.com")
    external.avatar = "https://cdn.example.com/avatar.png"
    unowned = make_account(account_id=unowned_account_id, email="unowned@example.com")
    unowned.avatar = file_id
    unsafe = make_account(account_id=unsafe_account_id, email="unsafe@example.com")
    unsafe.avatar = unsafe_file_id
    sqlite_session.add_all([owner, external, unowned, unsafe])
    sqlite_session.commit()
    gateway = SQLAlchemyAccountAvatarFileGateway(session_factory=sqlite_session_factory)

    compact_owner_id = account_id.replace("-", "")
    urls = gateway.get_current_avatar_urls(
        account_ids=(compact_owner_id, external_account_id, unowned_account_id, unsafe_account_id, "invalid")
    )

    assert urls == {
        compact_owner_id: f"https://console.example.com/console/api/accounts/{account_id}/avatars/{file_id}",
        external_account_id: "https://cdn.example.com/avatar.png",
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


def test_batch_gateway_uses_two_queries_with_an_active_file_scope(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(CONSOLE_API_URL="https://console.example.com")
    tenant_id = str(uuid4())
    account_ids = (str(uuid4()), str(uuid4()))
    file_ids = (str(uuid4()), str(uuid4()))
    tenant = Tenant(name="Avatar tenant")
    tenant.id = tenant_id
    accounts = [
        make_account(account_id=account_id, email=f"avatar-{index}@example.com")
        for index, account_id in enumerate(account_ids)
    ]
    for account, file_id in zip(accounts, file_ids, strict=True):
        account.avatar = file_id
    sqlite_session.add_all(
        [
            tenant,
            *accounts,
            *(
                make_upload_file(
                    file_id=file_id,
                    tenant_id=tenant_id,
                    created_by=account_id,
                    extension="png",
                    mime_type="image/png",
                )
                for account_id, file_id in zip(account_ids, file_ids, strict=True)
            ),
        ]
    )
    sqlite_session.commit()
    scope = FileAccessScope(
        tenant_id=tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
        granted_upload_file_ids=frozenset(file_ids),
    )
    gateway = SQLAlchemyAccountAvatarFileGateway(session_factory=sqlite_session_factory)
    query_listener = Mock()
    engine = sqlite_session.get_bind()
    event.listen(engine, "before_cursor_execute", query_listener)

    try:
        with bind_file_access_scope(scope):
            urls = gateway.get_current_avatar_urls(account_ids=account_ids)
    finally:
        event.remove(engine, "before_cursor_execute", query_listener)

    assert set(urls) == set(account_ids)
    assert query_listener.call_count == 2


def test_avatar_url_builders_respect_the_active_file_scope(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file_id = str(uuid4())
    account_id = str(uuid4())
    _persist_upload_file(sqlite_session, file_id=file_id, account_id=account_id)
    monkeypatch.setattr(session_factory, "create_session", sqlite_session_factory)
    scope = FileAccessScope(
        tenant_id="another-tenant",
        user_id=account_id,
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        with pytest.raises(ValueError, match="Upload file .* not found"):
            get_signed_avatar_url(upload_file_id=file_id, account_id=account_id)
        with pytest.raises(ValueError, match="Upload file .* not found"):
            build_account_avatar_url(avatar=file_id, account_id=account_id)
