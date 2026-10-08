from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from libs.helper import RateLimiter
from machinery.context import RequestContext
from repositories.account.repository import SQLAlchemyAccountRepository
from services.account.adapters import BillingAccountEducationGateway
from services.account_education_service import AccountEducationService
from services.account_errors import EducationRateLimitExceededError
from services.billing_service import BillingService
from services.entities.account_entities import (
    AccountEducationActivation,
    AccountEducationAutocomplete,
    AccountEducationStatus,
    AccountEducationVerification,
)
from tests.unit_tests.model_factories import make_account


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1", trace_id="trace-1", account_id="account-1", active_workspace_id="workspace-1"
    )


@pytest.fixture
def accounts(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyAccountRepository:
    with sqlite_session_factory.begin() as session:
        session.add(make_account(name="Student", email="student@example.edu"))
    return SQLAlchemyAccountRepository(sqlite_session_factory)


@pytest.fixture
def service(
    accounts: SQLAlchemyAccountRepository, redis_transport: tuple[RedisClientWrapper, MagicMock]
) -> AccountEducationService:
    redis, _commands = redis_transport
    return AccountEducationService(
        accounts=accounts,
        education=BillingAccountEducationGateway(),
        verification_rate_limiter=RateLimiter("verification", 10, 60, redis_client=redis),
        activation_rate_limiter=RateLimiter("activation", 10, 60, redis_client=redis),
    )


def _record_commands(commands: MagicMock, events: list[str]) -> None:
    def execute(command: str, *_args: object, **_kwargs: object) -> int:
        if command == "ZCARD":
            events.append("check")
        elif command == "ZADD":
            events.append("increment")
        return 0

    commands.side_effect = execute


def test_verify_reads_account_before_billing_gateway_call(
    service: AccountEducationService,
    accounts: SQLAlchemyAccountRepository,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    mocker: MockerFixture,
) -> None:
    _, commands = redis_transport
    events: list[str] = []
    _record_commands(commands, events)
    lookup = mocker.spy(accounts, "get")

    def verify(*, account_id: str) -> dict[str, str]:
        lookup.assert_called_once_with(account_id)
        events.append("verify")
        return {"token": "education-token"}

    billing = mocker.patch.object(BillingService.EducationIdentity, "verify", side_effect=verify)

    assert service.verify(_context()) == AccountEducationVerification(token="education-token")
    assert events == ["check", "increment", "verify"]
    billing.assert_called_once_with(account_id="account-1")
    assert all(call.args[1] == "verification:student@example.edu" for call in commands.call_args_list)


def test_status_and_autocomplete_delegate_framework_neutral_contracts(
    service: AccountEducationService, mocker: MockerFixture
) -> None:
    status = mocker.patch.object(
        BillingService.EducationIdentity,
        "status",
        return_value={
            "result": True,
            "is_student": True,
            "expire_at": "2027-01-01T00:00:00+00:00",
            "allow_refresh": False,
        },
    )
    autocomplete = mocker.patch.object(
        BillingService.EducationIdentity,
        "autocomplete",
        return_value={"data": ["Example University"], "curr_page": 0, "has_next": False},
    )

    assert service.status(_context()) == AccountEducationStatus(
        result=True, is_student=True, expire_at=datetime(2027, 1, 1, tzinfo=UTC), allow_refresh=False
    )
    assert service.autocomplete(_context(), keywords="Example", page=0, limit=20) == AccountEducationAutocomplete(
        data=("Example University",), curr_page=0, has_next=False
    )
    status.assert_called_once_with("account-1")
    autocomplete.assert_called_once_with("Example", 0, 20)


def test_activate_delegates_account_and_workspace_context(
    service: AccountEducationService,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    mocker: MockerFixture,
) -> None:
    _, commands = redis_transport
    events: list[str] = []
    _record_commands(commands, events)
    billing = mocker.patch.object(
        BillingService.EducationIdentity,
        "activate",
        side_effect=lambda **_kwargs: events.append("activate") or {"message": "success"},
    )

    result = service.activate(_context(), token="education-token", institution="Dify University", role="Student")

    assert result == AccountEducationActivation(message="success")
    assert events == ["check", "increment", "activate"]
    assert all(call.args[1] == "activation:student@example.edu" for call in commands.call_args_list)
    billing.assert_called_once_with(
        account_id="account-1",
        tenant_id="workspace-1",
        token="education-token",
        institution="Dify University",
        role="Student",
    )


@pytest.mark.parametrize("operation", ["verify", "activate"])
def test_rejects_rate_limited_request(
    operation: str,
    service: AccountEducationService,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    mocker: MockerFixture,
) -> None:
    _, commands = redis_transport
    commands.return_value = 10
    verify = mocker.patch.object(BillingService.EducationIdentity, "verify")
    activate = mocker.patch.object(BillingService.EducationIdentity, "activate")

    if operation == "verify":
        with pytest.raises(EducationRateLimitExceededError):
            service.verify(_context())
    else:
        with pytest.raises(EducationRateLimitExceededError):
            service.activate(_context(), token="education-token", institution="Dify University", role="Student")

    assert [call.args[0] for call in commands.call_args_list] == ["ZREMRANGEBYSCORE", "ZCARD"]
    verify.assert_not_called()
    activate.assert_not_called()
