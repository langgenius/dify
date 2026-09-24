from inspect import unwrap
from unittest.mock import patch

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.console.workspace.agent_providers import (
    AgentProviderApi,
    AgentProviderListApi,
    AgentProviderListResponse,
    AgentProviderResponse,
)
from core.agent.plugin_entities import AgentStrategyParameter
from core.plugin.entities.plugin_daemon import PluginAgentProviderEntity
from core.plugin.impl.exc import PluginNotFoundError
from models.account import Account
from tests.unit_tests.model_factories import make_account


def _account() -> Account:
    return make_account(account_id="user1", name="Agent Provider Tester", email="agent-provider@example.com")


def _provider() -> PluginAgentProviderEntity:
    return PluginAgentProviderEntity.model_validate(
        {
            "provider": "agent",
            "plugin_id": "langgenius/agent",
            "plugin_unique_identifier": "langgenius/agent:0.0.2@checksum",
            "meta": {},
            "declaration": {
                "identity": {
                    "author": "langgenius",
                    "name": "langgenius/agent/agent",
                    "label": {"en_US": "Agent"},
                    "description": {"en_US": "Agent strategies"},
                    "icon": "icon.svg",
                },
                "strategies": [
                    {
                        "identity": {
                            "author": "langgenius",
                            "name": "reasoning",
                            "provider": "langgenius/agent/agent",
                            "label": {"en_US": "Reasoning"},
                        },
                        "description": {"en_US": "Reason with tools"},
                        "parameters": [
                            {"name": "tools", "type": "array[tools]", "label": {"en_US": "Tools"}},
                            {"name": "limit", "type": "number", "label": {"en_US": "Limit"}, "default": 0},
                            {"name": "enabled", "type": "boolean", "label": {"en_US": "Enabled"}, "default": False},
                        ],
                    }
                ],
            },
        }
    )


class TestAgentProviderListApi:
    def test_get_success(self, app: Flask) -> None:
        api = AgentProviderListApi()
        method = unwrap(api.get)

        user = _account()
        tenant_id = "tenant1"
        provider = _provider()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.agent_providers.AgentService.list_agent_providers",
                return_value=[provider],
            ) as list_providers,
        ):
            result = method(api, tenant_id, user)

        assert result == [provider.model_dump(mode="json")]
        assert result[0]["declaration"]["identity"]["name"] == "langgenius/agent/agent"
        list_providers.assert_called_once_with(user.id, tenant_id)

    def test_get_empty_list(self, app: Flask) -> None:
        api = AgentProviderListApi()
        method = unwrap(api.get)

        user = _account()
        tenant_id = "tenant1"

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.agent_providers.AgentService.list_agent_providers",
                return_value=[],
            ),
        ):
            result = method(api, tenant_id, user)

        assert result == []


class TestAgentProviderApi:
    def test_get_success(self, app: Flask) -> None:
        api = AgentProviderApi()
        method = unwrap(api.get)

        user = _account()
        tenant_id = "tenant1"
        provider_name = "langgenius/agent/agent"
        provider = _provider()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.agent_providers.AgentService.get_agent_provider",
                return_value=provider,
            ) as get_provider,
        ):
            result = method(api, tenant_id, user, provider_name)

        assert result == provider.model_dump(mode="json")
        assert result["meta"]["version"] is None
        strategy = result["declaration"]["strategies"][0]
        assert strategy["identity"]["provider"] == provider_name
        assert strategy["identity"]["icon"] is None
        assert strategy["features"] is None
        assert strategy["output_schema"] is None
        assert strategy["parameters"][0]["type"] == "array[tools]"
        assert strategy["parameters"][1]["default"] == 0
        assert strategy["parameters"][2]["default"] is False
        get_provider.assert_called_once_with(user.id, tenant_id, provider_name)

    def test_get_provider_not_found(self, app: Flask) -> None:
        api = AgentProviderApi()
        method = unwrap(api.get)

        user = _account()
        tenant_id = "tenant1"
        provider_name = "langgenius/missing/agent"

        with (
            app.test_request_context("/"),
            patch(
                "services.agent_service.PluginAgentClient.fetch_agent_strategy_provider",
                side_effect=PluginNotFoundError("Agent provider is not installed"),
            ),
        ):
            with pytest.raises(ValueError, match="Agent provider is not installed"):
                method(api, tenant_id, user, provider_name)


class TestAgentProviderResponseContract:
    def test_list_and_detail_share_the_plugin_declaration_schema(self) -> None:
        schema = AgentProviderListResponse.model_json_schema(mode="serialization")

        assert schema["type"] == "array"
        assert schema["items"] == {"$ref": "#/$defs/AgentProviderResponse"}
        declaration_schema = schema["$defs"]["AgentProviderResponse"]["properties"]["declaration"]
        assert declaration_schema == {"$ref": "#/$defs/AgentProviderEntityWithPlugin"}
        assert schema["$defs"]["AgentStrategyParameterType"]["enum"] == [
            value.value for value in AgentStrategyParameter.AgentStrategyParameterType
        ]

    def test_response_rejects_unsupported_single_tool_parameters(self) -> None:
        provider_data = _provider().model_dump(mode="json")
        provider_data["declaration"]["strategies"][0]["parameters"][0]["type"] = "tool-selector"

        with pytest.raises(ValidationError, match="array\\[tools\\]"):
            AgentProviderResponse.model_validate(provider_data)
