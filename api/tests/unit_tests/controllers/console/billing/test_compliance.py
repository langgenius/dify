from collections.abc import Iterator
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.billing.compliance import ComplianceApi, ComplianceDownloadQuery
from controllers.console.billing.error import ComplianceRateLimitError
from machinery.context import RequestContext
from services.errors.billing import ComplianceRateLimitExceededError


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="tenant-1",
    )


@pytest.fixture
def compliance_downloads() -> MagicMock:
    return MagicMock()


@pytest.fixture(autouse=True)
def mock_application_services(compliance_downloads: MagicMock) -> Iterator[None]:
    with patch(
        "controllers.console.billing.compliance.application_services",
        return_value=SimpleNamespace(compliance_downloads=compliance_downloads),
    ):
        yield


def test_get_compliance_download_link(
    app: Flask,
    request_context: RequestContext,
    compliance_downloads: MagicMock,
) -> None:
    resource = ComplianceApi()
    method = unwrap(resource.get)
    query = ComplianceDownloadQuery(doc_name="SOC2_Type_II")
    compliance_downloads.get_link.return_value = {"url": "https://example.com/report", "ignored": True}

    with (
        app.test_request_context("/compliance/download", headers={"User-Agent": "test-agent"}),
        patch("controllers.console.billing.compliance.extract_remote_ip", return_value="127.0.0.1"),
    ):
        result = method(resource, query, request_context)

    assert result == {"url": "https://example.com/report"}
    compliance_downloads.get_link.assert_called_once_with(
        request_context=request_context,
        document_name="SOC2_Type_II",
        ip_address="127.0.0.1",
        device_info="test-agent",
    )


def test_get_compliance_download_translates_rate_limit(
    app: Flask,
    request_context: RequestContext,
    compliance_downloads: MagicMock,
) -> None:
    resource = ComplianceApi()
    method = unwrap(resource.get)
    query = ComplianceDownloadQuery(doc_name="SOC2_Type_II")
    compliance_downloads.get_link.side_effect = ComplianceRateLimitExceededError

    with (
        app.test_request_context("/compliance/download"),
        patch("controllers.console.billing.compliance.extract_remote_ip", return_value="127.0.0.1"),
    ):
        with pytest.raises(ComplianceRateLimitError) as exc_info:
            method(resource, query, request_context)

    assert exc_info.value.data == {
        "code": "compliance_rate_limit",
        "message": "Rate limit exceeded for downloading compliance report.",
        "status": 429,
    }
