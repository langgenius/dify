from collections.abc import Iterator
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.billing.compliance import ComplianceApi, ComplianceDownloadQuery
from controllers.console.billing.error import ComplianceRateLimitError
from libs.exception import BaseHTTPException
from machinery.context import RequestContext
from services.billing_client import billing
from services.errors.billing import (
    ComplianceRateLimitExceededError,
    UnknownErrorReason,
)


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
    compliance_downloads.get_link.return_value = billing.DownloadComplianceDocumentReply(
        url="https://example.com/report"
    )

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


@pytest.mark.parametrize(
    ("error", "expected_code", "expected_status"),
    [
        (
            billing.UpstreamInvalidResponseError(status_code=404, reason="COMPLIANCE_DOCUMENT_NOT_FOUND"),
            "compliance_document_not_found",
            404,
        ),
        (
            billing.UpstreamInvalidResponseError(status_code=403, reason="COMPLIANCE_DOWNLOAD_FORBIDDEN"),
            "compliance_download_forbidden",
            403,
        ),
        (
            billing.UpstreamUnavailableError(status_code=429, reason="REQUEST_IN_PROGRESS"),
            "billing_request_in_progress",
            429,
        ),
        (
            billing.UpstreamUnavailableError(status_code=500, reason="COMPLIANCE_DOWNLOAD_FAILED"),
            "billing_unavailable",
            503,
        ),
        (
            billing.UpstreamInvalidResponseError(status_code=400, reason="MISSING_DOC_NAME"),
            "billing_operation_failed",
            502,
        ),
        (
            billing.UpstreamInvalidResponseError(
                status_code=403, reason=UnknownErrorReason("COMPLIANCE_SHIPPED_LATER")
            ),
            "billing_operation_failed",
            502,
        ),
        (
            billing.UpstreamUnavailableError(status_code=503, reason=UnknownErrorReason("COMPLIANCE_SHIPPED_LATER")),
            "billing_unavailable",
            503,
        ),
        (billing.UpstreamInvalidResponseError(status_code=404), "billing_operation_failed", 502),
        (billing.UpstreamUnavailableError(), "billing_unavailable", 503),
    ],
)
def test_get_compliance_download_maps_billing_reason(
    app: Flask,
    request_context: RequestContext,
    compliance_downloads: MagicMock,
    error: billing.UpstreamError,
    expected_code: str,
    expected_status: int,
) -> None:
    resource = ComplianceApi()
    compliance_downloads.get_link.side_effect = error

    with (
        app.test_request_context("/compliance/download"),
        patch("controllers.console.billing.compliance.extract_remote_ip", return_value="127.0.0.1"),
        pytest.raises(BaseHTTPException) as exc_info,
    ):
        unwrap(resource.get)(resource, ComplianceDownloadQuery(doc_name="SOC2_Type_II"), request_context)

    assert exc_info.value.error_code == expected_code
    assert exc_info.value.code == expected_status
    assert exc_info.value.__cause__ is error
