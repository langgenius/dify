"""Plugin and tenant-key adapters for the API-key Connection slice."""

import json
import time
from collections.abc import Mapping
from copy import deepcopy
from typing import Any, Protocol

import httpx
from pydantic import ValidationError

from clients.plugin.auth import PluginCredentialAuthClient
from clients.plugin.auth_entities import CredentialCheckResult
from clients.plugin.errors import PluginNotImplementedError
from constants.end_user_connections import ConnectionCredentialType
from core.entities.provider_entities import ProviderConfigType
from core.helper.encrypter import decrypt_token, encrypt_token
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.exc import PluginDaemonError
from core.tools.errors import ToolProviderCredentialValidationError, ToolProviderNotFoundError
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_manager import ToolManager
from models.provider_ids import ToolProviderID
from services.end_user_connections.contracts import ConnectionTargetInput
from services.end_user_connections.entities import ToolConnectionTarget, WebConnectionContext
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConfigurationError,
    ConnectionInvalidCredentialsError,
    ConnectionSecretUnavailableError,
)
from services.workflow.tool_credentials import ToolCredentialConfig, check_tool_credentials


class ConnectionWorkflowQuery(Protocol):
    def published_graph(self, context: WebConnectionContext, workflow_id: str) -> Mapping[str, Any]: ...


class TenantConnectionCipher:
    def encrypt(self, tenant_id: str, credentials: Mapping[str, Any]) -> str:
        try:
            return encrypt_token(tenant_id, json.dumps(dict(credentials), separators=(",", ":")))
        except Exception:
            raise ConnectionSecretUnavailableError() from None

    def decrypt(self, tenant_id: str, ciphertext: str) -> dict[str, Any]:
        try:
            value = json.loads(decrypt_token(tenant_id, ciphertext))
            if not isinstance(value, dict):
                raise ValueError("Invalid credential payload")
            return value
        except Exception:
            raise ConnectionSecretUnavailableError() from None


class PluginApiKeyCredentialGateway:
    def __init__(self, *, auth: PluginCredentialAuthClient) -> None:
        self._auth = auth

    def provider(self, tenant_id: str, provider: str) -> PluginToolProviderController:
        try:
            controller = ToolManager.get_builtin_provider(provider, tenant_id)
        except (ToolProviderNotFoundError, KeyError, ValueError):
            raise ConnectionConfigurationError() from None
        except (PluginDaemonError, httpx.HTTPError):
            raise ConnectionCheckUnavailableError() from None
        if not isinstance(controller, PluginToolProviderController) or controller.tenant_id != tenant_id:
            raise ConnectionConfigurationError()
        try:
            resolved = ToolProviderID(controller.entity.identity.name)
            if str(resolved) != str(ToolProviderID(provider)) or resolved.plugin_id != controller.plugin_id:
                raise ConnectionConfigurationError()
        except ValueError:
            raise ConnectionConfigurationError() from None
        if CredentialType.API_KEY not in controller.get_supported_credential_types():
            raise ConnectionConfigurationError()
        return controller

    def validate_format(self, tenant_id: str, provider: str, credentials: Mapping[str, Any]) -> dict[str, Any]:
        controller = self.provider(tenant_id, provider)
        normalized = deepcopy(dict(credentials))
        try:
            controller.validate_credentials_format(normalized)
            for config in controller.get_credentials_schema_by_type(CredentialType.API_KEY):
                value = normalized.get(config.name)
                if config.required and (value is None or value == ""):
                    raise ConnectionInvalidCredentialsError()
                if config.type == ProviderConfigType.BOOLEAN and value is not None and not isinstance(value, bool):
                    raise ConnectionInvalidCredentialsError()
                if (
                    config.type == ProviderConfigType.SECRET_INPUT
                    and isinstance(value, str)
                    and value
                    and set(value) == {"*"}
                ):
                    raise ConnectionInvalidCredentialsError()
        except ToolProviderCredentialValidationError:
            raise ConnectionInvalidCredentialsError() from None
        return normalized

    def check(
        self, context: WebConnectionContext, provider: str, credentials: Mapping[str, Any]
    ) -> CredentialCheckResult:
        controller = self.provider(context.tenant_id, provider)
        canonical = str(ToolProviderID(controller.entity.identity.name))
        try:
            return self._auth.check_provider_credentials(
                tenant_id=context.tenant_id,
                user_id=context.end_user_id,
                provider=canonical,
                credentials=credentials,
                credential_type=CredentialType.API_KEY,
            )
        except PluginNotImplementedError:
            return CredentialCheckResult(
                status="unsupported", reason_code=None, retryable=False, checked_at=int(time.time())
            )
        except (PluginDaemonError, httpx.HTTPError):
            return CredentialCheckResult(
                status="temporarily_unavailable",
                reason_code="provider_unavailable",
                retryable=True,
                checked_at=int(time.time()),
            )


class ApiKeyConnectionTargetResolver:
    def __init__(self, *, workflows: ConnectionWorkflowQuery, providers: PluginApiKeyCredentialGateway) -> None:
        self._workflows = workflows
        self._providers = providers

    def resolve(self, context: WebConnectionContext, reference: ConnectionTargetInput) -> ToolConnectionTarget:
        graph = self._workflows.published_graph(context, str(reference.workflow_id))
        try:
            if check_tool_credentials(graph, complete=True):
                raise ConnectionConfigurationError()
            nodes = {
                node["id"]: node["data"]
                for node in graph.get("nodes", [])
                if isinstance(node, Mapping)
                and isinstance(node.get("data"), Mapping)
                and node.get("type") != "custom-note"
            }
            data = nodes[reference.node_id]
            if data.get("type") != "tool":
                raise ConnectionConfigurationError()
            config = ToolCredentialConfig.model_validate(data)
            if config.credential_source == "reuse_node":
                data = nodes[config.reuse_node_id]
                config = ToolCredentialConfig.model_validate(data)
            if config.credential_source != "end_user" or config.end_user_auth is None:
                raise ConnectionConfigurationError()
            provider = self._providers.provider(context.tenant_id, data["provider_id"])
            provider.get_tool(data["tool_name"])
        except (KeyError, ValueError, ValidationError, TypeError):
            raise ConnectionConfigurationError() from None
        canonical = str(ToolProviderID(provider.entity.identity.name))
        return ToolConnectionTarget(
            tenant_id=context.tenant_id,
            app_id=context.app_id,
            workflow_id=str(reference.workflow_id),
            node_id=reference.node_id,
            provider=canonical,
            allowed_credential_types=frozenset(
                ConnectionCredentialType(value) for value in config.end_user_auth.allowed_credential_types or ()
            ),
            provider_credential_types=frozenset(
                ConnectionCredentialType(value.value)
                for value in provider.get_supported_credential_types()
                if value in (CredentialType.API_KEY, CredentialType.OAUTH2)
            ),
            # OAuth Client resolution joins the OAuth vertical slice; this resolver creates API keys only.
            oauth_client=None,
        )
