from __future__ import annotations

import httpx
from pydantic import BaseModel, Field, SecretStr, ValidationError

from configs import dify_config
from core.helper.http_client_pooling import get_pooled_http_client

_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
EMAIL_CODE_SEND_ACTION = "signin_code"
EMAIL_CODE_VERIFY_ACTION = "signin_code_verify"
_MAX_TOKEN_LENGTH = 2048
_CLIENT_ERROR_CODES = frozenset(
    {
        "bad-request",
        "invalid-input-response",
        "missing-input-response",
        "timeout-or-duplicate",
    }
)

_http_client = get_pooled_http_client(
    "cloudflare:turnstile",
    lambda: httpx.Client(
        timeout=httpx.Timeout(5.0, connect=3.0),
        limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
    ),
)


class TurnstileChallengeRejectedError(Exception):
    """The submitted challenge is missing, invalid, expired, or not valid for this site."""


class TurnstileUpstreamError(Exception):
    """Turnstile could not be called or returned an unusable response."""


class _TurnstileResponse(BaseModel):
    success: bool
    hostname: str | None = None
    action: str | None = None
    error_codes: list[str] = Field(default_factory=list, alias="error-codes")


class TurnstileService:
    @classmethod
    def verify(
        cls,
        *,
        token: str | None,
        remote_ip: str | None,
        expected_action: str = EMAIL_CODE_SEND_ACTION,
    ) -> None:
        normalized_token = token.strip() if token else ""
        if not normalized_token or len(normalized_token) > _MAX_TOKEN_LENGTH:
            raise TurnstileChallengeRejectedError

        secret_key = dify_config.TURNSTILE_SECRET_KEY
        allowed_hostnames = dify_config.TURNSTILE_ALLOWED_HOSTNAME_SET
        if not isinstance(secret_key, SecretStr) or not allowed_hostnames:
            raise TurnstileUpstreamError("Turnstile is not configured")

        payload = {
            "secret": secret_key.get_secret_value(),
            "response": normalized_token,
        }
        if remote_ip:
            payload["remoteip"] = remote_ip

        try:
            response = _http_client.post(_SITEVERIFY_URL, data=payload)
            response.raise_for_status()
            result = _TurnstileResponse.model_validate(response.json())
        except (httpx.HTTPError, ValidationError, ValueError) as exc:
            raise TurnstileUpstreamError("Turnstile verification request failed") from exc

        if not result.success:
            error_codes = frozenset(result.error_codes)
            if error_codes and error_codes.issubset(_CLIENT_ERROR_CODES):
                raise TurnstileChallengeRejectedError
            raise TurnstileUpstreamError("Turnstile returned a server-side verification error")

        if result.action != expected_action or not cls._is_allowed_hostname(result.hostname, allowed_hostnames):
            raise TurnstileChallengeRejectedError

    @staticmethod
    def _is_allowed_hostname(hostname: str | None, allowed_hostnames: frozenset[str]) -> bool:
        normalized_hostname = hostname.lower().strip(".") if hostname else ""
        return any(
            normalized_hostname == allowed or normalized_hostname.endswith(f".{allowed}")
            for allowed in allowed_hostnames
        )
