import pytest
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressBlockedError,
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
)
from dify_trace_sdk.exporting import EXPORT_TIMEOUT_SECONDS, export_endpoint, send_export_request
from dify_trace_sdk.testing import RecordingEgress, response


def _send(egress: RecordingEgress) -> None:
    send_export_request(
        egress,
        "POST",
        "https://collector.example.com/v1/traces",
        destination="Example",
        headers={},
        content=b"{}",
        sensitive_url=False,
    )


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        (EgressError("refused", request_sent=False), ExportRetryableError),
        (EgressError("read timeout", request_sent=True), ExportOutcomeUnknownError),
        (EgressBlockedError("private address"), ExportRejectedError),
        (response(503, {}), ExportRetryableError),
        (response(429, {}), ExportRetryableError),
        (response(401, {}), ExportRejectedError),
        (response(501, {}), ExportRejectedError),
    ],
)
def test_export_failures_are_classified(outcome: EgressResponse | Exception, expected: type[Exception]) -> None:
    egress = RecordingEgress([outcome], grpc_target=None)
    with pytest.raises(expected):
        _send(egress)
    assert egress.requests[0].timeout == EXPORT_TIMEOUT_SECONDS


def test_export_endpoint_validation() -> None:
    assert export_endpoint("https://collector.example.com/") == "https://collector.example.com"
    for value in ("ftp://x", "https://u:p@x.example.com", "https://x.example.com/?token=1"):
        with pytest.raises(ExportRejectedError):
            export_endpoint(value)
