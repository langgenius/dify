"""Unit tests for the Agent App runtime request builder + the app-shaped
``AgentBackendRunRequestBuilder.build_for_agent_app`` DTO assembler."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from agenton.compositor import CompositorSessionSnapshot, LayerSessionSnapshot
from agenton.layers import LifecycleState
from dify_agent.layers.config import DifyConfigSkillConfig
from dify_agent.layers.dify_core_tools import DifyCoreToolConfig, DifyCoreToolsLayerConfig
from dify_agent.layers.dify_plugin import DifyPluginToolConfig, DifyPluginToolsLayerConfig
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.user_prompt import DifyUserPromptLayerConfig

from clients.agent_backend import (
    DIFY_CONFIG_LAYER_ID,
    DIFY_CORE_TOOLS_LAYER_ID,
    DIFY_PLUGIN_TOOLS_LAYER_ID,
    AgentBackendAgentAppRunInput,
    AgentBackendModelConfig,
    AgentBackendRunRequestBuilder,
)
from clients.agent_backend.request_builder import DIFY_SHELL_LAYER_ID
from core.app.apps.agent_app.errors import AgentSessionSnapshotIncompatibleError
from core.app.apps.agent_app.runtime_request_builder import (
    AgentAppRuntimeBuildContext,
    AgentAppRuntimeRequestBuilder,
    AgentAppRuntimeRequestBuildError,
)
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.workflow.file_reference import build_file_reference
from graphon.file import File, FileTransferMethod, FileType
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent
from models.agent_config_entities import AgentSoulConfig
from tests.unit_tests.config_override import apply_config_overrides


@pytest.fixture(autouse=True)
def _no_runtime_agent_skills(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "core.app.apps.agent_app.runtime_request_builder.load_runtime_agent_skill_configs",
        lambda **_kwargs: [],
    )


@pytest.fixture(autouse=True)
def model_context_window_calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple[object, str, str]]:
    calls: list[tuple[object, str, str]] = []

    def resolve(*, run_context: object, provider_name: str, model_name: str) -> int:
        calls.append((run_context, provider_name, model_name))
        return 32_768

    monkeypatch.setattr(
        "core.app.apps.agent_app.runtime_request_builder.resolve_model_context_window",
        resolve,
    )
    return calls


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
                backend_binding_ref="binding-ref-1",
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
        # Agent App keeps layers alive across turns by default.
        assert request.on_exit.default.value == "suspend"

    def test_blank_user_prompt_rejected(self):
        with pytest.raises(ValueError, match="must not be blank"):
            AgentBackendAgentAppRunInput(
                model=AgentBackendModelConfig(plugin_id="p/q", model_provider="openai", model="m"),
                execution_context=_exec_ctx(),
                backend_binding_ref="binding-ref-1",
                user_prompt="   ",
            )

    def test_soul_prompt_optional(self):
        request = AgentBackendRunRequestBuilder().build_for_agent_app(
            AgentBackendAgentAppRunInput(
                model=AgentBackendModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="gpt-test"),
                execution_context=_exec_ctx(),
                backend_binding_ref="binding-ref-1",
                user_prompt="hi",
            )
        )
        assert [layer.name for layer in request.composition.layers][0] == "agent_app_user_prompt"


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
    session_snapshot: CompositorSessionSnapshot | None = None,
    files: tuple[File, ...] = (),
    image_detail_config: ImagePromptMessageContent.DETAIL | None = None,
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
        binding_id="binding-1",
        backend_binding_ref="binding-ref-1",
        agent_config_version_kind=agent_config_version_kind,  # type: ignore[arg-type]
        session_snapshot=session_snapshot,
        files=files,
        image_detail_config=image_detail_config,
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


def _image_file() -> File:
    return File(
        file_id="file-1",
        file_type=FileType.IMAGE,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        reference="upload-file-1",
        filename="earth.png",
        extension=".png",
        mime_type="image/png",
        size=12,
    )


def _document_file() -> File:
    return File(
        file_id="file-2",
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        reference="upload-document-1",
        filename="brief.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=24,
    )


def _snapshot_for_layer_names(layer_names: list[str]) -> CompositorSessionSnapshot:
    return CompositorSessionSnapshot(
        layers=[
            LayerSessionSnapshot(name=name, lifecycle_state=LifecycleState.SUSPENDED, runtime_state={})
            for name in layer_names
        ]
    )


class TestAgentAppRuntimeRequestBuilder:
    def test_build_maps_soul_to_run_request(self, model_context_window_calls: list[tuple[object, str, str]]):
        builder = AgentAppRuntimeRequestBuilder(
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )
        context = _ctx(_soul_with_model())
        result = builder.build(context)

        req = result.request
        names = [layer.name for layer in req.composition.layers]
        assert names == [
            "agent_soul_prompt",
            "agent_app_user_prompt",
            "execution_context",
            "runtime",
            DIFY_SHELL_LAYER_ID,
            DIFY_CONFIG_LAYER_ID,
            "history",
            "llm",
        ]
        # plugin_id / provider normalized for plugin-daemon transport.
        llm = next(layer for layer in req.composition.layers if layer.name == "llm")
        assert llm.config.plugin_id == "langgenius/openai"
        assert llm.config.model_provider == "openai"
        assert llm.config.context_window_tokens == 32_768
        assert model_context_window_calls == [(context.dify_context, "langgenius/openai/openai", "gpt-4o-mini")]
        # execution context carries conversation + agent_app invoke source.
        exec_ctx = next(layer for layer in req.composition.layers if layer.name == "execution_context")
        assert exec_ctx.config.conversation_id == "conv-1"
        # Real Dify access context forwarded; agent run mode in agent_mode.
        assert exec_ctx.config.user_from == "end-user"
        assert exec_ctx.config.invoke_from == "web-app"
        assert exec_ctx.config.agent_mode == "agent_app"
        assert req.on_exit.default.value == "suspend"
        # LLM credentials are resolved by API and never enter the Agent request.
        assert "credentials" not in result.redacted_request["composition"]["layers"][-1]["config"]
        assert result.metadata["conversation_id"] == "conv-1"

    def test_build_sends_images_directly_to_vision_model(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            "core.app.apps.agent_app.runtime_request_builder.resolve_model_supports_vision",
            lambda **_kwargs: True,
        )
        prompt_content_calls: list[tuple[File, ImagePromptMessageContent.DETAIL | None]] = []

        def to_prompt_message_content(
            file: File,
            *,
            image_detail_config: ImagePromptMessageContent.DETAIL | None,
        ) -> ImagePromptMessageContent:
            prompt_content_calls.append((file, image_detail_config))
            return ImagePromptMessageContent(
                format="png",
                url="https://files.example.com/earth.png?sign=secret",
                mime_type="image/png",
                filename="earth.png",
                detail=image_detail_config or ImagePromptMessageContent.DETAIL.LOW,
            )

        monkeypatch.setattr(
            "core.app.apps.agent_app.runtime_request_builder.file_manager.to_prompt_message_content",
            to_prompt_message_content,
        )
        builder = AgentAppRuntimeRequestBuilder(dify_tools_builder=_NoToolsBuilder())  # type: ignore[arg-type]

        result = builder.build(
            _ctx(
                _soul_with_model(),
                query="Describe this image.",
                files=(_image_file(),),
                image_detail_config=ImagePromptMessageContent.DETAIL.HIGH,
            )
        )
        layer = next(item for item in result.request.composition.layers if item.name == "agent_app_user_prompt")
        config = DifyUserPromptLayerConfig.model_validate(layer.config)

        assert config.text == "Describe this image."
        assert config.files[0].url == "https://files.example.com/earth.png?sign=secret"
        assert config.files[0].detail == "high"
        assert "dify-agent file download" not in config.text
        assert prompt_content_calls == [(_image_file(), ImagePromptMessageContent.DETAIL.HIGH)]

    def test_build_keeps_image_locator_for_non_vision_model(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            "core.app.apps.agent_app.runtime_request_builder.resolve_model_supports_vision",
            lambda **_kwargs: False,
        )
        builder = AgentAppRuntimeRequestBuilder(dify_tools_builder=_NoToolsBuilder())  # type: ignore[arg-type]

        result = builder.build(_ctx(_soul_with_model(), query="Inspect the attachment.", files=(_image_file(),)))
        layer = next(item for item in result.request.composition.layers if item.name == "agent_app_user_prompt")
        config = DifyUserPromptLayerConfig.model_validate(layer.config)

        assert config.files == []
        assert config.text == (
            "Inspect the attachment.\n"
            "User provided files: use dify-agent file download with the listed transfer_method and reference/url "
            "to get the files and investigate them\n"
            + json.dumps(
                [
                    {
                        "transfer_method": "local_file",
                        "reference": build_file_reference(record_id="upload-file-1"),
                    }
                ],
                separators=(",", ":"),
            )
        )

    def test_build_preserves_inline_base64_transport_for_vision_model(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            "core.app.apps.agent_app.runtime_request_builder.resolve_model_supports_vision",
            lambda **_kwargs: True,
        )
        monkeypatch.setattr(
            "core.app.apps.agent_app.runtime_request_builder.file_manager.to_prompt_message_content",
            lambda *_args, **_kwargs: ImagePromptMessageContent(
                format="png",
                base64_data="aW1hZ2UtYnl0ZXM=",
                mime_type="image/png",
                filename="earth.png",
                detail="low",
            ),
        )
        builder = AgentAppRuntimeRequestBuilder(dify_tools_builder=_NoToolsBuilder())  # type: ignore[arg-type]

        result = builder.build(_ctx(_soul_with_model(), query="Describe this image.", files=(_image_file(),)))
        layer = next(item for item in result.request.composition.layers if item.name == "agent_app_user_prompt")
        config = DifyUserPromptLayerConfig.model_validate(layer.config)

        assert config.files[0].url is None
        assert config.files[0].base64_data == "aW1hZ2UtYnl0ZXM="

    def test_build_keeps_non_image_locator_when_vision_image_is_direct(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            "core.app.apps.agent_app.runtime_request_builder.resolve_model_supports_vision",
            lambda **_kwargs: True,
        )
        monkeypatch.setattr(
            "core.app.apps.agent_app.runtime_request_builder.file_manager.to_prompt_message_content",
            lambda *_args, **_kwargs: ImagePromptMessageContent(
                format="png",
                url="https://files.example.com/earth.png",
                mime_type="image/png",
                filename="earth.png",
                detail="low",
            ),
        )
        builder = AgentAppRuntimeRequestBuilder(dify_tools_builder=_NoToolsBuilder())  # type: ignore[arg-type]

        result = builder.build(
            _ctx(_soul_with_model(), files=(_image_file(), _document_file()), query="Compare the attachments.")
        )
        layer = next(item for item in result.request.composition.layers if item.name == "agent_app_user_prompt")
        config = DifyUserPromptLayerConfig.model_validate(layer.config)

        assert [file.filename for file in config.files] == ["earth.png"]
        assert config.text.endswith(
            json.dumps(
                [
                    {
                        "transfer_method": "local_file",
                        "reference": build_file_reference(record_id="upload-document-1"),
                    }
                ],
                separators=(",", ":"),
            )
        )

    @pytest.mark.parametrize(
        ("previous_prompt", "current_prompt"),
        [("", "You are Iris."), ("You are Iris.", "")],
    )
    def test_build_rejects_session_snapshot_after_layer_topology_changes(
        self,
        previous_prompt: str,
        current_prompt: str,
    ) -> None:
        builder = AgentAppRuntimeRequestBuilder(
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )
        previous_soul = _soul_with_model()
        previous_soul.prompt.system_prompt = previous_prompt
        previous_request = builder.build(_ctx(previous_soul, agent_config_version_kind="draft")).request
        snapshot = _snapshot_for_layer_names([layer.name for layer in previous_request.composition.layers])
        current_soul = _soul_with_model()
        current_soul.prompt.system_prompt = current_prompt

        with pytest.raises(AgentSessionSnapshotIncompatibleError) as exc_info:
            builder.build(
                _ctx(
                    current_soul,
                    agent_config_version_kind="draft",
                    session_snapshot=snapshot,
                )
            )

        assert exc_info.value.error_code == "agent_session_configuration_changed"
        assert exc_info.value.status_code == 409
        assert "Start a new conversation" in str(exc_info.value)

    def test_build_reuses_session_snapshot_when_config_changes_without_changing_layers(self) -> None:
        builder = AgentAppRuntimeRequestBuilder(
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )
        previous_request = builder.build(_ctx(_soul_with_model(), agent_config_version_kind="draft")).request
        snapshot = _snapshot_for_layer_names([layer.name for layer in previous_request.composition.layers])
        current_soul = _soul_with_model()
        current_soul.prompt.system_prompt = "You are Ada."

        result = builder.build(
            _ctx(
                current_soul,
                agent_config_version_kind="draft",
                session_snapshot=snapshot,
            )
        )

        assert result.request.session_snapshot is snapshot

    def test_build_wraps_agent_soul_prompt_for_build_draft(self):
        builder = AgentAppRuntimeRequestBuilder(
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(_soul_with_model(), agent_config_version_kind="build_draft"))

        prompt_layer = next(layer for layer in result.request.composition.layers if layer.name == "agent_soul_prompt")
        assert prompt_layer.config.prefix != _soul_with_model().prompt
        assert prompt_layer.config.prefix.startswith("You are running in build mode.")
        assert "```text\nYou are Iris.\n```" in prompt_layer.config.prefix

    def test_build_propagates_draft_version_kind_without_wrapping_prompt(self):
        builder = AgentAppRuntimeRequestBuilder(
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(_soul_with_model(), agent_config_version_kind="draft"))

        prompt_layer = next(layer for layer in result.request.composition.layers if layer.name == "agent_soul_prompt")
        execution_context = next(
            layer for layer in result.request.composition.layers if layer.name == "execution_context"
        )
        config_layer = next(layer for layer in result.request.composition.layers if layer.name == DIFY_CONFIG_LAYER_ID)

        assert prompt_layer.config.prefix == "You are Iris."
        assert execution_context.config.agent_config_version_kind == "draft"
        assert config_layer.config.config_version.kind == "draft"

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
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(soul))

        llm = next(layer for layer in result.request.composition.layers if layer.name == "llm")
        assert llm.config.plugin_id == "langgenius/openai"
        assert llm.config.model_provider == "openai"

    def test_build_normalizes_legacy_three_segment_model_plugin_id(self):
        soul = _soul_with_model()
        soul.model.plugin_id = "langgenius/openai/openai"
        builder = AgentAppRuntimeRequestBuilder(
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
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )
        with pytest.raises(AgentAppRuntimeRequestBuildError) as exc:
            builder.build(_ctx(AgentSoulConfig()))
        assert exc.value.error_code == "agent_model_not_configured"

    def test_build_maps_agent_soul_shell_settings_to_shell_layer(self, monkeypatch: pytest.MonkeyPatch):
        apply_config_overrides(monkeypatch, AGENT_SHELL_ENABLED=True)
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
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(soul))

        dumped = result.request.model_dump(mode="json")
        shell_config = {layer["name"]: layer for layer in dumped["composition"]["layers"]}[DIFY_SHELL_LAYER_ID][
            "config"
        ]
        assert shell_config["cli_tools"][0]["install_commands"] == ["apt-get install -y ripgrep"]
        assert shell_config["env"][0] == {"name": "PROJECT_NAME", "value": "demo"}
        assert "sandbox" not in shell_config
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
        assert names.index(DIFY_SHELL_LAYER_ID) == names.index("execution_context") + 2
        assert names.index(DIFY_CONFIG_LAYER_ID) == names.index(DIFY_SHELL_LAYER_ID) + 1

    def test_config_layer_present_when_agent_soul_has_no_config_assets(self, monkeypatch: pytest.MonkeyPatch):
        apply_config_overrides(monkeypatch, AGENT_SHELL_ENABLED=True)
        builder = AgentAppRuntimeRequestBuilder(
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
        assert layers[DIFY_SHELL_LAYER_ID].deps == {
            "execution_context": "execution_context",
            "runtime": "runtime",
        }

    def test_config_layer_for_build_draft_marks_config_writable(self):
        builder = AgentAppRuntimeRequestBuilder(
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

    def test_config_layer_includes_bound_workspace_skills(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            "core.app.apps.agent_app.runtime_request_builder.load_runtime_agent_skill_configs",
            lambda **_kwargs: [
                DifyConfigSkillConfig(
                    name="workspace-skill",
                    description="Bound workspace skill.",
                    size=123,
                    mime_type="application/zip",
                )
            ],
        )
        soul = _soul_with_model()
        soul.prompt.system_prompt = "Use [§skill:workspace-skill:Workspace Skill§]."
        builder = AgentAppRuntimeRequestBuilder(
            dify_tools_builder=_NoToolsBuilder(),  # type: ignore[arg-type]
        )

        result = builder.build(_ctx(soul))

        config = next(layer for layer in result.request.composition.layers if layer.name == DIFY_CONFIG_LAYER_ID)
        assert [skill.name for skill in config.config.skills] == ["workspace-skill"]
        assert config.config.mentioned_skill_names == ["workspace-skill"]
        prompt_layer = next(layer for layer in result.request.composition.layers if layer.name == "agent_soul_prompt")
        assert prompt_layer.config.prefix == "Use workspace-skill."

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
