"""Unit tests for the Agent App runtime request builder + the app-shaped
``AgentBackendRunRequestBuilder.build_for_agent_app`` DTO assembler."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig

from clients.agent_backend import (
    AgentBackendAgentAppRunInput,
    AgentBackendModelConfig,
    AgentBackendRunRequestBuilder,
)
from core.app.apps.agent_app.runtime_request_builder import (
    AgentAppRuntimeBuildContext,
    AgentAppRuntimeRequestBuilder,
    AgentAppRuntimeRequestBuildError,
)
from core.app.entities.app_invoke_entities import InvokeFrom
from models.agent_config_entities import AgentSoulConfig


def _exec_ctx() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(tenant_id="tenant-1", invoke_from="agent_app")


class TestBuildForAgentApp:
    def test_layers_have_no_workflow_job_prompt_and_include_history(self):
        request = AgentBackendRunRequestBuilder().build_for_agent_app(
            AgentBackendAgentAppRunInput(
                model=AgentBackendModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="gpt-test"),
                execution_context=_exec_ctx(),
                user_prompt="hello",
                agent_soul_prompt="You are Iris.",
            )
        )
        names = [layer.name for layer in request.composition.layers]
        assert names == [
            "agent_soul_prompt",
            "agent_app_user_prompt",
            "execution_context",
            "history",
            "llm",
        ]
        assert "workflow_node_job_prompt" not in names
        assert request.purpose == "agent_app"
        # Agent App keeps layers alive across turns by default.
        assert request.on_exit.default.value == "suspend"

    def test_blank_user_prompt_rejected(self):
        with pytest.raises(ValueError, match="must not be blank"):
            AgentBackendAgentAppRunInput(
                model=AgentBackendModelConfig(plugin_id="p/q", model_provider="openai", model="m"),
                execution_context=_exec_ctx(),
                user_prompt="   ",
            )

    def test_soul_prompt_optional(self):
        request = AgentBackendRunRequestBuilder().build_for_agent_app(
            AgentBackendAgentAppRunInput(
                model=AgentBackendModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="gpt-test"),
                execution_context=_exec_ctx(),
                user_prompt="hi",
            )
        )
        assert [layer.name for layer in request.composition.layers][0] == "agent_app_user_prompt"


class _FakeCredentialsProvider:
    def fetch(self, provider_name: str, model_name: str) -> dict[str, Any]:
        return {"openai_api_key": "sk-test", "max": 5}


class _NoToolsBuilder:
    def build(self, **kwargs):
        del kwargs


def _ctx(soul: AgentSoulConfig, *, query: str = "hello") -> AgentAppRuntimeBuildContext:
    dify_context = SimpleNamespace(
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="user-1",
        invoke_from=InvokeFrom.WEB_APP,
    )
    return AgentAppRuntimeBuildContext(
        dify_context=dify_context,  # type: ignore[arg-type]
        agent_id="agent-1",
        agent_config_snapshot_id="snap-1",
        agent_soul=soul,
        conversation_id="conv-1",
        user_query=query,
        idempotency_key="msg-1",
    )


def _soul_with_model() -> AgentSoulConfig:
    return AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "langgenius/openai/openai",
                "model": "gpt-4o-mini",
            },
            "prompt": {"system_prompt": "You are Iris."},
        }
    )


class TestAgentAppRuntimeRequestBuilder:
    def test_build_maps_soul_to_run_request(self):
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            plugin_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )
        result = builder.build(_ctx(_soul_with_model()))

        req = result.request
        assert req.purpose == "agent_app"
        names = [layer.name for layer in req.composition.layers]
        assert names == ["agent_soul_prompt", "agent_app_user_prompt", "execution_context", "history", "llm"]
        # plugin_id / provider normalized for plugin-daemon transport.
        llm = next(layer for layer in req.composition.layers if layer.name == "llm")
        assert llm.config.plugin_id == "langgenius/openai"
        assert llm.config.model_provider == "openai"
        # execution context carries conversation + agent_app invoke source.
        exec_ctx = next(layer for layer in req.composition.layers if layer.name == "execution_context")
        assert exec_ctx.config.conversation_id == "conv-1"
        assert exec_ctx.config.invoke_from == "agent_app"
        # credentials are redacted in the log-safe view.
        assert result.redacted_request["composition"]["layers"][-1]["config"]["credentials"] == "[REDACTED]"
        assert result.metadata["conversation_id"] == "conv-1"

    def test_build_raises_when_model_missing(self):
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            plugin_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )
        with pytest.raises(AgentAppRuntimeRequestBuildError) as exc:
            builder.build(_ctx(AgentSoulConfig()))
        assert exc.value.error_code == "agent_model_not_configured"
