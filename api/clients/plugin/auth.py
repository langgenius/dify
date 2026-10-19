"""Detailed credential checks and best-effort OAuth revocation.

Callers resolve and authorize credentials before this boundary. The daemon owns
capability checks for the dispatched plugin version; these calls never refresh
tokens, persist Connection state, or retry provider operations automatically.
"""

import time
from collections.abc import Mapping
from typing import Any

import httpx
from pydantic import BaseModel, StrictInt

from clients.plugin.auth_entities import (
    AuthReasonCode,
    CredentialCheckResponse,
    CredentialCheckResult,
    OAuthRevokeResult,
)
from core.helper.http_client_pooling import get_pooled_http_client
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.base import BasePluginClient
from models.provider_ids import ToolProviderID


class _AuthEnvelope(BaseModel):
    code: StrictInt
    data: object = None


class _AuthDispatchError(Exception):
    def __init__(self, reason_code: AuthReasonCode, *, retryable: bool) -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code
        self.retryable = retryable


class PluginCredentialAuthClient(BasePluginClient):
    def __init__(self, *, timeout_seconds: float = 10, http_client: httpx.Client | None = None) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than zero")
        self._timeout_seconds = timeout_seconds
        self._http_client = http_client or get_pooled_http_client(
            "plugin_credential_auth",
            lambda: httpx.Client(
                limits=httpx.Limits(max_keepalive_connections=50, max_connections=100), trust_env=False
            ),
        )

    def check_provider_credentials(
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider: str,
        credentials: Mapping[str, Any],
        credential_type: CredentialType,
    ) -> CredentialCheckResult:
        """Check without treating legacy responses or transport failures as invalid."""
        match credential_type:
            case CredentialType.API_KEY:
                wire_credential_type = "api_key"
            case CredentialType.OAUTH2:
                wire_credential_type = "oauth2"
            case _:
                raise ValueError("Detailed checks require API key or OAuth2 credentials")

        provider_id = ToolProviderID(provider)
        try:
            result = self._dispatch(
                tenant_id=tenant_id,
                user_id=user_id,
                provider_id=provider_id,
                operation="tool/validate_credentials",
                data={
                    "credentials": dict(credentials),
                    "credential_type": wire_credential_type,
                    "result_format": "detailed",
                },
                response_type=CredentialCheckResponse,
            )
        except _AuthDispatchError as exc:
            result = CredentialCheckResponse(
                status="temporarily_unavailable", reason_code=exc.reason_code, retryable=exc.retryable
            )
        return CredentialCheckResult(
            status=result.status,
            reason_code=result.reason_code,
            retryable=result.retryable,
            checked_at=int(time.time()),
        )

    def revoke_credentials(
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider: str,
        system_credentials: Mapping[str, Any],
        credentials: Mapping[str, Any],
    ) -> OAuthRevokeResult:
        """Return remote failures as values so local cleanup can still proceed.

        The caller supplies the OAuth client configuration used for the original
        grant. App unbinding must not call this operation.
        """
        provider_id = ToolProviderID(provider)
        try:
            return self._dispatch(
                tenant_id=tenant_id,
                user_id=user_id,
                provider_id=provider_id,
                operation="oauth/revoke_credentials",
                data={"system_credentials": dict(system_credentials), "credentials": dict(credentials)},
                response_type=OAuthRevokeResult,
            )
        except _AuthDispatchError as exc:
            return OAuthRevokeResult(
                status="temporarily_unavailable" if exc.retryable else "failed",
                reason_code=exc.reason_code,
                retryable=exc.retryable,
            )

    def _dispatch[T: CredentialCheckResponse | OAuthRevokeResult](
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider_id: ToolProviderID,
        operation: str,
        data: dict[str, Any],
        response_type: type[T],
    ) -> T:
        try:
            url, headers, body, _, _ = self._prepare_request(
                f"plugin/{tenant_id}/dispatch/{operation}",
                {"X-Plugin-ID": provider_id.plugin_id, "Content-Type": "application/json"},
                {"user_id": user_id, "data": {"provider": provider_id.provider_name, **data}},
                None,
                None,
            )
            assert isinstance(body, str)
            # Reuse daemon authentication and tracing, but keep raw errors out of
            # the generic transport's exception logs as well as its SSE parser.
            with self._http_client.stream(
                "POST", url, headers=headers, content=body, timeout=self._timeout_seconds
            ) as response:
                response.raise_for_status()
                result: T | None = None
                for line in response.iter_lines():
                    line = line.strip()
                    if not line or line.startswith(":"):
                        continue
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    envelope = _AuthEnvelope.model_validate_json(line)
                    if envelope.code != 0:
                        raise _AuthDispatchError("plugin_error", retryable=False)
                    if result is not None:
                        raise _AuthDispatchError("protocol_error", retryable=False)
                    result = response_type.model_validate(envelope.data)
                if result is None:
                    raise _AuthDispatchError("protocol_error", retryable=False)
                # Consume EOF before accepting success: a later error invalidates it.
                return result
        except _AuthDispatchError:
            raise
        except httpx.HTTPStatusError as exc:
            retryable = exc.response.status_code == 429 or exc.response.status_code >= 500
            raise _AuthDispatchError("daemon_unavailable", retryable=retryable) from None
        except httpx.TransportError:
            raise _AuthDispatchError("daemon_unavailable", retryable=True) from None
        except (ValueError, TypeError):
            raise _AuthDispatchError("protocol_error", retryable=False) from None
        except Exception:
            raise _AuthDispatchError("unknown_error", retryable=False) from None
