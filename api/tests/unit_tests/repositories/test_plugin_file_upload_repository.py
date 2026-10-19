from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, AccountStatus, TenantAccountJoin
from models.enums import EndUserType
from models.model import EndUser
from repositories.plugin_file_upload_repository import SQLAlchemyPluginFileUploadOwnerRepository


def _account(account_id: str) -> Account:
    account = Account(
        name=f"Account {account_id}",
        email=f"{account_id}@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = account_id
    return account


def _end_user(*, user_id: str, tenant_id: str, session_id: str) -> EndUser:
    return EndUser(
        id=user_id,
        tenant_id=tenant_id,
        type=EndUserType.SERVICE_API,
        session_id=session_id,
    )


def test_account_owner_must_belong_to_the_signed_tenant(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    member = _account("member-id")
    other = _account("other-id")
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                member,
                other,
                TenantAccountJoin(tenant_id="tenant-id", account_id=member.id),
                TenantAccountJoin(tenant_id="other-tenant-id", account_id=other.id),
            ]
        )

    repository = SQLAlchemyPluginFileUploadOwnerRepository(session_factory=sqlite_session_factory)

    assert repository.owner_exists(tenant_id="tenant-id", user_id=member.id, user_from="account") is True
    assert repository.owner_exists(tenant_id="tenant-id", user_id=other.id, user_from="account") is False


def test_end_user_owner_must_match_id_and_tenant(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    owner = _end_user(user_id="owner-id", tenant_id="tenant-id", session_id="shared-session")
    other = _end_user(user_id="other-id", tenant_id="other-tenant-id", session_id="shared-session")
    with sqlite_session_factory.begin() as session:
        session.add_all([owner, other])

    repository = SQLAlchemyPluginFileUploadOwnerRepository(session_factory=sqlite_session_factory)

    assert repository.owner_exists(tenant_id="tenant-id", user_id=owner.id, user_from=None) is True
    assert repository.owner_exists(tenant_id="tenant-id", user_id=owner.id, user_from="end-user") is True
    assert repository.owner_exists(tenant_id="tenant-id", user_id=other.id, user_from="end-user") is False
    assert repository.owner_exists(tenant_id="tenant-id", user_id="shared-session", user_from=None) is False


def test_missing_end_user_is_not_created_during_authorization(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyPluginFileUploadOwnerRepository(session_factory=sqlite_session_factory)

    assert repository.owner_exists(tenant_id="tenant-id", user_id="missing-id", user_from=None) is False

    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(EndUser)) == 0
