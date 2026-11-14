"""Legacy MCP encryption and OAuth network operations, outside DB transactions."""

import json
from copy import deepcopy
from typing import Any

import httpx

from core.entities.mcp_provider import MCPProviderEntity
from core.entities.provider_entities import BasicProviderConfig, ProviderConfigType
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.mcp.auth.auth_flow import auth
from core.mcp.entities import AuthActionType
from core.mcp.error import MCPRefreshTokenError
from core.tools.utils.encryption import create_provider_encrypter
from services.credentials.mcp_runtime import MCPCredentialRecord, MCPCredentialUnavailableError
from services.credentials.refresh import CredentialRefreshUnavailableError


class MCPProviderCredentialRuntime:
    def resolve(self, record: MCPCredentialRecord, *, deployed: bool = True) -> dict[str, Any]:
        """Decrypt only connection values; reject unsupported forwarded identity and placeholders."""
        entity = MCPProviderEntity.model_validate(deepcopy(record.data))
        headers = entity.decrypt_authentication()
        if deployed and (entity.identity_mode != "off" or any("{{" in value for value in headers.values())):
            raise MCPCredentialUnavailableError("MCP identity forwarding and dynamic headers are not supported.")
        return {"server_url": entity.decrypt_server_url(), "headers": headers}

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
        entity = MCPProviderEntity.model_validate(deepcopy(record.data))
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
        tokens = {key: value for key, value in tokens.items() if value is not None}
        # Some authorization servers omit an unchanged refresh token.
        if not tokens.get("refresh_token"):
            tokens.pop("refresh_token", None)
        encrypter, _ = create_provider_encrypter(
            tenant_id=record.workspace_id,
            config=[BasicProviderConfig(type=ProviderConfigType.SECRET_INPUT, name=key) for key in tokens],
            cache=NoOpProviderCredentialCache(),
        )
        return json.dumps({**stored_credentials, **encrypter.encrypt(tokens)})
