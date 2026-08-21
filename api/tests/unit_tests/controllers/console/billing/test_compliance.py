from inspect import unwrap
from unittest.mock import patch

import pytest
from flask import Flask

from controllers.console.billing.compliance import ComplianceApi, ComplianceDownloadQuery
from controllers.console.billing.error import ComplianceRateLimitError
from models import Account
from services.errors.billing import ComplianceRateLimitExceededError


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def account() -> Account:
    account = Account(name="Compliance User", email="user@example.com")
    account.id = "account-1"
    return account


def test_get_compliance_download_link(app: Flask, account: Account) -> None:
    resource = ComplianceApi()
    method = unwrap(resource.get)
    query = ComplianceDownloadQuery(doc_name="SOC2_Type_II")

    with (
        app.test_request_context("/compliance/download", headers={"User-Agent": "test-agent"}),
        patch("controllers.console.billing.compliance.extract_remote_ip", return_value="127.0.0.1"),
        patch(
            "controllers.console.billing.compliance.BillingService.get_compliance_download_link",
            return_value={"url": "https://example.com/report", "ignored": True},
        ) as get_download_link,
    ):
        result = method(resource, query, "tenant-1", account)

    assert result == {"url": "https://example.com/report"}
    get_download_link.assert_called_once_with(
        doc_name="SOC2_Type_II",
        account_id="account-1",
        tenant_id="tenant-1",
        ip="127.0.0.1",
        device_info="test-agent",
    )


def test_get_compliance_download_translates_rate_limit(app: Flask, account: Account) -> None:
    resource = ComplianceApi()
    method = unwrap(resource.get)
    query = ComplianceDownloadQuery(doc_name="SOC2_Type_II")

    with (
        app.test_request_context("/compliance/download"),
        patch("controllers.console.billing.compliance.extract_remote_ip", return_value="127.0.0.1"),
        patch(
            "controllers.console.billing.compliance.BillingService.get_compliance_download_link",
            side_effect=ComplianceRateLimitExceededError,
        ),
    ):
        with pytest.raises(ComplianceRateLimitError) as exc_info:
            method(resource, query, "tenant-1", account)

    assert exc_info.value.data == {
        "code": "compliance_rate_limit",
        "message": "Rate limit exceeded for downloading compliance report.",
        "status": 429,
    }
