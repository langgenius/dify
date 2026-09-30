from datetime import datetime, timedelta
from unittest.mock import Mock

import pytest
from redis import RedisError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Unauthorized

from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from services.account.adapters import AccountIdentityGateway
from tests.unit_tests.account_domain import AccountDomain


@pytest.mark.parametrize("has_normal", [True, False])
def test_identity_resolves_normal_workspace_and_detaches_it(
    account_domain: AccountDomain, sqlite_session_factory: sessionmaker[Session], has_normal: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        account = Account(name="User", email="u@example.com")
        archived = Tenant(name="Archived", status=TenantStatus.ARCHIVE)
        session.add_all(
            [
                account,
                archived,
                TenantAccountJoin(
                    account_id=account.id, tenant_id=archived.id, role=TenantAccountRole.NORMAL, current=True
                ),
            ]
        )
        if has_normal:
            normal = Tenant(name="Normal")
            session.add_all(
                [normal, TenantAccountJoin(account_id=account.id, tenant_id=normal.id, role=TenantAccountRole.EDITOR)]
            )
        account_id = account.id
    loaded = account_domain.repository.load_identity(account_id, now=datetime(2026, 1, 1))
    if has_normal:
        assert loaded is not None
        assert loaded.current_tenant is not None
        assert loaded.current_tenant.name == "Normal"
        assert loaded.role == TenantAccountRole.EDITOR
    else:
        assert loaded is None
    with sqlite_session_factory() as session:
        current = session.scalars(select(TenantAccountJoin).where(TenantAccountJoin.current.is_(True))).all()
        assert len(current) == int(has_normal)


@pytest.mark.parametrize("redis_claim", [True, False, RedisError("offline")])
def test_activity_refresh_is_gated_but_fails_open(
    account_domain: AccountDomain, sqlite_session: Session, redis_claim: bool | RedisError
) -> None:
    now = naive_utc_now()
    account = Account(name="User", email="u@example.com")
    account.last_active_at = now - timedelta(hours=1)
    tenant = Tenant(name="Normal")
    sqlite_session.add_all(
        [
            account,
            tenant,
            TenantAccountJoin(account_id=account.id, tenant_id=tenant.id, role=TenantAccountRole.OWNER, current=True),
        ]
    )
    sqlite_session.commit()
    account_id, old_active = account.id, account.last_active_at
    redis = Mock(spec=RedisClientWrapper)
    if isinstance(redis_claim, RedisError):
        redis.set.side_effect = redis_claim
    else:
        redis.set.return_value = redis_claim
    gateway = AccountIdentityGateway(accounts=account_domain.repository, redis=redis)
    loaded = gateway.load_user(account_id)
    assert loaded is not None
    sqlite_session.expire_all()
    assert (account.last_active_at > old_active) == (redis_claim is not False)
    assert redis.set.call_args.kwargs == {"ex": 600, "nx": True}


def test_identity_rejects_banned_and_missing_accounts(account_domain: AccountDomain, sqlite_session: Session) -> None:
    account = Account(name="Banned", email="b@example.com", status=AccountStatus.BANNED)
    sqlite_session.add(account)
    sqlite_session.commit()
    gateway = AccountIdentityGateway(accounts=account_domain.repository, redis=Mock(spec=RedisClientWrapper))
    with pytest.raises(Unauthorized, match="banned"):
        gateway.load_user(account.id)
    assert gateway.load_user("missing") is None
