"""Detailed credential checks and best-effort OAuth revocation.

Callers resolve and authorize credentials before this boundary. The daemon owns
capability checks for the dispatched plugin version; these calls never refresh
tokens, persist Connection state, or retry provider operations automatically.

Legacy true results preserve the existing validator's success semantics. Legacy
false results cannot distinguish invalid credentials from other failures, so
they do not invalidate credentials. An absent revoke endpoint returns a failure
value so local cleanup can continue.
"""

import time
from collections.abc import Mapping
from contextlib import closing
from typing import Any

import httpx

from clients.plugin.auth_entities import (
    AuthReasonCode,
    CredentialCheckResponse,
    CredentialCheckResult,
    OAuthRevokeResult,
)
from core.plugin.entities.plugin_daemon import CredentialType, PluginDaemonInnerError
from core.plugin.impl.base import BasePluginClient, use_plugin_daemon_request_timeout
from models.provider_ids import ToolProviderID


class PluginCredentialAuthClient(BasePluginClient):
    def check_provider_credentials(
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider: str,
        credentials: Mapping[str, Any],
        credential_type: CredentialType,
    ) -> CredentialCheckResult:
        """Accept legacy success without interpreting legacy failure as invalid."""
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
            with (
                use_plugin_daemon_request_timeout(10),
                closing(
                    self._request_with_plugin_daemon_response_stream(
                        "POST",
                        f"plugin/{tenant_id}/dispatch/{operation}",
                        dict[str, object],
                        headers={"X-Plugin-ID": provider_id.plugin_id, "Content-Type": "application/json"},
                        data={"user_id": user_id, "data": {"provider": provider_id.provider_name, **data}},
                    )
                ) as response,
            ):
                result: T | None = None
                for payload in response:
                    if result is not None:
                        raise ValueError("Expected exactly one successful authentication result")
                    if (
                        response_type is CredentialCheckResponse
                        and payload.keys() == {"result"}
                        and payload["result"] is True
                    ):
                        payload = {"status": "valid", "reason_code": None, "retryable": False}
                    result = response_type.model_validate(payload)
                if result is None:
                    raise ValueError("Expected exactly one authentication result")
                # Consume EOF before accepting success: a later error invalidates it.
                return result
        except httpx.HTTPStatusError as exc:
            reason_code: AuthReasonCode = "daemon_unavailable"
            retryable = exc.response.status_code == 429 or exc.response.status_code >= 500
        except PluginDaemonInnerError as exc:
            reason_code = "daemon_unavailable"
            retryable = isinstance(exc.__cause__, httpx.TransportError)
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
