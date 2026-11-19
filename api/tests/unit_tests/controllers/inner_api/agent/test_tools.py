"""Unit tests for the Agent tool inner API controller."""

from collections.abc import Generator
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from redis.exceptions import LockNotOwnedError, RedisError
from redis.lock import Lock
from sqlalchemy.orm import Session

from controllers.inner_api import bp as inner_api_bp
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.entities.tool_entities import ToolProviderEntityWithPlugin
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_manager import ToolManager
from extensions.application_services.tools import resolve_tool_credentials
from extensions.ext_redis import RedisClientWrapper
from models.model import App, AppMode
from models.tools import BuiltinToolProvider
from services.credentials.refresh import CredentialRefreshUnavailableError
from services.credentials.tool_runtime import ToolCredentialRefreshError
from services.credentials.tool_runtime_adapters import ProviderToolCredentialRuntime
from services.entities.agent_tool_inner import AgentToolInvokeResponse
from services.errors.agent_tool_inner import AgentToolInnerServiceError
from tests.helpers.unit.config_override import config_overrides_context


def _headers(api_key: str | None = "inner-key") -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if api_key is not None:
        headers["X-Inner-Api-Key"] = api_key
    return headers


def _payload(*, provider_type: str = "plugin", credential_id: str | None = "credential-1") -> dict[str, object]:
    return {
        "caller": {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "user_from": "account",
            "app_id": "app-1",
            "invoke_from": "service-api",
            "conversation_id": "conversation-1",
            "workflow_id": "workflow-1",
            "workflow_run_id": "workflow-run-1",
            "node_id": "node-1",
            "node_execution_id": "node-exec-1",
            "agent_id": "agent-1",
            "agent_config_version_id": "snapshot-1",
        },
        "tool": {
            "provider_type": provider_type,
            "provider_id": "langgenius/search/search",
            "tool_name": "search",
            "credential_id": credential_id,
            "tool_parameters": {"query": "dify"},
            "runtime_parameters": {"region": "us"},
        },
    }


@contextmanager
def _agent_inner_auth() -> Generator[None]:
    with (
        config_overrides_context(PLUGIN_DAEMON_KEY="plugin-daemon-key", INNER_API_KEY_FOR_PLUGIN="inner-key"),
    ):
        yield


def test_post_returns_service_response() -> None:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(inner_api_bp)

    with (
        _agent_inner_auth(),
        patch("controllers.inner_api.agent.tools.AgentToolInnerService.invoke") as mock_invoke,
    ):
        mock_invoke.return_value = AgentToolInvokeResponse(
            messages=[{"type": "text", "message": {"text": "ok"}}],
            observation="ok",
            metadata={"provider_type": "plugin", "tool_name": "search"},
        )

        response = app.test_client().post(
            "/inner/api/agent/tools/invoke",
            json=_payload(),
            headers=_headers(),
        )

    assert response.status_code == 200
    body = response.get_json()
    assert body["observation"] == "ok"
    assert body["metadata"]["provider_type"] == "plugin"


def test_post_returns_400_for_invalid_body() -> None:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(inner_api_bp)

    with _agent_inner_auth():
        response = app.test_client().post(
            "/inner/api/agent/tools/invoke",
            json={"caller": {}},
            headers=_headers(),
        )

    assert response.status_code == 400
    body = response.get_json()
    assert body["code"] == "invalid_request"


def test_post_preserves_service_error_status_code_and_description() -> None:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(inner_api_bp)

    with (
        _agent_inner_auth(),
        patch("controllers.inner_api.agent.tools.AgentToolInnerService.invoke") as mock_invoke,
    ):
        mock_invoke.side_effect = AgentToolInnerServiceError(
            error_code="app_tenant_mismatch",
            description="App does not belong to the caller tenant.",
            status_code=403,
        )
        response = app.test_client().post(
            "/inner/api/agent/tools/invoke",
            json=_payload(),
            headers=_headers(),
        )

    assert response.status_code == 403
    body = response.get_json()
    assert body["code"] == "app_tenant_mismatch"
    assert body["message"] == "App does not belong to the caller tenant."


@pytest.mark.parametrize("credential_id", [None, "1a1db43c-e9d8-4ef2-af8f-38b25424a4ad"])
@pytest.mark.parametrize("failure", ["busy", "redis", "lost", "rejected"])
def test_post_preserves_refresh_error_classification_through_real_credential_resolution(
    sqlite_session: Session,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
    credential_id: str | None,
    failure: str,
) -> None:
    provider_id = "langgenius/search/search"
    credential = BuiltinToolProvider(
        tenant_id="tenant-1",
        user_id="user-1",
        provider=provider_id,
        name="Search",
        credential_type=CredentialType.OAUTH2,
        encrypted_credentials="{}",
        expires_at=1,
        is_default=True,
    )
    credential.id = "1a1db43c-e9d8-4ef2-af8f-38b25424a4ad"
    sqlite_session.add_all(
        [
            App(
                id="app-1",
                tenant_id="tenant-1",
                name="Agent",
                mode=AppMode.AGENT_CHAT,
                enable_site=False,
                enable_api=False,
                max_active_requests=None,
            ),
            credential,
        ]
    )
    sqlite_session.commit()
    controller = PluginToolProviderController(
        entity=ToolProviderEntityWithPlugin.model_validate(
            {
                "identity": {
                    "author": "langgenius",
                    "name": "search",
                    "description": {"en_US": "Search"},
                    "icon": "search.svg",
                    "label": {"en_US": "Search"},
                },
                "oauth_schema": {
                    "client_schema": [],
                    "credentials_schema": [
                        {"name": "access_token", "type": "secret-input", "label": {"en_US": "Access token"}}
                    ],
                },
                "tools": [
                    {
                        "identity": {
                            "author": "langgenius",
                            "name": "search",
                            "provider": "search",
                            "label": {"en_US": "Search"},
                        },
                        "description": {"human": {"en_US": "Search"}, "llm": "Search"},
                        "parameters": [],
                    }
                ],
            }
        ),
        plugin_id="langgenius/search",
        plugin_unique_identifier="langgenius/search:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        tenant_id="tenant-1",
    )
    redis, _ = redis_transport
    monkeypatch.setattr("extensions.application_services.tools.redis_client", redis)
    monkeypatch.setattr("core.helper.provider_cache.redis_client", redis)
    monkeypatch.setattr(ToolManager, "_credential_resolver", resolve_tool_credentials)
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(inner_api_bp)
    rejected = ToolCredentialRefreshError("OAuth credential was rejected. Reauthorize the provider.")

    with (
        _agent_inner_auth(),
        patch.object(ToolManager, "get_builtin_provider", return_value=controller),
        patch("core.helper.credential_utils.check_credential_policy_compliance"),
        patch.object(
            Lock,
            "acquire",
            return_value=failure != "busy",
            side_effect=RedisError("unavailable") if failure == "redis" else None,
        ),
        patch.object(Lock, "reacquire", side_effect=LockNotOwnedError("expired") if failure == "lost" else None),
        patch.object(Lock, "release"),
        patch.object(ProviderToolCredentialRuntime, "refresh", side_effect=rejected) as refresh,
    ):
        response = app.test_client().post(
            "/inner/api/agent/tools/invoke",
            json=_payload(provider_type="builtin", credential_id=credential_id),
            headers=_headers(),
        )

    expected_status = 422 if failure == "rejected" else 503
    assert response.status_code == expected_status
    assert response.get_json() == {
        "code": "agent_tool_credential_invalid" if failure == "rejected" else "service_unavailable",
        "message": str(rejected) if failure == "rejected" else str(CredentialRefreshUnavailableError()),
        "status": expected_status,
    }
    assert refresh.call_count == (1 if failure == "rejected" else 0)
    sqlite_session.refresh(credential)
    assert credential.encrypted_credentials == "{}"
    assert credential.expires_at == 1
