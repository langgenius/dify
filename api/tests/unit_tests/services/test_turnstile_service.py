from unittest.mock import MagicMock

import httpx
import pytest
from pydantic import SecretStr

from services.turnstile_service import (
    EMAIL_CODE_VERIFY_ACTION,
    TurnstileChallengeRejectedError,
    TurnstileService,
    TurnstileUpstreamError,
)


@pytest.fixture(autouse=True)
def configure_turnstile(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.turnstile_service.dify_config.TURNSTILE_SECRET_KEY", SecretStr("test-secret"))
    monkeypatch.setattr("services.turnstile_service.dify_config.TURNSTILE_ALLOWED_HOSTNAMES", "dify.dev")


def mock_response(monkeypatch: pytest.MonkeyPatch, *, status_code: int = 200, payload: object) -> MagicMock:
    response = httpx.Response(
        status_code,
        json=payload,
        request=httpx.Request("POST", "https://challenges.cloudflare.com/turnstile/v0/siteverify"),
    )
    post = MagicMock(return_value=response)
    monkeypatch.setattr("services.turnstile_service._http_client.post", post)
    return post


def test_verify_accepts_subdomain_and_forwards_remote_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    post = mock_response(
        monkeypatch,
        payload={"success": True, "action": "signin_code", "hostname": "agent.dify.dev"},
    )

    TurnstileService.verify(token="verified-token", remote_ip="203.0.113.8")

    post.assert_called_once_with(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        data={
            "secret": "test-secret",
            "response": "verified-token",
            "remoteip": "203.0.113.8",
        },
    )


def test_verify_accepts_caller_scoped_action(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_response(
        monkeypatch,
        payload={"success": True, "action": EMAIL_CODE_VERIFY_ACTION, "hostname": "agent.dify.dev"},
    )

    TurnstileService.verify(
        token="verified-token",
        remote_ip=None,
        expected_action=EMAIL_CODE_VERIFY_ACTION,
    )


@pytest.mark.parametrize("token", [None, "", " ", "x" * 2049])
def test_verify_rejects_missing_or_oversized_token(monkeypatch: pytest.MonkeyPatch, token: str | None) -> None:
    post = MagicMock()
    monkeypatch.setattr("services.turnstile_service._http_client.post", post)

    with pytest.raises(TurnstileChallengeRejectedError):
        TurnstileService.verify(token=token, remote_ip=None)

    post.assert_not_called()


@pytest.mark.parametrize(
    "payload",
    [
        {"success": False, "error-codes": ["invalid-input-response"]},
        {"success": False, "error-codes": ["timeout-or-duplicate"]},
        {"success": True, "action": "different_action", "hostname": "agent.dify.dev"},
        {"success": True, "action": "signin_code", "hostname": "attacker.example"},
    ],
)
def test_verify_rejects_invalid_challenge(monkeypatch: pytest.MonkeyPatch, payload: object) -> None:
    mock_response(monkeypatch, payload=payload)

    with pytest.raises(TurnstileChallengeRejectedError):
        TurnstileService.verify(token="invalid-token", remote_ip=None)


@pytest.mark.parametrize(
    "payload",
    [
        {"success": False, "error-codes": ["invalid-input-secret"]},
        {"success": False, "error-codes": ["internal-error"]},
        {"unexpected": "response"},
    ],
)
def test_verify_maps_server_side_failures_to_upstream_error(monkeypatch: pytest.MonkeyPatch, payload: object) -> None:
    mock_response(monkeypatch, payload=payload)

    with pytest.raises(TurnstileUpstreamError):
        TurnstileService.verify(token="verified-token", remote_ip=None)


def test_verify_maps_http_errors_to_upstream_error(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_response(monkeypatch, status_code=503, payload={"error": "unavailable"})

    with pytest.raises(TurnstileUpstreamError):
        TurnstileService.verify(token="verified-token", remote_ip=None)


def test_verify_maps_timeout_to_upstream_error(monkeypatch: pytest.MonkeyPatch) -> None:
    request = httpx.Request("POST", "https://challenges.cloudflare.com/turnstile/v0/siteverify")
    monkeypatch.setattr(
        "services.turnstile_service._http_client.post",
        MagicMock(side_effect=httpx.ReadTimeout("timed out", request=request)),
    )

    with pytest.raises(TurnstileUpstreamError):
        TurnstileService.verify(token="verified-token", remote_ip=None)


@pytest.mark.parametrize(
    ("secret", "allowed_hostnames"),
    [(None, "dify.dev"), (SecretStr("test-secret"), "")],
)
def test_verify_fails_closed_when_cloud_configuration_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    secret: SecretStr | None,
    allowed_hostnames: str,
) -> None:
    monkeypatch.setattr("services.turnstile_service.dify_config.TURNSTILE_SECRET_KEY", secret)
    monkeypatch.setattr("services.turnstile_service.dify_config.TURNSTILE_ALLOWED_HOSTNAMES", allowed_hostnames)

    with pytest.raises(TurnstileUpstreamError):
        TurnstileService.verify(token="verified-token", remote_ip=None)
