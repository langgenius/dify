"""Detailed credential checks and best-effort OAuth revocation.

Callers resolve and authorize credentials before this boundary. The daemon owns
capability checks for the dispatched plugin version; these calls never refresh
tokens, persist Connection state, or retry provider operations automatically.

API deployment does not activate these operations. Before callers enable them,
all daemon nodes must support the detailed protocol. Legacy boolean responses
fail the check; an absent revoke endpoint returns a failure value. Neither is
evidence that the plugin explicitly declared the operation unsupported.
"""

import time
from collections.abc import Mapping
from typing import Any

import httpx

from clients.plugin.auth_entities import (
    AuthReasonCode,
    CredentialCheckResponse,
    CredentialCheckResult,
    OAuthRevokeResult,
)
from clients.plugin.http_client import get_client
from core.plugin.entities.plugin_daemon import CredentialType, PluginDaemonBasicResponse
from core.plugin.impl.base import BasePluginClient
from models.provider_ids import ToolProviderID


class PluginCredentialAuthClient(BasePluginClient):
    def __init__(self, *, http_client: httpx.Client | None = None) -> None:
        self._http_client = http_client or get_client()

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
        return self._dispatch(
            tenant_id=tenant_id,
            user_id=user_id,
            provider_id=provider_id,
            operation="oauth/revoke_credentials",
            data={"system_credentials": dict(system_credentials), "credentials": dict(credentials)},
            response_type=OAuthRevokeResult,
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
            with self._http_client.stream("POST", url, headers=headers, content=body, timeout=10) as response:
                response.raise_for_status()
                result: T | None = None
                for line in response.iter_lines():
                    line = line.strip()
                    if not line or line.startswith(":"):
                        continue
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    envelope = PluginDaemonBasicResponse[dict[str, object]].model_validate_json(line)
                    if envelope.code != 0 or result is not None:
                        raise ValueError("Expected exactly one successful authentication result")
                    result = response_type.model_validate(envelope.data)
                if result is None:
                    raise ValueError("Expected exactly one authentication result")
                # Consume EOF before accepting success: a later error invalidates it.
                return result
        except httpx.HTTPStatusError as exc:
            reason_code: AuthReasonCode = "daemon_unavailable"
            retryable = exc.response.status_code == 429 or exc.response.status_code >= 500
        except httpx.TransportError:
            reason_code, retryable = "daemon_unavailable", True
        except (ValueError, TypeError):
            reason_code, retryable = "protocol_error", False
        except Exception:
            reason_code, retryable = "unknown_error", False

        return response_type.model_validate(
            {
                "status": "failed"
                if response_type is OAuthRevokeResult and not retryable
                else "temporarily_unavailable",
                "reason_code": reason_code,
                "retryable": retryable,
            }
        )
