"""Tests for the domain error hierarchy."""

from __future__ import annotations

import pytest

from gateway.errors import (
    DifyTimeoutError,
    DifyUpstreamError,
    GatewayError,
    InvalidRequestError,
    InvalidSdkKeyError,
    RateLimitError,
    ServiceUnavailableError,
    UnknownModelError,
)


@pytest.mark.parametrize(
    "exc_cls,expected_status,expected_code",
    [
        (InvalidSdkKeyError, 401, "invalid_sdk_key"),
        (UnknownModelError, 404, "model_not_found"),
        (InvalidRequestError, 400, "invalid_request"),
        (RateLimitError, 429, "rate_limited"),
        (DifyUpstreamError, 502, "dify_upstream_error"),
        (DifyTimeoutError, 504, "dify_timeout"),
        (ServiceUnavailableError, 503, "service_unavailable"),
    ],
)
def test_error_attributes(exc_cls: type[GatewayError], expected_status: int, expected_code: str) -> None:
    err = exc_cls("boom")
    assert err.status_code == expected_status
    assert err.code == expected_code
    assert err.message == "boom"


def test_envelope_shape() -> None:
    err = InvalidSdkKeyError("nope", param="authorization")
    env = err.to_openai_envelope()
    assert env == {
        "error": {
            "message": "nope",
            "type": "invalid_request_error",
            "code": "invalid_sdk_key",
            "param": "authorization",
        }
    }


def test_envelope_omits_param_when_not_provided() -> None:
    err = ServiceUnavailableError("down")
    env = err.to_openai_envelope()
    assert env["error"]["param"] is None


def test_subclass_relationship() -> None:
    assert issubclass(InvalidSdkKeyError, GatewayError)
    assert issubclass(DifyUpstreamError, GatewayError)
