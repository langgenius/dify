"""Legacy MCP encryption and OAuth network operations, outside DB transactions."""

import json
import time
from copy import deepcopy
from typing import Any

import httpx

from core.entities.mcp_provider import IdentityMode, MCPProviderEntity
from core.entities.provider_entities import BasicProviderConfig, ProviderConfigType
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.mcp.auth.auth_flow import auth
from core.mcp.entities import AuthActionType
from core.mcp.error import MCPRefreshTokenError
from core.tools.utils.encryption import create_provider_encrypter
from services.credentials.mcp_runtime import MCPCredentialRecord, MCPCredentialUnavailableError, mcp_token_expiry
from services.credentials.refresh import CredentialRefreshUnavailableError


class MCPProviderCredentialRuntime:
    @staticmethod
    def _entity(record: MCPCredentialRecord) -> MCPProviderEntity:
        """Validate a detached snapshot, rejecting unknown identity modes before I/O."""
        if record.data.get("identity_mode", "off") not in (IdentityMode.OFF, IdentityMode.IDP_TOKEN):
            raise MCPCredentialUnavailableError("Unsupported MCP identity mode.")
        return MCPProviderEntity.model_validate(deepcopy(record.data))

    def needs_refresh(self, record: MCPCredentialRecord, *, now: float) -> bool:
        """Check known OAuth expiry with a window capped at 300s or half its lifetime.

        Short-lived tokens remain usable after issuance rather than refreshing
        on every resolve. Unknown legacy expirations retain reactive refresh.
        Header credentials never use OAuth expiry, and no state is changed.
        """
        entity = self._entity(record)
        if entity.headers:
            return False
        credentials = entity.decrypt_credentials()
        expires_at = credentials.get("expires_at")
        lifetime = credentials.get("expires_in")
        if type(expires_at) is not int or expires_at <= 0:
            return False
        window = min(300.0, lifetime / 2) if type(lifetime) is int and lifetime > 0 else 300.0
        return expires_at - now < window

    def resolve(self, record: MCPCredentialRecord, *, deployed: bool = True) -> dict[str, Any]:
        """Return raw connection values and deployed identity metadata without MCP/SSO I/O.

        Accept supported identity modes only. Keep templates unexpanded and
        debug's existing connection shape; the run owner handles forwarding.
        """
        entity = self._entity(record)
        headers = entity.decrypt_authentication()
        values: dict[str, Any] = {"server_url": entity.decrypt_server_url(), "headers": headers}
        if deployed:
            values["identity_mode"] = entity.identity_mode.value
        return values

    def refresh(
        self,
        record: MCPCredentialRecord,
        *,
        authorization_code: str | None = None,
        resource_metadata_url: str | None = None,
        scope_hint: str | None = None,
    ) -> str:
        """Refresh the existing OAuth grant and return encrypted merged credentials.

        No database transaction spans discovery or token requests. Static headers
        cannot be refreshed. Authorization failures require console authorization;
        network failures remain temporary and never disable the provider.
        """
        entity = self._entity(record)
        # Legacy client decoding mutates its nested mapping when decrypting a
        # client secret. Never merge that plaintext back into persisted state.
        stored_credentials = deepcopy(entity.credentials)
        if entity.headers:
            raise CredentialRefreshUnavailableError()
        if not entity.retrieve_client_information():
            raise MCPCredentialUnavailableError("Authorize the MCP provider in the Dify console.")
        try:
            result = auth(
                entity,
                authorization_code=authorization_code,
                resource_metadata_url=resource_metadata_url,
                scope_hint=scope_hint,
            )
        except httpx.RequestError as error:
            raise CredentialRefreshUnavailableError() from error
        except (MCPRefreshTokenError, ValueError) as error:
            # Legacy discovery and OAuth wrap transport failures. Only an explicit
            # permanent OAuth rejection may disable an existing authorization.
            if isinstance(error, MCPRefreshTokenError) and getattr(error, "permanent", False):
                raise MCPCredentialUnavailableError("Authorize the MCP provider in the Dify console.") from error
            raise CredentialRefreshUnavailableError() from error
        tokens = next(
            (action.data for action in result.actions if action.action_type == AuthActionType.SAVE_TOKENS), None
        )
        if tokens is None:
            raise MCPCredentialUnavailableError("Authorize the MCP provider in the Dify console.")
        tokens = mcp_token_expiry(tokens, now=time.time())
        tokens = {key: value for key, value in tokens.items() if value is not None}
        # Some authorization servers omit an unchanged refresh token.
        if not tokens.get("refresh_token"):
            tokens.pop("refresh_token", None)
        encrypter, _ = create_provider_encrypter(
            tenant_id=record.workspace_id,
            config=[
                BasicProviderConfig(type=ProviderConfigType.SECRET_INPUT, name=key)
                for key, value in tokens.items()
                if isinstance(value, str)
            ],
            cache=NoOpProviderCredentialCache(),
        )
        return json.dumps({**stored_credentials, **encrypter.encrypt(tokens)})
