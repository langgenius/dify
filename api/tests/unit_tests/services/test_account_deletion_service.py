from __future__ import annotations

from unittest.mock import MagicMock, Mock, call

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from machinery.context import RequestContext
from models.account import TenantAccountJoin
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.account.adapters import (
    CeleryAccountDeletionScheduler,
    CeleryAccountDeletionVerificationNotifier,
    EnterpriseAccountDeletionSyncGateway,
    TokenManagerAccountDeletionVerificationGateway,
)
from services.account_deletion_service import AccountDeletionService
from services.account_errors import InvalidAccountDeletionVerificationError
from tests.unit_tests.model_factories import make_account, make_tenant


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


@pytest.fixture
def service(
    sqlite_session_factory: sessionmaker[Session], redis_transport: tuple[RedisClientWrapper, MagicMock]
) -> AccountDeletionService:
    redis, commands = redis_transport
    commands.return_value = 0
    with sqlite_session_factory.begin() as session:
        session.add(make_account(email="account@example.com"))
        for workspace_id in ("workspace-1", "workspace-2"):
            session.add(make_tenant(tenant_id=workspace_id))
            session.add(TenantAccountJoin(tenant_id=workspace_id, account_id="account-1"))
    return AccountDeletionService(
        accounts=SQLAlchemyAccountRepository(sqlite_session_factory),
        memberships=WorkspaceRepository(session_factory=sqlite_session_factory),
        verification=TokenManagerAccountDeletionVerificationGateway(),
        notifications=CeleryAccountDeletionVerificationNotifier(redis=redis),
        synchronization=EnterpriseAccountDeletionSyncGateway(),
        scheduler=CeleryAccountDeletionScheduler(),
    )


def test_issue_verification_reads_account_then_sends_challenge(
    service: AccountDeletionService, mocker: MockerFixture
) -> None:
    get_account = mocker.spy(service._accounts, "get")
    mocker.patch("services.account.adapters.secrets.randbelow", side_effect=[1, 2, 3, 4, 5, 6])
    create_token = mocker.patch("services.account.adapters.TokenManager.generate_token", return_value="token")
    send = mocker.patch("services.account.adapters.send_account_deletion_verification_code.delay")

    token = service.issue_verification(_context())

    assert token == "token"
    get_account.assert_called_once_with("account-1")
    create_token.assert_called_once_with(
        account_id="account-1",
        email="account@example.com",
        token_type="account_deletion",
        additional_data={"code": "123456"},
    )
    send.assert_called_once_with(to="account@example.com", code="123456")


@pytest.mark.parametrize("token_account_id", ["account-1", "other-account"])
def test_request_deletion_rejects_invalid_or_cross_account_verification_before_membership_read(
    service: AccountDeletionService, mocker: MockerFixture, token_account_id: str
) -> None:
    mocker.patch(
        "services.account.adapters.TokenManager.get_token_data",
        return_value={"account_id": token_account_id, "code": "123456"},
    )
    memberships = mocker.spy(service._memberships, "list_ids_for_account")
    schedule = mocker.spy(service._scheduler, "schedule")

    with pytest.raises(InvalidAccountDeletionVerificationError):
        service.request_deletion(
            _context(), token="token", code="wrong" if token_account_id == "account-1" else "123456"
        )

    memberships.assert_not_called()
    schedule.assert_not_called()


def test_request_deletion_reads_memberships_before_external_sync_and_always_schedules(
    service: AccountDeletionService, mocker: MockerFixture
) -> None:
    read_token = mocker.patch(
        "services.account.adapters.TokenManager.get_token_data",
        return_value={"account_id": "account-1", "code": "123456"},
    )
    sync = mocker.patch("services.account.adapters.sync_account_deletion_memberships", return_value=False)
    enqueue = mocker.patch("services.account.adapters.delete_account_task.delay")
    memberships = mocker.spy(service._memberships, "list_ids_for_account")
    manager = Mock()
    manager.attach_mock(memberships, "memberships")
    manager.attach_mock(sync, "sync")
    manager.attach_mock(enqueue, "enqueue")

    service.request_deletion(_context(), token="token", code="123456")

    read_token.assert_called_once_with("token", "account_deletion")
    assert manager.mock_calls == [
        call.memberships("account-1"),
        call.sync(account_id="account-1", workspace_ids=("workspace-1", "workspace-2"), source="account_deleted"),
        call.enqueue("account-1"),
    ]
