from uuid import uuid4

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope
from models.enums import CreatorUserRole
from repositories.account.repository import SQLAlchemyAccountRepository
from tests.helpers.unit.model_factories import make_account, make_upload_file


@pytest.mark.parametrize("extension", ["gif", "webp"])
def test_get_owned_avatar_file_id_accepts_legacy_raster_and_uuid_aliases(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], extension: str
) -> None:
    file_id, account_id = str(uuid4()), str(uuid4())
    sqlite_session.add(
        make_upload_file(
            file_id=file_id,
            created_by=account_id,
            name=f"avatar.{extension}",
            extension=extension,
            mime_type="image/png",
        )
    )
    sqlite_session.commit()
    repository = SQLAlchemyAccountRepository(sqlite_session_factory)
    compact_file_id = file_id.replace("-", "")

    assert repository.get_owned_avatar_file_id(account_id=account_id.upper(), upload_file_id=compact_file_id) == file_id
    assert repository.get_owned_avatar_file_id(account_id=str(uuid4()), upload_file_id=file_id) is None
    assert repository.get_owned_avatar_file_id(account_id="invalid", upload_file_id=file_id) is None


@pytest.mark.parametrize(
    ("creator_role", "extension", "mime_type"),
    [
        (CreatorUserRole.END_USER, "png", "image/png"),
        (CreatorUserRole.ACCOUNT, "png", "text/plain"),
        (CreatorUserRole.ACCOUNT, "svg", "image/svg+xml"),
    ],
)
def test_get_owned_avatar_file_id_rejects_ineligible_uploads(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    creator_role: CreatorUserRole,
    extension: str,
    mime_type: str,
) -> None:
    file_id, account_id = str(uuid4()), str(uuid4())
    sqlite_session.add(
        make_upload_file(
            file_id=file_id,
            created_by=account_id,
            created_by_role=creator_role,
            name=f"avatar.{extension}",
            extension=extension,
            mime_type=mime_type,
        )
    )
    sqlite_session.commit()
    repository = SQLAlchemyAccountRepository(sqlite_session_factory)

    assert repository.get_owned_avatar_file_id(account_id=account_id, upload_file_id=file_id) is None


def test_get_current_avatar_references_preserves_input_aliases_and_omits_ineligible_uploads(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    owner = make_account(account_id=None, email="owner@example.com")
    external = make_account(account_id=None, email="external@example.com")
    unowned = make_account(account_id=None, email="unowned@example.com")
    unsafe = make_account(account_id=None, email="unsafe@example.com")
    raster = make_upload_file(created_by=owner.id, name="avatar.webp", extension="webp", mime_type="image/png")
    svg = make_upload_file(created_by=unsafe.id, name="avatar.svg", extension="svg", mime_type="image/svg+xml")
    external_url = "https://cdn.example.com/avatar.png"
    file_id = raster.id
    owner.avatar = f"urn:uuid:{file_id.upper()}"
    external.avatar = external_url
    unowned.avatar = file_id
    unsafe.avatar = svg.id
    sqlite_session.add_all([owner, external, unowned, unsafe, raster, svg])
    sqlite_session.commit()

    compact_owner_id = owner.id.replace("-", "")
    repository = SQLAlchemyAccountRepository(sqlite_session_factory)
    references = repository.get_current_avatar_references(
        account_ids=(compact_owner_id, owner.id, external.id, unowned.id, unsafe.id, "invalid")
    )

    assert references == {compact_owner_id: file_id, owner.id: file_id, external.id: external_url}


def test_get_current_avatar_references_applies_file_scope_in_two_queries(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
) -> None:
    tenant_id = str(uuid4())
    upload_tenants = (tenant_id, tenant_id, tenant_id, str(uuid4()))
    accounts = [
        make_account(account_id=None, email=f"avatar-{index}@example.com") for index in range(len(upload_tenants))
    ]
    uploads = [
        make_upload_file(
            tenant_id=upload_tenant, created_by=account.id, name="avatar.png", extension="png", mime_type="image/png"
        )
        for account, upload_tenant in zip(accounts, upload_tenants, strict=True)
    ]
    for account, upload in zip(accounts, uploads, strict=True):
        account.avatar = upload.id

    account_ids = tuple(account.id for account in accounts)
    file_ids = tuple(upload.id for upload in uploads)
    sqlite_session.add_all([*accounts, *uploads])
    sqlite_session.commit()

    scope = FileAccessScope(
        tenant_id=tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
        granted_upload_file_ids=frozenset((file_ids[0], file_ids[1], file_ids[3])),
    )
    repository = SQLAlchemyAccountRepository(sqlite_session_factory)
    query_count = 0

    def count_query(*_args: object) -> None:
        nonlocal query_count
        query_count += 1

    event.listen(sqlite_engine, "before_cursor_execute", count_query)
    try:
        with bind_file_access_scope(scope):
            references = repository.get_current_avatar_references(account_ids=account_ids)
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", count_query)

    assert references == {account_ids[0]: file_ids[0], account_ids[1]: file_ids[1]}
    assert query_count == 2
