from datetime import UTC, datetime
from unittest.mock import patch

from services.account_billing_adapters import BillingAccountEducationGateway
from services.entities.account_entities import AccountEducationAutocomplete, AccountEducationStatus


def test_education_gateway_normalizes_billing_status_timestamp() -> None:
    gateway = BillingAccountEducationGateway()

    with patch(
        "services.account_billing_adapters.BillingService.EducationIdentity.status",
        return_value={
            "result": True,
            "is_student": True,
            "expire_at": "2027-01-01T00:00:00+00:00",
            "allow_refresh": False,
        },
    ):
        result = gateway.status("account-1")

    assert result == AccountEducationStatus(
        result=True,
        is_student=True,
        expire_at=datetime(2027, 1, 1, tzinfo=UTC),
        allow_refresh=False,
    )


def test_education_gateway_activates_with_primitive_account_context() -> None:
    gateway = BillingAccountEducationGateway()

    with patch(
        "services.account_billing_adapters.BillingService.EducationIdentity.activate",
        return_value={"message": "success"},
    ) as activate:
        result = gateway.activate(
            account_id="account-1",
            email="student@example.edu",
            tenant_id="workspace-1",
            token="education-token",
            institution="Dify University",
            role="Student",
        )

    assert result == {"message": "success"}
    account = activate.call_args.args[0]
    assert account.id == "account-1"
    assert account.email == "student@example.edu"
    assert account.current_tenant_id == "workspace-1"
    assert activate.call_args.args[1:] == ("education-token", "Dify University", "Student")


def test_education_gateway_normalizes_autocomplete_defaults() -> None:
    gateway = BillingAccountEducationGateway()

    with patch(
        "services.account_billing_adapters.BillingService.EducationIdentity.autocomplete",
        return_value=None,
    ):
        result = gateway.autocomplete(keywords="Example", page=0, limit=20)

    assert result == AccountEducationAutocomplete(data=(), curr_page=None, has_next=None)
