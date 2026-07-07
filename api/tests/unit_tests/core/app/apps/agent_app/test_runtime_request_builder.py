"""Unit tests for the Agent App runtime request builder + the app-shaped
``AgentBackendRunRequestBuilder.build_for_agent_app`` DTO assembler."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from dify_agent.layers.dify_core_tools import DifyCoreToolConfig, DifyCoreToolsLayerConfig
from dify_agent.layers.dify_plugin import DifyPluginToolConfig, DifyPluginToolsLayerConfig
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig

from clients.agent_backend import (
    DIFY_CONFIG_LAYER_ID,
    DIFY_CORE_TOOLS_LAYER_ID,
    DIFY_PLUGIN_TOOLS_LAYER_ID,
    AgentBackendAgentAppRunInput,
    AgentBackendModelConfig,
    AgentBackendRunRequestBuilder,
)
from clients.agent_backend.request_builder import DIFY_SHELL_LAYER_ID
from core.app.apps.agent_app.runtime_request_builder import (
    AgentAppRuntimeBuildContext,
    AgentAppRuntimeRequestBuilder,
    AgentAppRuntimeRequestBuildError,
)
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from models.agent_config_entities import AgentSoulConfig


def _exec_ctx() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_from="end-user",
        invoke_from="web-app",
        agent_mode="agent_app",
    )


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
    def build_layers(self, **kwargs):
        del kwargs
        return SimpleNamespace(plugin_tools=None, core_tools=None, exposed_tool_names=lambda: [])


class _PluginLayerBuilder:
    def build_layers(self, **kwargs):
        return SimpleNamespace(
            plugin_tools=DifyPluginToolsLayerConfig(
                tools=[
                    DifyPluginToolConfig(
                        plugin_id="langgenius/time",
                        provider="time",
                        tool_name="current_time",
                        credential_type="unauthorized",
                        name="current_time",
                        description="Get current time.",
                        credentials={},
                        runtime_parameters={},
                        parameters=[],
                        parameters_json_schema={"type": "object", "properties": {}, "required": []},
                    )
                ]
            ),
            core_tools=None,
            exposed_tool_names=lambda: ["current_time"],
        )


class _CoreLayerBuilder:
    def build_layers(self, **kwargs):
        del kwargs
        return SimpleNamespace(
            plugin_tools=None,
            core_tools=DifyCoreToolsLayerConfig(
                tools=[
                    DifyCoreToolConfig(
                        provider_type="builtin",
                        provider_id="audio",
                        tool_name="transcribe",
                        name="transcribe",
                        description="Transcribe audio.",
                        runtime_parameters={},
                        parameters=[],
                        parameters_json_schema={"type": "object", "properties": {}, "required": []},
                    )
                ]
            ),
            exposed_tool_names=lambda: ["transcribe"],
        )


def _ctx(
    soul: AgentSoulConfig,
    *,
    query: str = "hello",
    agent_config_version_kind: str = "snapshot",
    suspend_on_exit: bool = True,
) -> AgentAppRuntimeBuildContext:
    dify_context = SimpleNamespace(
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="user-1",
        user_from=UserFrom.END_USER,
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
        agent_config_version_kind=agent_config_version_kind,  # type: ignore[arg-type]
        suspend_on_exit=suspend_on_exit,
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
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )
        result = builder.build(_ctx(_soul_with_model()))

        req = result.request
        assert req.purpose == "agent_app"
        names = [layer.name for layer in req.composition.layers]
        assert names == [
            "agent_soul_prompt",
            "agent_app_user_prompt",
            "execution_context",
            DIFY_SHELL_LAYER_ID,
            DIFY_CONFIG_LAYER_ID,
            "history",
            "llm",
        ]
        # plugin_id / provider normalized for plugin-daemon transport.
        llm = next(layer for layer in req.composition.layers if layer.name == "llm")
        assert llm.config.plugin_id == "langgenius/openai"
        assert llm.config.model_provider == "openai"
        # execution context carries conversation + agent_app invoke source.
        exec_ctx = next(layer for layer in req.composition.layers if layer.name == "execution_context")
        assert exec_ctx.config.conversation_id == "conv-1"
        # Real Dify access context forwarded; agent run mode in agent_mode.
        assert exec_ctx.config.user_from == "end-user"
        assert exec_ctx.config.invoke_from == "web-app"
        assert exec_ctx.config.agent_mode == "agent_app"
        assert req.on_exit.default.value == "suspend"
        # credentials are redacted in the log-safe view.
        assert result.redacted_request["composition"]["layers"][-1]["config"]["credentials"] == "[REDACTED]"
        assert result.metadata["conversation_id"] == "conv-1"

    def test_build_wraps_agent_soul_prompt_for_build_draft(self):
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(_soul_with_model(), agent_config_version_kind="build_draft"))

        prompt_layer = next(layer for layer in result.request.composition.layers if layer.name == "agent_soul_prompt")
        assert prompt_layer.config.prefix == (
            "Your current job is to prepare the agent's working environment, configuration, tools, and context "
            "so future runs can complete the task below smoothly. Do not perform the task itself yet.\n\n"
            "```text\nYou are Iris.\n```"
        )

    def test_build_propagates_draft_version_kind_without_wrapping_prompt(self):
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(_soul_with_model(), agent_config_version_kind="draft"))

        prompt_layer = next(layer for layer in result.request.composition.layers if layer.name == "agent_soul_prompt")
        execution_context = next(layer for layer in result.request.composition.layers if layer.name == "execution_context")
        config_layer = next(layer for layer in result.request.composition.layers if layer.name == DIFY_CONFIG_LAYER_ID)

        assert prompt_layer.config.prefix == "You are Iris."
        assert execution_context.config.agent_config_version_kind == "draft"
        assert config_layer.config.config_version.kind == "draft"

    def test_build_uses_delete_on_exit_when_requested(self):
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(_soul_with_model(), suspend_on_exit=False))

        assert result.request.on_exit.default.value == "delete"

    def test_build_includes_plugin_tools_layer_returned_by_injected_builder_for_draft(self):
        soul = _soul_with_model()
        soul.tools.dify_tools = [
            {
                "provider_type": "plugin",
                "provider_id": "langgenius/time/time",
                "tool_name": "current_time",
            }
        ]
        tools_builder = _PluginLayerBuilder()
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=tools_builder,  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(soul, agent_config_version_kind="draft"))

        names = [layer.name for layer in result.request.composition.layers]
        assert DIFY_PLUGIN_TOOLS_LAYER_ID in names
        assert DIFY_CORE_TOOLS_LAYER_ID not in names

    def test_build_includes_plugin_tools_layer_returned_by_injected_builder_for_snapshot(self):
        soul = _soul_with_model()
        soul.tools.dify_tools = [
            {
                "provider_type": "plugin",
                "provider_id": "langgenius/time/time",
                "tool_name": "current_time",
            }
        ]
        tools_builder = _PluginLayerBuilder()
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=tools_builder,  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(soul, agent_config_version_kind="snapshot"))

        names = [layer.name for layer in result.request.composition.layers]
        assert DIFY_PLUGIN_TOOLS_LAYER_ID in names
        assert DIFY_CORE_TOOLS_LAYER_ID not in names

    def test_build_includes_core_tools_layer_returned_by_injected_builder(self):
        soul = _soul_with_model()
        soul.tools.dify_tools = [
            {
                "provider_type": "builtin",
                "provider_id": "audio",
                "tool_name": "transcribe",
            }
        ]
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=_CoreLayerBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(soul))

        names = [layer.name for layer in result.request.composition.layers]
        assert DIFY_CORE_TOOLS_LAYER_ID in names
        assert DIFY_PLUGIN_TOOLS_LAYER_ID not in names

    def test_build_normalizes_marketplace_model_plugin_id(self):
        soul = _soul_with_model()
        soul.model.plugin_id = (
            "langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468"
        )
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(soul))

        llm = next(layer for layer in result.request.composition.layers if layer.name == "llm")
        assert llm.config.plugin_id == "langgenius/openai"
        assert llm.config.model_provider == "openai"

    def test_build_maps_agent_soul_knowledge_to_knowledge_layer(self):
        soul = AgentSoulConfig.model_validate(
            {
                "model": {
                    "plugin_id": "langgenius/openai",
                    "model_provider": "langgenius/openai/openai",
                    "model": "gpt-4o-mini",
                },
                "knowledge": {
                    "sets": [
                        {
                            "id": "support",
                            "name": "Support KB",
                            "datasets": [{"id": "dataset-1"}, {"id": "dataset-2"}],
                            "query": {"mode": "generated_query"},
                            "retrieval": {
                                "mode": "multiple",
                                "top_k": 3,
                                "score_threshold": None,
                            },
                        }
                    ],
                },
            }
        )
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(soul))

        knowledge = next(layer for layer in result.request.composition.layers if layer.name == "knowledge")
        assert knowledge.type == "dify.knowledge_base"
        assert knowledge.deps == {"execution_context": "execution_context"}
        dumped_config = knowledge.config.model_dump(mode="json", by_alias=True)
        knowledge_set = dumped_config["sets"][0]
        assert [dataset["id"] for dataset in knowledge_set["datasets"]] == ["dataset-1", "dataset-2"]
        assert knowledge_set["query"] == {"mode": "generated_query", "value": None}
        assert knowledge_set["retrieval"]["mode"] == "multiple"
        assert knowledge_set["retrieval"]["top_k"] == 3
        assert knowledge_set["retrieval"]["score_threshold"] == 0.0

    def test_build_raises_when_model_missing(self):
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )
        with pytest.raises(AgentAppRuntimeRequestBuildError) as exc:
            builder.build(_ctx(AgentSoulConfig()))
        assert exc.value.error_code == "agent_model_not_configured"

    def test_build_maps_agent_soul_shell_settings_to_shell_layer(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr("core.app.apps.agent_app.runtime_request_builder.dify_config.AGENT_SHELL_ENABLED", True)
        soul = AgentSoulConfig.model_validate(
            {
                "model": {
                    "plugin_id": "langgenius/openai",
                    "model_provider": "langgenius/openai/openai",
                    "model": "gpt-4o-mini",
                },
                "tools": {"cli_tools": [{"name": "ripgrep", "install_command": "apt-get install -y ripgrep"}]},
                "env": {"variables": [{"name": "PROJECT_NAME", "value": "demo"}]},
                "sandbox": {"provider": "independent", "config": {"cpu": 2}},
            }
        )
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(soul))

        dumped = result.request.model_dump(mode="json")
        shell_config = {layer["name"]: layer for layer in dumped["composition"]["layers"]}[DIFY_SHELL_LAYER_ID][
            "config"
        ]
        assert shell_config["cli_tools"][0]["install_commands"] == ["apt-get install -y ripgrep"]
        assert shell_config["env"][0] == {"name": "PROJECT_NAME", "value": "demo"}
        assert shell_config["sandbox"] == {"provider": "independent", "config": {"cpu": 2}}
        assert result.metadata["agent_tools"] == {
            "dify_tool_count": 0,
            "dify_tool_names": [],
            "cli_tool_count": 1,
        }


# ── Agent config layer declaration on the Agent App surface ──────────────────


def _soul_with_model_and_skill() -> AgentSoulConfig:
    return AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "langgenius/openai/openai",
                "model": "gpt-4o-mini",
            },
            "prompt": {"system_prompt": "Use [§skill:tender-analyzer:Tender Analyzer§]"},
            "config_skills": [{"name": "tender-analyzer", "description": "Parses RFPs.", "file_id": "tool-file-1"}],
            "config_files": [{"name": "sample.pdf", "file_kind": "upload_file", "file_id": "upload-file-1"}],
            "config_note": "Read the proposal first.",
        }
    )


class TestAgentAppConfigLayer:
    def test_config_layer_injected(self):
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(_soul_with_model_and_skill()))

        config = next(layer for layer in result.request.composition.layers if layer.name == DIFY_CONFIG_LAYER_ID)
        assert config.type == "dify.config"
        assert config.deps == {"shell": DIFY_SHELL_LAYER_ID}
        assert config.config.agent_id == "agent-1"
        assert config.config.config_version is not None
        assert config.config.config_version.id == "snap-1"
        assert config.config.config_version.kind == "snapshot"
        assert config.config.config_version.writable is False
        assert [skill.name for skill in config.config.skills] == ["tender-analyzer"]
        assert [file_ref.name for file_ref in config.config.files] == ["sample.pdf"]
        assert config.config.note == "Read the proposal first."
        assert config.config.mentioned_skill_names == ["tender-analyzer"]
        assert config.config.mentioned_file_names == []
        # shell enters first; config uses that shell to materialize mentioned targets.
        names = [layer.name for layer in result.request.composition.layers]
        assert names.index(DIFY_SHELL_LAYER_ID) == names.index("execution_context") + 1
        assert names.index(DIFY_CONFIG_LAYER_ID) == names.index(DIFY_SHELL_LAYER_ID) + 1

    def test_config_layer_present_when_agent_soul_has_no_config_assets(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr("core.app.apps.agent_app.runtime_request_builder.dify_config.AGENT_SHELL_ENABLED", True)
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(_soul_with_model()))

        layers = {layer.name: layer for layer in result.request.composition.layers}
        assert layers[DIFY_CONFIG_LAYER_ID].config.model_dump(mode="json") == {
            "agent_id": "agent-1",
            "config_version": {"id": "snap-1", "kind": "snapshot", "writable": False},
            "skills": [],
            "files": [],
            "env_keys": [],
            "note": "",
            "mentioned_skill_names": [],
            "mentioned_file_names": [],
        }
        assert layers[DIFY_SHELL_LAYER_ID].deps == {"execution_context": "execution_context"}
        assert layers[DIFY_SHELL_LAYER_ID].config.agent_stub_drive_ref is None

    def test_config_layer_for_build_draft_marks_config_writable(self):
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(_soul_with_model_and_skill(), agent_config_version_kind="build_draft"))

        config = next(layer for layer in result.request.composition.layers if layer.name == DIFY_CONFIG_LAYER_ID)
        assert config.config.model_dump(mode="json") == {
            "agent_id": "agent-1",
            "config_version": {"id": "snap-1", "kind": "build_draft", "writable": True},
            "skills": [
                {
                    "name": "tender-analyzer",
                    "description": "Parses RFPs.",
                    "size": None,
                    "mime_type": "application/zip",
                }
            ],
            "files": [{"name": "sample.pdf", "size": None, "mime_type": None}],
            "env_keys": [],
            "note": "Read the proposal first.",
            "mentioned_skill_names": ["tender-analyzer"],
            "mentioned_file_names": [],
        }

    @pytest.mark.parametrize(
        ("system_prompt", "expected_prefix"),
        [
            (
                "Use [§skill:tender-analyzer:Tender Analyzer§] and [§file:sample.pdf:sample.pdf§].",
                "Use tender-analyzer and sample.pdf.",
            ),
            (
                "Use [§skill:tender-analyzer:Tender Analyzer§] and [§file:sample.pdf:sample.pdf§]",
                "Use tender-analyzer and sample.pdf",
            ),
        ],
    )
    def test_agent_app_runtime_expands_config_mentions_in_agent_soul_prompt(
        self,
        system_prompt: str,
        expected_prefix: str,
    ):
        soul = _soul_with_model_and_skill()
        soul.prompt.system_prompt = system_prompt
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(soul))

        prompt_layer = next(layer for layer in result.request.composition.layers if layer.name == "agent_soul_prompt")
        assert prompt_layer.config.prefix == expected_prefix
        assert "[§" not in prompt_layer.config.prefix

    def test_agent_app_runtime_missing_config_mentions_fall_back_without_marker_leak(
        self,
    ):
        soul = _soul_with_model()
        soul.prompt.system_prompt = (
            "Use [§skill:ghost-skill:Ghost Skill§], [§file:ghost.txt:Ghost File§], and [§file:no-label.txt§]."
        )
        builder = AgentAppRuntimeRequestBuilder(
            credentials_provider=_FakeCredentialsProvider(),
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(soul))

        prompt_layer = next(layer for layer in result.request.composition.layers if layer.name == "agent_soul_prompt")
        assert prompt_layer.config.prefix == "Use Ghost Skill, Ghost File, and no-label.txt."
        assert "[§" not in prompt_layer.config.prefix
        assert [warning["code"] for warning in result.metadata["runtime_support"]["unsupported_runtime_warnings"]] == [
            "mention_target_missing",
            "mention_target_missing",
            "mention_target_missing",
        ]
