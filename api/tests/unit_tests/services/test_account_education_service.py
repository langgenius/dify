from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import Mock

from machinery.context import RequestContext
from services.account_education_service import AccountEducationGateway, AccountEducationService
from services.account_ports import AccountRepository
from services.entities.account_entities import (
    AccountEducationAutocomplete,
    AccountEducationStatus,
    AccountEducationVerification,
    AccountSnapshot,
)


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


def _account() -> AccountSnapshot:
    return AccountSnapshot(
        id="account-1",
        name="Student",
        email="student@example.edu",
        avatar=None,
        is_password_set=True,
        interface_language="en-US",
        interface_theme="light",
        timezone="UTC",
        last_login_at=None,
        last_login_ip=None,
        status="active",
        initialized_at=datetime(2026, 1, 1),
        created_at=datetime(2026, 1, 1),
    )


def test_verify_reads_account_before_billing_gateway_call() -> None:
    accounts = Mock(spec=AccountRepository)
    accounts.get.return_value = _account()
    education = Mock(spec=AccountEducationGateway)
    education.verify.return_value = AccountEducationVerification(token="education-token")
    service = AccountEducationService(accounts=accounts, education=education)

    result = service.verify(_context())

    assert result == AccountEducationVerification(token="education-token")
    accounts.get.assert_called_once_with("account-1")
    education.verify.assert_called_once_with(account_id="account-1", email="student@example.edu")


def test_status_and_autocomplete_delegate_framework_neutral_contracts() -> None:
    accounts = Mock(spec=AccountRepository)
    education = Mock(spec=AccountEducationGateway)
    status = AccountEducationStatus(
        result=True,
        is_student=True,
        expire_at=datetime(2027, 1, 1, tzinfo=UTC),
        allow_refresh=False,
    )
    autocomplete = AccountEducationAutocomplete(data=("Example University",), curr_page=0, has_next=False)
    education.status.return_value = status
    education.autocomplete.return_value = autocomplete
    service = AccountEducationService(
        accounts=accounts,
        education=education,
    )

    assert service.status(_context()) == status
    assert service.autocomplete(_context(), keywords="Example", page=0, limit=20) == autocomplete
    education.status.assert_called_once_with("account-1")
    education.autocomplete.assert_called_once_with(keywords="Example", page=0, limit=20)


def test_activate_delegates_account_and_workspace_context() -> None:
    accounts = Mock(spec=AccountRepository)
    accounts.get.return_value = _account()
    education = Mock(spec=AccountEducationGateway)
    education.activate.return_value = {"message": "success"}
    service = AccountEducationService(
        accounts=accounts,
        education=education,
    )

    result = service.activate(
        _context(),
        token="education-token",
        institution="Dify University",
        role="Student",
    )

    assert result == {"message": "success"}
    education.activate.assert_called_once_with(
        account_id="account-1",
        email="student@example.edu",
        tenant_id="workspace-1",
        token="education-token",
        institution="Dify University",
        role="Student",
    )
