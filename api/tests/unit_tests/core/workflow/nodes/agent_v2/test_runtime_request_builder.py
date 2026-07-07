import json
from dataclasses import replace
from types import SimpleNamespace
from typing import cast

import pytest
from agenton.compositor import CompositorSessionSnapshot
from dify_agent.layers.dify_core_tools import DifyCoreToolConfig, DifyCoreToolsLayerConfig
from dify_agent.layers.dify_plugin import DifyPluginToolConfig, DifyPluginToolsLayerConfig
from dify_agent.protocol import DIFY_AGENT_HISTORY_LAYER_ID, DIFY_AGENT_MODEL_LAYER_ID

from clients.agent_backend import (
    DIFY_CONFIG_LAYER_ID,
    DIFY_CORE_TOOLS_LAYER_ID,
    DIFY_EXECUTION_CONTEXT_LAYER_ID,
    DIFY_PLUGIN_TOOLS_LAYER_ID,
)
from clients.agent_backend.request_builder import DIFY_SHELL_LAYER_ID
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.workflow.file_reference import build_file_reference
from core.workflow.nodes.agent_v2.dify_tools_builder import WorkflowAgentDifyToolsBuilder
from core.workflow.nodes.agent_v2.runtime_request_builder import (
    WorkflowAgentRuntimeBuildContext,
    WorkflowAgentRuntimeRequestBuilder,
    WorkflowAgentRuntimeRequestBuildError,
    build_shell_layer_config,
)
from graphon.file import File, FileTransferMethod, FileType
from graphon.variables.segments import ArrayFileSegment, FileSegment, StringSegment
from models.agent import Agent, AgentConfigSnapshot, WorkflowAgentNodeBinding
from models.agent_config_entities import (
    AgentSoulConfig,
    AgentSoulModelConfig,
    AgentSoulToolsConfig,
    DeclaredArrayItem,
    DeclaredOutputChildConfig,
    DeclaredOutputConfig,
    DeclaredOutputType,
    WorkflowNodeJobConfig,
)


class FakeCredentialsProvider:
    def fetch(self, provider_name: str, model_name: str) -> dict[str, object]:
        assert provider_name == "openai"
        assert model_name == "gpt-test"
        return {"api_key": "secret-key"}


class CapturingCredentialsProvider:
    def __init__(self) -> None:
        self.provider_name: str | None = None
        self.model_name: str | None = None

    def fetch(self, provider_name: str, model_name: str) -> dict[str, object]:
        self.provider_name = provider_name
        self.model_name = model_name
        return {"api_key": "secret-key"}


def test_agent_soul_round_trip_preserves_existing_app_feature_fields():
    config = AgentSoulConfig.model_validate(
        {
            "app_features": {
                "file_upload": {
                    "enabled": True,
                    "allowed_file_upload_methods": ["local_file"],
                },
                "annotation_reply": {"enabled": True},
                "more_like_this": {"enabled": False},
            }
        }
    )

    dumped = config.model_dump(mode="json")

    assert dumped["app_features"]["file_upload"]["enabled"] is True
    assert dumped["app_features"]["file_upload"]["allowed_file_upload_methods"] == ["local_file"]
    assert dumped["app_features"]["annotation_reply"] == {"enabled": True}
    assert dumped["app_features"]["more_like_this"] == {"enabled": False}


class CapturingPluginLayerBuilder:
    def __init__(self) -> None:
        # Capture the runtime invocation source so tests can assert it was
        # threaded through from ``DifyRunContext.invoke_from`` rather than
        # hard-coded to a placeholder like ``VALIDATION``.
        self.last_invoke_from: InvokeFrom | None = None

    def build_layers(self, *, tenant_id, app_id, user_id, tools, invoke_from):
        assert tenant_id == "tenant-1"
        assert app_id == "app-1"
        assert user_id == "user-1"
        self.last_invoke_from = invoke_from
        if not tools.dify_tools:
            return SimpleNamespace(plugin_tools=None, core_tools=None, exposed_tool_names=lambda: [])
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


class FakeCoreLayerBuilder:
    def build_layers(self, *, tenant_id, app_id, user_id, tools, invoke_from):
        assert tenant_id == "tenant-1"
        assert app_id == "app-1"
        assert user_id == "user-1"
        del tools, invoke_from
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


class FakeVariablePool:
    def get(self, selector):
        if list(selector) == ["sys", "query"]:
            return StringSegment(value="Summarize the report.")
        if list(selector) == ["previous-node", "text"]:
            return StringSegment(value="Previous result")
        return None

    def get_by_prefix(self, prefix):
        return {}


def _context() -> WorkflowAgentRuntimeBuildContext:
    agent = Agent(id="agent-1", tenant_id="tenant-1", name="Agent")
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig(
            prompt={"system_prompt": "You are careful."},
            model=AgentSoulModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
                model_settings={"temperature": 0},
            ),
        ),
    )
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="agent-node",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig.model_validate(
            {
                "workflow_prompt": "Use the previous output.",
                "previous_node_output_refs": [{"node_id": "previous-node", "output": "text"}],
                "declared_outputs": [{"name": "summary", "type": "string"}],
            }
        ),
    )
    return WorkflowAgentRuntimeBuildContext(
        dify_context=DifyRunContext(
            tenant_id="tenant-1",
            app_id="app-1",
            user_id="user-1",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
        ),
        workflow_id="workflow-1",
        workflow_run_id="run-1",
        node_id="agent-node",
        node_execution_id="node-exec-1",
        variable_pool=FakeVariablePool(),
        binding=binding,
        agent=agent,
        snapshot=snapshot,
    )


def _request_layers(result) -> dict[str, dict[str, object]]:
    dumped = result.request.model_dump(mode="json")
    return {layer["name"]: layer for layer in dumped["composition"]["layers"]}


def _workflow_user_prompt(result) -> str:
    from clients.agent_backend import WORKFLOW_USER_PROMPT_LAYER_ID

    layer = _request_layers(result)[WORKFLOW_USER_PROMPT_LAYER_ID]
    return cast(str, layer["config"]["user"])


def _previous_node_prompt_payload(result, selector: str) -> object:
    prefix = f"  - {selector}: "
    user_prompt = _workflow_user_prompt(result)
    for line in user_prompt.splitlines():
        if line.startswith(prefix):
            return json.loads(line.removeprefix(prefix))
    raise AssertionError(f"missing prompt payload for {selector}")


def _uploaded_workflow_files_prompt_payload(result) -> object:
    prefix = "  - sys.files: "
    user_prompt = _workflow_user_prompt(result)
    for line in user_prompt.splitlines():
        if line.startswith(prefix):
            return json.loads(line.removeprefix(prefix))
    raise AssertionError("missing prompt payload for sys.files")


def test_builds_create_run_request_from_agent_soul_and_node_job():
    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(_context())

    dumped = result.request.model_dump(mode="json")
    layers = {layer["name"]: layer for layer in dumped["composition"]["layers"]}
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["agent_id"] == "agent-1"
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["agent_config_version_id"] == "snapshot-1"
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["user_from"] == "account"
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["agent_mode"] == "single_step"
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["invoke_from"] == "debugger"
    assert dumped["idempotency_key"] == "run-1:node-exec-1"
    assert dumped["composition"]["layers"][0]["config"]["prefix"] == "You are careful."
    assert dumped["composition"]["layers"][1]["config"]["user"] == "Use the previous output."
    assert "Agent task for this workflow run:" not in dumped["composition"]["layers"][2]["config"]["user"]
    assert "User query: Summarize the report." in dumped["composition"]["layers"][2]["config"]["user"]
    assert "Previous node outputs:" not in dumped["composition"]["layers"][2]["config"]["user"]
    assert dumped["composition"]["layers"][-1]["config"]["json_schema"]["properties"]["summary"]["type"] == "string"
    assert DIFY_AGENT_HISTORY_LAYER_ID in layers
    redacted_layers = {layer["name"]: layer for layer in result.redacted_request["composition"]["layers"]}
    assert redacted_layers[DIFY_AGENT_MODEL_LAYER_ID]["config"]["credentials"] == "[REDACTED]"


def test_build_includes_plugin_tools_layer_returned_by_injected_builder_for_debugger():
    tools_builder = CapturingPluginLayerBuilder()
    context = _context()
    context.snapshot.config_snapshot.tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_type": "plugin",
                    "provider_id": "langgenius/time/time",
                    "tool_name": "current_time",
                    "credential_type": "unauthorized",
                }
            ]
        }
    )

    result = WorkflowAgentRuntimeRequestBuilder(
        credentials_provider=FakeCredentialsProvider(),
        dify_tools_builder=tools_builder,  # type: ignore[arg-type]
    ).build(context)

    layers = _request_layers(result)
    assert DIFY_PLUGIN_TOOLS_LAYER_ID in layers
    assert DIFY_CORE_TOOLS_LAYER_ID not in layers
    assert tools_builder.last_invoke_from == InvokeFrom.DEBUGGER


def test_build_forwards_service_api_invoke_from_to_injected_plugin_layer_builder():
    tools_builder = CapturingPluginLayerBuilder()
    context = _context()
    context.snapshot.config_snapshot.tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_type": "plugin",
                    "provider_id": "langgenius/time/time",
                    "tool_name": "current_time",
                    "credential_type": "unauthorized",
                }
            ]
        }
    )
    context = replace(
        context,
        dify_context=context.dify_context.model_copy(update={"invoke_from": InvokeFrom.SERVICE_API}),
    )

    result = WorkflowAgentRuntimeRequestBuilder(
        credentials_provider=FakeCredentialsProvider(),
        dify_tools_builder=tools_builder,  # type: ignore[arg-type]
    ).build(context)

    layers = _request_layers(result)
    assert DIFY_PLUGIN_TOOLS_LAYER_ID in layers
    assert DIFY_CORE_TOOLS_LAYER_ID not in layers
    assert tools_builder.last_invoke_from == InvokeFrom.SERVICE_API


def test_build_includes_core_tools_layer_returned_by_injected_builder():
    context = _context()
    context.snapshot.config_snapshot.tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_type": "builtin",
                    "provider_id": "audio",
                    "tool_name": "transcribe",
                    "credential_type": "unauthorized",
                }
            ]
        }
    )

    result = WorkflowAgentRuntimeRequestBuilder(
        credentials_provider=FakeCredentialsProvider(),
        dify_tools_builder=FakeCoreLayerBuilder(),  # type: ignore[arg-type]
    ).build(context)

    layers = _request_layers(result)
    assert DIFY_CORE_TOOLS_LAYER_ID in layers
    assert DIFY_PLUGIN_TOOLS_LAYER_ID not in layers


def test_normalizes_langgenius_model_provider_for_agent_backend_transport():
    context = _context()
    context.snapshot.config_snapshot = AgentSoulConfig(
        prompt={"system_prompt": "You are careful."},
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
            model_provider="langgenius/openai/openai",
            model="gpt-test",
        ),
    )
    credentials_provider = CapturingCredentialsProvider()

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=credentials_provider).build(context)

    dumped = result.request.model_dump(mode="json")
    layers = {layer["name"]: layer for layer in dumped["composition"]["layers"]}
    model_config = layers[DIFY_AGENT_MODEL_LAYER_ID]["config"]
    assert credentials_provider.provider_name == "langgenius/openai/openai"
    assert credentials_provider.model_name == "gpt-test"
    assert model_config["plugin_id"] == "langgenius/openai"
    assert model_config["model_provider"] == "openai"


def test_builds_workflow_run_request_with_file_output_schema_and_reserved_metadata():
    context = _context()
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig(
            prompt={"system_prompt": "You are careful."},
            model=AgentSoulModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
                model_settings={"temperature": 0.2},
            ),
            tools={"cli_tools": [{"name": "pytest"}]},
        ),
    )
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="agent-node",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig.model_validate(
            {
                "declared_outputs": [
                    {"name": "report", "type": DeclaredOutputType.FILE},
                    {"name": "confidence", "type": DeclaredOutputType.NUMBER, "required": False},
                ],
            }
        ),
    )
    dify_context = context.dify_context.model_copy(update={"invoke_from": InvokeFrom.SERVICE_API})
    context = replace(context, dify_context=dify_context, workflow_run_id=None, snapshot=snapshot, binding=binding)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    layers = {layer["name"]: layer for layer in dumped["composition"]["layers"]}
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["agent_mode"] == "workflow_run"
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["invoke_from"] == "service-api"
    assert dumped["idempotency_key"] == "node-exec-1"
    output_schema = dumped["composition"]["layers"][-1]["config"]["json_schema"]
    output_description = dumped["composition"]["layers"][-1]["config"]["description"]
    report_schema = output_schema["properties"]["report"]
    report_schema_branches = {
        branch["properties"]["transfer_method"]["enum"][0]: branch for branch in report_schema["anyOf"]
    }
    assert set(report_schema_branches) == {"tool_file", "remote_url"}
    tool_file_branch = report_schema_branches["tool_file"]
    assert tool_file_branch["additionalProperties"] is False
    assert tool_file_branch["required"] == ["transfer_method", "reference"]
    assert set(tool_file_branch["properties"]) == {"transfer_method", "reference"}
    assert tool_file_branch["properties"]["reference"]["pattern"].startswith("^dify-file-ref:")
    remote_url_branch = report_schema_branches["remote_url"]
    assert remote_url_branch["additionalProperties"] is False
    assert remote_url_branch["required"] == ["transfer_method", "url"]
    assert set(remote_url_branch["properties"]) == {"transfer_method", "url"}
    assert "dify-agent file upload <path>" in output_description
    assert "final_output.report" in output_description
    assert "never invent the `reference` value" in output_description
    assert "Do not call `final_output` before the upload command succeeds" in output_description
    assert output_schema["properties"]["confidence"]["type"] == "number"
    assert output_schema["required"] == ["report"]
    assert layers[DIFY_AGENT_MODEL_LAYER_ID]["config"]["model_settings"] == {"temperature": 0.2}
    assert result.metadata["runtime_support"]["reserved_status"]["tools.dify_tools"] == "supported_when_config_valid"
    assert result.metadata["runtime_support"]["reserved_status"]["tools.cli_tools"] == "supported_by_shell_bootstrap"
    assert result.metadata["runtime_support"]["unsupported_runtime_warnings"] == []


def test_build_maps_agent_soul_shell_settings_to_shell_layer(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("core.workflow.nodes.agent_v2.runtime_request_builder.dify_config.AGENT_SHELL_ENABLED", True)
    context = _context()
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig(
            prompt={"system_prompt": "You are careful."},
            model=AgentSoulModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
            ),
            tools={"cli_tools": [{"name": "ripgrep", "install_commands": ["apt-get install -y ripgrep"]}]},
            env={"variables": [{"name": "PROJECT_NAME", "value": "demo"}]},
            sandbox={"provider": "independent", "config": {"cpu": 2}},
        ),
    )
    context = replace(context, snapshot=snapshot)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    shell_config = {layer["name"]: layer for layer in dumped["composition"]["layers"]}[DIFY_SHELL_LAYER_ID]["config"]
    assert shell_config["cli_tools"][0]["install_commands"] == ["apt-get install -y ripgrep"]
    assert shell_config["env"][0] == {"name": "PROJECT_NAME", "value": "demo"}
    assert shell_config["sandbox"] == {"provider": "independent", "config": {"cpu": 2}}
    assert result.metadata["agent_tools"] == {
        "dify_tool_count": 0,
        "dify_tool_names": [],
        "cli_tool_count": 1,
    }


def test_build_shell_layer_config_accepts_legacy_fallback_keys():
    agent_soul = AgentSoulConfig.model_validate(
        {
            "tools": {
                "cli_tools": [
                    {"label": "node", "install_command": "apt-get install -y nodejs"},
                    {"tool_name": "python", "setup_command": "pip install pytest"},
                    {"install": "apk add git"},
                    {"ignored": True},
                ]
            },
            "env": {
                "variables": [
                    {"key": "PROJECT_NAME", "default": "demo"},
                    {"env_name": "RETRY_COUNT", "value": 3},
                    {"value": "missing-name"},
                ],
                "secret_refs": [
                    {"variable": "TOKEN", "credential_id": "credential-1"},
                    {"name": "API_KEY", "provider_credential_id": "credential-2"},
                    {"name": "EDITABLE_TOKEN", "value": "inline-secret-value"},
                    {"name": "LEGACY_SECRET_REF", "id": "credential-3"},
                    {"ref": "missing-name"},
                ],
            },
        }
    )

    config = build_shell_layer_config(agent_soul).model_dump(mode="json")

    assert config["cli_tools"] == [
        {"name": "node", "install_commands": ["apt-get install -y nodejs"], "env": [], "secret_refs": []},
        {"name": "python", "install_commands": ["pip install pytest"], "env": [], "secret_refs": []},
        {"name": None, "install_commands": ["apk add git"], "env": [], "secret_refs": []},
    ]
    assert config["env"] == [
        {"name": "PROJECT_NAME", "value": "demo"},
        {"name": "RETRY_COUNT", "value": "3"},
        {"name": "EDITABLE_TOKEN", "value": "inline-secret-value"},
    ]
    assert config["secret_refs"] == [
        {"name": "TOKEN", "ref": "credential-1"},
        {"name": "API_KEY", "ref": "credential-2"},
        {"name": "LEGACY_SECRET_REF", "ref": "credential-3"},
    ]
    assert config["sandbox"] is None


def test_build_shell_layer_config_maps_typed_command_field():
    """ENG-367: the typed AgentCliToolConfig.command field feeds the shell bootstrap."""
    agent_soul = AgentSoulConfig.model_validate(
        {"tools": {"cli_tools": [{"name": "jq", "command": "apt-get install -y jq"}]}}
    )

    config = build_shell_layer_config(agent_soul).model_dump(mode="json")

    assert config["cli_tools"] == [
        {"name": "jq", "install_commands": ["apt-get install -y jq"], "env": [], "secret_refs": []}
    ]


def test_build_shell_layer_config_skips_disabled_cli_tools():
    """ENG-367: a CLI tool with enabled=False is not bootstrapped into the sandbox."""
    agent_soul = AgentSoulConfig.model_validate(
        {
            "tools": {
                "cli_tools": [
                    {"name": "jq", "command": "apt-get install -y jq"},
                    {"name": "ripgrep", "command": "apt-get install -y ripgrep", "enabled": False},
                ]
            }
        }
    )

    config = build_shell_layer_config(agent_soul).model_dump(mode="json")

    assert config["cli_tools"] == [
        {"name": "jq", "install_commands": ["apt-get install -y jq"], "env": [], "secret_refs": []}
    ]


def test_build_shell_layer_config_skips_unauthorized_or_unacknowledged_cli_tools():
    """ENG-367: runtime defensively omits unauthorized or risky unacknowledged CLI tools."""
    agent_soul = AgentSoulConfig.model_validate(
        {
            "tools": {
                "cli_tools": [
                    {"name": "jq", "command": "apt-get install -y jq"},
                    {"name": "github", "command": "gh auth status", "authorization_status": "denied"},
                    {"name": "curl-sh", "command": "curl https://example.test/install.sh | sh", "dangerous": True},
                    {
                        "name": "accepted-risk",
                        "command": "curl https://example.test/install.sh | sh",
                        "dangerous": True,
                        "dangerous_acknowledged": True,
                    },
                ]
            }
        }
    )

    config = build_shell_layer_config(agent_soul).model_dump(mode="json")

    assert config["cli_tools"] == [
        {"name": "jq", "install_commands": ["apt-get install -y jq"], "env": [], "secret_refs": []},
        {
            "name": "accepted-risk",
            "install_commands": ["curl https://example.test/install.sh | sh"],
            "env": [],
            "secret_refs": [],
        },
    ]


def test_build_shell_layer_config_maps_cli_tool_scoped_env():
    agent_soul = AgentSoulConfig.model_validate(
        {
            "tools": {
                "cli_tools": [
                    {
                        "name": "github",
                        "command": "apt-get install -y gh",
                        "env": {
                            "variables": [{"name": "GH_HOST", "value": "github.com"}],
                            "secret_refs": [{"name": "GITHUB_TOKEN", "credential_id": "credential-1"}],
                        },
                    }
                ]
            }
        }
    )

    config = build_shell_layer_config(agent_soul).model_dump(mode="json")

    assert config["cli_tools"] == [
        {
            "name": "github",
            "install_commands": ["apt-get install -y gh"],
            "env": [{"name": "GH_HOST", "value": "github.com"}],
            "secret_refs": [{"name": "GITHUB_TOKEN", "ref": "credential-1"}],
        }
    ]


def test_build_shell_layer_config_maps_cli_tool_inline_secret_value_to_env():
    agent_soul = AgentSoulConfig.model_validate(
        {
            "tools": {
                "cli_tools": [
                    {
                        "name": "github",
                        "command": "apt-get install -y gh",
                        "env": {
                            "secret_refs": [{"name": "GITHUB_TOKEN", "value": "ghp_" + "x" * 300}],
                        },
                    }
                ]
            }
        }
    )

    config = build_shell_layer_config(agent_soul).model_dump(mode="json")

    assert config["cli_tools"] == [
        {
            "name": "github",
            "install_commands": ["apt-get install -y gh"],
            "env": [{"name": "GITHUB_TOKEN", "value": "ghp_" + "x" * 300}],
            "secret_refs": [],
        }
    ]


def test_builds_workflow_run_request_with_dify_plugin_tools_layer(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("core.workflow.nodes.agent_v2.runtime_request_builder.dify_config.AGENT_SHELL_ENABLED", True)
    context = _context()
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig(
            prompt={"system_prompt": "You are careful."},
            model=AgentSoulModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
            ),
            tools={
                "dify_tools": [
                    {
                        "provider_id": "langgenius/time/time",
                        "tool_name": "current_time",
                        "credential_type": "unauthorized",
                    }
                ]
            },
        ),
    )
    context = replace(context, snapshot=snapshot)

    dify_tools_builder = CapturingPluginLayerBuilder()
    result = WorkflowAgentRuntimeRequestBuilder(
        credentials_provider=FakeCredentialsProvider(),
        dify_tools_builder=cast(WorkflowAgentDifyToolsBuilder, dify_tools_builder),
    ).build(context)

    dumped = result.request.model_dump(mode="json")
    layers = {layer["name"]: layer for layer in dumped["composition"]["layers"]}
    assert layers[DIFY_PLUGIN_TOOLS_LAYER_ID]["type"] == "dify.plugin.tools"
    assert layers[DIFY_PLUGIN_TOOLS_LAYER_ID]["deps"] == {
        "execution_context": DIFY_EXECUTION_CONTEXT_LAYER_ID,
        "shell": DIFY_SHELL_LAYER_ID,
    }
    assert layers[DIFY_PLUGIN_TOOLS_LAYER_ID]["config"]["tools"][0]["tool_name"] == "current_time"
    assert result.metadata["agent_tools"] == {
        "dify_tool_count": 1,
        "dify_tool_names": ["current_time"],
        "cli_tool_count": 0,
    }
    # The runtime invocation source must flow from ``DifyRunContext.invoke_from``
    # into the plugin tools builder so ToolManager attributes credential
    # quotas / rate limits / audit tags to the real call site instead of a
    # hard-coded ``VALIDATION`` placeholder.
    assert dify_tools_builder.last_invoke_from == context.dify_context.invoke_from


def test_build_maps_agent_soul_knowledge_to_knowledge_layer_config():
    context = _context()
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig.model_validate(
            {
                "prompt": {"system_prompt": "You are careful."},
                "model": {
                    "plugin_id": "langgenius/openai",
                    "model_provider": "openai",
                    "model": "gpt-test",
                },
                "knowledge": {
                    "sets": [
                        {
                            "id": "support",
                            "name": "Support KB",
                            "description": "Support content",
                            "datasets": [{"id": "dataset-1"}, {"id": "dataset-2"}],
                            "query": {"mode": "generated_query"},
                            "retrieval": {
                                "mode": "multiple",
                                "top_k": 6,
                                "score_threshold": 0.4,
                                "reranking_model": {"provider": "cohere", "model": "rerank-v3"},
                                "weights": {"weight_type": "weighted_score", "vector_setting": {"vector_weight": 0.7}},
                            },
                            "metadata_filtering": {
                                "mode": "manual",
                                "conditions": {
                                    "logical_operator": "and",
                                    "conditions": [
                                        {"name": "category", "comparison_operator": "contains", "value": "auth"}
                                    ],
                                },
                            },
                        },
                        {
                            "id": "release",
                            "name": "Release Notes",
                            "datasets": [{"id": "dataset-3"}],
                            "query": {"mode": "user_query", "value": "release notes"},
                            "retrieval": {
                                "mode": "single",
                                "model": {
                                    "provider": "openai",
                                    "name": "gpt-4o-mini",
                                    "mode": "chat",
                                    "completion_params": {"temperature": 0.2},
                                },
                            },
                            "metadata_filtering": {
                                "mode": "automatic",
                                "model_config": {
                                    "provider": "openai",
                                    "name": "gpt-4o-mini",
                                    "mode": "chat",
                                    "completion_params": {},
                                },
                            },
                        },
                    ],
                },
            }
        ),
    )
    context = replace(context, snapshot=snapshot)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    layers = {layer["name"]: layer for layer in dumped["composition"]["layers"]}
    knowledge_layer = layers["knowledge"]
    assert knowledge_layer["type"] == "dify.knowledge_base"
    assert knowledge_layer["deps"] == {"execution_context": DIFY_EXECUTION_CONTEXT_LAYER_ID}
    assert knowledge_layer["config"]["sets"] == [
        {
            "id": "support",
            "name": "Support KB",
            "description": "Support content",
            "datasets": [
                {"id": "dataset-1", "name": None, "description": None},
                {"id": "dataset-2", "name": None, "description": None},
            ],
            "query": {"mode": "generated_query", "value": None},
            "retrieval": {
                "mode": "multiple",
                "top_k": 6,
                "score_threshold": 0.4,
                "reranking_mode": "reranking_model",
                "reranking_enable": True,
                "reranking_model": {"provider": "cohere", "model": "rerank-v3"},
                "weights": {"weight_type": "weighted_score", "vector_setting": {"vector_weight": 0.7}},
                "model": None,
            },
            "metadata_filtering": {
                "mode": "manual",
                "metadata_model_config": None,
                "conditions": {
                    "logical_operator": "and",
                    "conditions": [{"name": "category", "comparison_operator": "contains", "value": "auth"}],
                },
            },
        },
        {
            "id": "release",
            "name": "Release Notes",
            "description": None,
            "datasets": [{"id": "dataset-3", "name": None, "description": None}],
            "query": {"mode": "user_query", "value": "release notes"},
            "retrieval": {
                "mode": "single",
                "top_k": None,
                "score_threshold": 0.0,
                "reranking_mode": "reranking_model",
                "reranking_enable": True,
                "reranking_model": None,
                "weights": None,
                "model": {
                    "provider": "openai",
                    "name": "gpt-4o-mini",
                    "mode": "chat",
                    "completion_params": {"temperature": 0.2},
                },
            },
            "metadata_filtering": {
                "mode": "automatic",
                "metadata_model_config": {
                    "provider": "openai",
                    "name": "gpt-4o-mini",
                    "mode": "chat",
                    "completion_params": {},
                },
                "conditions": None,
            },
        },
    ]
    assert knowledge_layer["config"]["max_result_content_chars"] == 2000
    assert knowledge_layer["config"]["max_observation_chars"] == 12000


def test_build_knowledge_layer_maps_disabled_score_threshold_to_zero():
    context = _context()
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig.model_validate(
            {
                "prompt": {"system_prompt": "You are careful."},
                "model": {
                    "plugin_id": "langgenius/openai",
                    "model_provider": "openai",
                    "model": "gpt-test",
                },
                "knowledge": {
                    "sets": [
                        {
                            "id": "support",
                            "name": "Support KB",
                            "datasets": [{"id": "dataset-1"}],
                            "query": {"mode": "generated_query"},
                            "retrieval": {
                                "mode": "multiple",
                                "top_k": 4,
                                "score_threshold": None,
                            },
                        }
                    ],
                },
            }
        ),
    )
    context = replace(context, snapshot=snapshot)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    knowledge_layer = next(layer for layer in dumped["composition"]["layers"] if layer["name"] == "knowledge")
    assert knowledge_layer["config"]["sets"][0]["retrieval"]["score_threshold"] == 0.0


def test_build_skips_knowledge_layer_when_agent_soul_has_no_sets():
    context = _context()
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig.model_validate(
            {
                "prompt": {"system_prompt": "You are careful."},
                "model": {
                    "plugin_id": "langgenius/openai",
                    "model_provider": "openai",
                    "model": "gpt-test",
                },
                "knowledge": {"sets": []},
            }
        ),
    )
    context = replace(context, snapshot=snapshot)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    assert all(layer["name"] != "knowledge" for layer in dumped["composition"]["layers"])


def test_build_passes_saved_session_snapshot_to_agent_backend_request():
    session_snapshot = CompositorSessionSnapshot(layers=[])
    context = replace(_context(), session_snapshot=session_snapshot)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    assert result.request.session_snapshot is session_snapshot


def test_requires_agent_soul_model_config():
    context = _context()
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig(),
    )
    context = replace(context, snapshot=snapshot)

    with pytest.raises(WorkflowAgentRuntimeRequestBuildError, match="Agent Soul model"):
        WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)


def test_missing_previous_node_output_fails_request_build():
    context = _context()
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="agent-node",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig.model_validate(
            {
                "previous_node_output_refs": [{"node_id": "missing-node", "output": "text"}],
            }
        ),
    )
    context = replace(context, binding=binding)

    with pytest.raises(WorkflowAgentRuntimeRequestBuildError) as exc_info:
        WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    assert exc_info.value.error_code == "missing_previous_node_output"


def test_invalid_previous_node_output_ref_fails_request_build():
    context = _context()
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="agent-node",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig.model_validate(
            {
                "previous_node_output_refs": [{"selector": ["previous-node", 1]}],
            }
        ),
    )
    context = replace(context, binding=binding)

    with pytest.raises(WorkflowAgentRuntimeRequestBuildError) as exc_info:
        WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    assert exc_info.value.error_code == "invalid_previous_node_output_ref"


def test_empty_declared_outputs_injects_prd_defaults_text_files_json():
    """Stage 4 §4.1 (D-3): empty declared_outputs → backend receives the PRD defaults
    (text / files / json) as a stable structured-output contract."""
    context = _context()
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="agent-node",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig.model_validate({}),
    )
    context = replace(context, binding=binding)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    output_layer = dumped["composition"]["layers"][-1]["config"]
    properties = output_layer["json_schema"]["properties"]
    assert set(properties) == {"text", "files", "json"}
    assert properties["text"]["type"] == "string"
    assert properties["files"]["type"] == "array"
    # `files` defaults to array<file> → items is a file ref object.
    file_item_branches = properties["files"]["items"]["anyOf"]
    assert [branch["properties"]["transfer_method"]["enum"] for branch in file_item_branches] == [
        ["tool_file"],
        ["remote_url"],
    ]
    assert all(branch["additionalProperties"] is False for branch in file_item_branches)
    assert properties["json"]["type"] == "object"
    # Defaults are all required=False so no `required:` key on the schema.
    assert "required" not in output_layer["json_schema"]


def test_array_output_emits_typed_items_per_array_item():
    context = _context()
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="agent-node",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig.model_validate(
            {
                "declared_outputs": [
                    {
                        "name": "tags",
                        "type": "array",
                        "array_item": {"type": "string", "description": "topic tag"},
                        "required": True,
                    }
                ],
            }
        ),
    )
    context = replace(context, binding=binding)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    output_schema = result.request.model_dump(mode="json")["composition"]["layers"][-1]["config"]["json_schema"]
    tags_schema = output_schema["properties"]["tags"]
    assert tags_schema["type"] == "array"
    assert tags_schema["items"]["type"] == "string"
    assert tags_schema["items"]["description"] == "topic tag"
    assert output_schema["required"] == ["tags"]


def test_nested_declared_output_emits_object_and_array_child_schema():
    profile_output = DeclaredOutputConfig(
        name="profile",
        type=DeclaredOutputType.OBJECT,
        children=[
            DeclaredOutputChildConfig(name="email", type=DeclaredOutputType.STRING),
            DeclaredOutputChildConfig(
                name="nickname",
                type=DeclaredOutputType.STRING,
                required=False,
                description="Optional display name",
            ),
            DeclaredOutputChildConfig(
                name="addresses",
                type=DeclaredOutputType.ARRAY,
                array_item=DeclaredArrayItem(
                    type=DeclaredOutputType.OBJECT,
                    description="Address item",
                    children=[DeclaredOutputChildConfig(name="city", type=DeclaredOutputType.STRING)],
                ),
            ),
        ],
    )

    schema = WorkflowAgentRuntimeRequestBuilder._schema_for_declared_output(profile_output)

    assert schema["properties"]["email"] == {"type": "string"}
    assert schema["properties"]["nickname"] == {"type": "string", "description": "Optional display name"}
    assert schema["properties"]["addresses"]["items"]["properties"]["city"] == {"type": "string"}
    assert schema["properties"]["addresses"]["items"]["description"] == "Address item"
    assert schema["properties"]["addresses"]["items"]["required"] == ["city"]
    assert schema["required"] == ["email", "addresses"]


def test_effective_declared_outputs_passthrough_when_user_declared():
    """effective_declared_outputs() must return user-provided outputs verbatim
    when non-empty; only empty input gets PRD defaults injected."""
    from models.agent_config_entities import DeclaredOutputConfig

    declared = [DeclaredOutputConfig(name="summary", type=DeclaredOutputType.STRING)]
    effective = WorkflowAgentRuntimeRequestBuilder.effective_declared_outputs(declared)
    assert list(effective) == declared


def test_mentions_expand_in_soul_and_job_prompts_without_token_leak():
    """ENG-616: soul/output mentions expand, while frontend workflow markers stay
    literal in the workflow task layer and resolve under workflow context."""
    context = _context()
    context.snapshot.config_snapshot = AgentSoulConfig(
        prompt={"system_prompt": "Careful. Ask [§human:c-1:EMAIL · DAVE§] when unsure."},
        model=AgentSoulModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="gpt-test"),
        human={"contacts": [{"id": "c-1", "name": "David Hayes", "channel": "email"}]},
    )
    context.binding.node_job_config = WorkflowNodeJobConfig.model_validate(
        {
            "workflow_prompt": (
                "Read {{#previous-node.text#}} and produce [§output:summary§]. "
                "Unknown [§knowledge:gone:旧手册§] degrades."
            ),
            "declared_outputs": [{"name": "summary", "type": "string"}],
        }
    )

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    layers = _request_layers(result)
    agent_soul_prompt = layers["agent_soul_prompt"]["config"]["prefix"]
    job_prompt = layers["workflow_node_job_prompt"]["config"]["user"]
    assert agent_soul_prompt == ("Careful. Ask EMAIL · David Hayes when unsure.")
    assert job_prompt == "Read {{#previous-node.text#}} and produce summary (string). Unknown 旧手册 degrades."
    user_prompt = _workflow_user_prompt(result)
    assert "Agent task for this workflow run:" not in user_prompt
    assert "Previous result" in user_prompt
    for prompt_text in (agent_soul_prompt, job_prompt, user_prompt):
        assert "[§" not in prompt_text
    assert "{{#" in job_prompt
    assert "{{#" not in agent_soul_prompt
    assert "{{#" not in user_prompt


def test_previous_node_file_output_uses_agent_stub_download_mapping_in_workflow_context():
    file_reference = build_file_reference(record_id="tool-file-1")

    class FileVariablePool(FakeVariablePool):
        def get(self, selector):
            if list(selector) == ["previous-node", "report"]:
                return FileSegment(
                    value=File(
                        type=FileType.DOCUMENT,
                        transfer_method=FileTransferMethod.TOOL_FILE,
                        reference=file_reference,
                        remote_url=None,
                        filename="report.pdf",
                        extension=".pdf",
                        mime_type="application/pdf",
                        size=12,
                    )
                )
            return super().get(selector)

    context = replace(_context(), variable_pool=FileVariablePool())
    context.binding.node_job_config = WorkflowNodeJobConfig.model_validate(
        {
            "workflow_prompt": "Review {{#previous-node.report#}} before responding.",
        }
    )

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    assert _request_layers(result)["workflow_node_job_prompt"]["config"]["user"] == (
        "Review {{#previous-node.report#}} before responding."
    )
    assert _previous_node_prompt_payload(result, "previous-node.report") == {
        "transfer_method": "tool_file",
        "reference": file_reference,
    }


def test_scalar_previous_node_output_appears_in_workflow_context_section():
    context = _context()
    context.binding.node_job_config = WorkflowNodeJobConfig.model_validate(
        {
            "workflow_prompt": "Review {{#previous-node.text#}} before responding.",
        }
    )

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    user_prompt = _workflow_user_prompt(result)

    assert "- Previous node outputs:" in user_prompt
    assert "  - previous-node.text: Previous result" in user_prompt


def test_stale_previous_node_refs_are_ignored_when_workflow_prompt_has_no_frontend_markers():
    context = _context()
    context.binding.node_job_config = WorkflowNodeJobConfig.model_validate(
        {
            "workflow_prompt": "Review the current request without upstream context.",
            "previous_node_output_refs": [{"node_id": "missing-node", "output": "text"}],
        }
    )

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    assert _request_layers(result)["workflow_node_job_prompt"]["config"]["user"] == (
        "Review the current request without upstream context."
    )
    assert "Previous node outputs:" not in _workflow_user_prompt(result)


def test_previous_node_file_array_uses_agent_stub_download_mappings_in_workflow_context():
    first_reference = build_file_reference(record_id="tool-file-1")
    second_reference = build_file_reference(record_id="tool-file-2")

    class FileArrayVariablePool(FakeVariablePool):
        def get(self, selector):
            if list(selector) == ["previous-node", "attachments"]:
                return ArrayFileSegment(
                    value=[
                        File(
                            type=FileType.DOCUMENT,
                            transfer_method=FileTransferMethod.TOOL_FILE,
                            reference=first_reference,
                            remote_url=None,
                            filename="first.pdf",
                            extension=".pdf",
                            mime_type="application/pdf",
                            size=12,
                        ),
                        File(
                            type=FileType.DOCUMENT,
                            transfer_method=FileTransferMethod.REMOTE_URL,
                            reference=None,
                            remote_url="https://example.com/second.pdf",
                            filename="second.pdf",
                            extension=".pdf",
                            mime_type="application/pdf",
                            size=12,
                        ),
                    ]
                )
            return super().get(selector)

    context = replace(_context(), variable_pool=FileArrayVariablePool())
    context.binding.node_job_config = WorkflowNodeJobConfig.model_validate(
        {
            "workflow_prompt": "Inspect {{#previous-node.attachments#}}",
        }
    )

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    assert _previous_node_prompt_payload(result, "previous-node.attachments") == [
        {
            "transfer_method": "tool_file",
            "reference": first_reference,
        },
        {
            "transfer_method": "remote_url",
            "url": "https://example.com/second.pdf",
        },
    ]


def test_uploaded_workflow_files_are_included_without_prompt_marker():
    file_reference = build_file_reference(record_id="uploaded-file-1")

    class UploadedFilesVariablePool(FakeVariablePool):
        def get(self, selector):
            if list(selector) == ["sys", "files"]:
                return ArrayFileSegment(
                    value=[
                        File(
                            type=FileType.DOCUMENT,
                            transfer_method=FileTransferMethod.LOCAL_FILE,
                            reference=file_reference,
                            remote_url=None,
                            filename="requirements.pdf",
                            extension=".pdf",
                            mime_type="application/pdf",
                            size=12,
                        )
                    ]
                )
            return super().get(selector)

    context = replace(_context(), variable_pool=UploadedFilesVariablePool())
    context.binding.node_job_config = WorkflowNodeJobConfig.model_validate(
        {
            "workflow_prompt": "Answer the user's question.",
        }
    )

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    user_prompt = _workflow_user_prompt(result)
    assert "- Uploaded workflow files:" in user_prompt
    assert _uploaded_workflow_files_prompt_payload(result) == [
        {
            "transfer_method": "local_file",
            "reference": file_reference,
        }
    ]
    assert "Previous node outputs:" not in user_prompt


def test_previous_node_remote_url_file_mapping_is_not_truncated_in_workflow_context():
    remote_url = "https://example.com/" + ("a" * 2100) + ".pdf"

    class LongRemoteUrlVariablePool(FakeVariablePool):
        def get(self, selector):
            if list(selector) == ["previous-node", "report"]:
                return FileSegment(
                    value=File(
                        type=FileType.DOCUMENT,
                        transfer_method=FileTransferMethod.REMOTE_URL,
                        reference=None,
                        remote_url=remote_url,
                        filename="report.pdf",
                        extension=".pdf",
                        mime_type="application/pdf",
                        size=12,
                    )
                )
            return super().get(selector)

    context = replace(_context(), variable_pool=LongRemoteUrlVariablePool())
    context.binding.node_job_config = WorkflowNodeJobConfig.model_validate(
        {
            "workflow_prompt": "Use {{#previous-node.report#}}",
        }
    )

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    assert _previous_node_prompt_payload(result, "previous-node.report") == {
        "transfer_method": "remote_url",
        "url": remote_url,
    }
    assert "...[truncated]" not in _workflow_user_prompt(result)


# ── Agent config declaration layer ────────────────────────────────────────────


def _soul_with_config_assets() -> AgentSoulConfig:
    return AgentSoulConfig(
        prompt={
            "system_prompt": (
                "You are careful. Use [§skill:tender-analyzer:Tender Analyzer§] and [§file:sample.pdf:sample.pdf§]."
            )
        },
        model=AgentSoulModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="gpt-test"),
        config_skills=[{"name": "tender-analyzer", "description": "Parses RFPs.", "file_id": "tool-file-1"}],
        config_files=[{"name": "sample.pdf", "file_kind": "upload_file", "file_id": "upload-file-1"}],
        config_note="Read the proposal first.",
    )


def test_build_config_layer_config_includes_soul_context_and_mentions():
    from core.workflow.nodes.agent_v2.runtime_request_builder import build_config_layer_config

    config, warnings = build_config_layer_config(
        _soul_with_config_assets(),
        agent_id="agent-1",
        config_version_id="snapshot-1",
    )

    assert config is not None
    assert config.agent_id == "agent-1"
    assert config.config_version is not None
    assert config.config_version.id == "snapshot-1"
    assert config.config_version.kind == "snapshot"
    assert config.config_version.writable is False
    assert [skill.name for skill in config.skills] == ["tender-analyzer"]
    assert [file_ref.name for file_ref in config.files] == ["sample.pdf"]
    assert config.note == "Read the proposal first."
    assert config.mentioned_skill_names == ["tender-analyzer"]
    assert config.mentioned_file_names == ["sample.pdf"]
    assert warnings == []


def test_build_config_layer_config_returns_empty_config_for_empty_agent_soul():
    from core.workflow.nodes.agent_v2.runtime_request_builder import build_config_layer_config

    soul = AgentSoulConfig(
        model=AgentSoulModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="gpt-test")
    )
    config, warnings = build_config_layer_config(soul)

    assert config is not None
    assert config.model_dump(mode="json") == {
        "agent_id": None,
        "config_version": {"id": None, "kind": "snapshot", "writable": False},
        "skills": [],
        "files": [],
        "env_keys": [],
        "note": "",
        "mentioned_skill_names": [],
        "mentioned_file_names": [],
    }
    assert warnings == []


def test_workflow_run_request_has_config_layer_with_empty_agent_soul(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("core.workflow.nodes.agent_v2.runtime_request_builder.dify_config.AGENT_SHELL_ENABLED", True)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(_context())

    dumped = result.request.model_dump(mode="json")
    layers = {layer["name"]: layer for layer in dumped["composition"]["layers"]}
    assert layers[DIFY_CONFIG_LAYER_ID]["config"] == {
        "agent_id": "agent-1",
        "config_version": {"id": "snapshot-1", "kind": "snapshot", "writable": False},
        "skills": [],
        "files": [],
        "env_keys": [],
        "note": "",
        "mentioned_skill_names": [],
        "mentioned_file_names": [],
    }
    assert layers[DIFY_SHELL_LAYER_ID]["deps"] == {"execution_context": DIFY_EXECUTION_CONTEXT_LAYER_ID}
    assert layers[DIFY_SHELL_LAYER_ID]["config"]["agent_stub_drive_ref"] is None


def test_workflow_run_request_contains_config_layer():
    """Contract test: locks the dify.config composition shape against cross-package drift."""
    context = _context()
    context.snapshot.config_snapshot = _soul_with_config_assets()

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    layer_names = [layer["name"] for layer in dumped["composition"]["layers"]]
    assert DIFY_CONFIG_LAYER_ID in layer_names
    # shell enters first; config uses that shell to materialize mentioned targets.
    assert layer_names.index(DIFY_SHELL_LAYER_ID) == layer_names.index("execution_context") + 1
    assert layer_names.index(DIFY_CONFIG_LAYER_ID) == layer_names.index(DIFY_SHELL_LAYER_ID) + 1
    config = next(layer for layer in dumped["composition"]["layers"] if layer["name"] == DIFY_CONFIG_LAYER_ID)
    assert config["type"] == "dify.config"
    assert config["deps"] == {"shell": DIFY_SHELL_LAYER_ID}
    assert config["config"] == {
        "agent_id": "agent-1",
        "config_version": {"id": "snapshot-1", "kind": "snapshot", "writable": False},
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
        "mentioned_file_names": ["sample.pdf"],
    }
    warnings = result.metadata["runtime_support"]["unsupported_runtime_warnings"]
    assert warnings == []
    # the config layer is non-sensitive and must survive into persistable specs
    from dify_agent.protocol import extract_runtime_layer_specs

    specs = extract_runtime_layer_specs(result.request.composition)
    assert any(spec.name == DIFY_CONFIG_LAYER_ID and spec.type == "dify.config" for spec in specs)


def test_workflow_runtime_expands_config_mentions_in_agent_soul_prompt():
    context = _context()
    context.snapshot.config_snapshot = _soul_with_config_assets()

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    soul_prompt = next(layer for layer in result.request.composition.layers if layer.name == "agent_soul_prompt")
    assert soul_prompt.config.prefix == "You are careful. Use tender-analyzer and sample.pdf."
    assert "[§" not in soul_prompt.config.prefix


def test_workflow_runtime_missing_config_mentions_fall_back_to_label_then_name():
    context = _context()
    context.snapshot.config_snapshot = AgentSoulConfig(
        prompt={
            "system_prompt": (
                "Use [§skill:ghost-skill:Ghost Skill§], [§file:ghost.txt:Ghost File§], and [§file:no-label.txt§]."
            )
        },
        model=AgentSoulModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="gpt-test"),
    )

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    soul_prompt = next(layer for layer in result.request.composition.layers if layer.name == "agent_soul_prompt")
    assert soul_prompt.config.prefix == "Use Ghost Skill, Ghost File, and no-label.txt."
    assert "[§" not in soul_prompt.config.prefix
    assert [warning["code"] for warning in result.metadata["runtime_support"]["unsupported_runtime_warnings"]] == [
        "mention_target_missing",
        "mention_target_missing",
        "mention_target_missing",
    ]


def test_build_config_layer_config_missing_mentions_warn_without_catalog():
    from core.workflow.nodes.agent_v2.runtime_request_builder import build_config_layer_config

    soul = AgentSoulConfig(
        model=AgentSoulModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="gpt-test"),
        config_skills=[{"name": "tender-analyzer", "description": "Parses RFPs.", "file_id": "tool-file-1"}],
        prompt={"system_prompt": "Use [§skill:ghost-skill:Ghost§]"},
    )
    config, warnings = build_config_layer_config(soul)
    assert config is not None
    assert config.mentioned_skill_names == []
    assert config.mentioned_file_names == []
    assert [w["code"] for w in warnings] == ["mention_target_missing"]


# ── ENG-635: ask_human layer gating + feature manifest ───────────────────────


def test_build_ask_human_layer_config_gated_on_human_contacts():
    from dify_agent.layers.ask_human import DifyAskHumanLayerConfig

    from core.workflow.nodes.agent_v2.runtime_request_builder import build_ask_human_layer_config

    # no human involvement configured -> tool stays off
    assert build_ask_human_layer_config(AgentSoulConfig()) is None

    soul = AgentSoulConfig.model_validate(
        {"human": {"contacts": [{"id": "c-1", "name": "David", "email": "d@acme.com", "channel": "email"}]}}
    )
    config = build_ask_human_layer_config(soul)
    assert isinstance(config, DifyAskHumanLayerConfig)
    assert config.enabled is True


def test_feature_manifest_marks_human_supported_when_configured():
    from core.workflow.nodes.agent_v2.runtime_feature_manifest import build_runtime_feature_manifest

    soul = AgentSoulConfig.model_validate(
        {"human": {"contacts": [{"id": "c-1", "name": "David", "email": "d@acme.com", "channel": "email"}]}}
    )
    manifest = build_runtime_feature_manifest(soul)
    assert "human" in manifest["supported"]
    assert "human" not in manifest["reserved"]
    assert manifest["reserved_status"]["human"] == "supported_by_ask_human_hitl"
    # configured human no longer produces a "not executed" warning
    assert all("human" not in w["section"] for w in manifest["unsupported_runtime_warnings"])


def test_feature_manifest_marks_knowledge_supported_without_warning_when_configured():
    from core.workflow.nodes.agent_v2.runtime_feature_manifest import build_runtime_feature_manifest

    soul = AgentSoulConfig.model_validate(
        {
            "knowledge": {
                "sets": [
                    {
                        "id": "product",
                        "name": "Product Docs",
                        "datasets": [{"id": "dataset-1", "name": "Product Docs"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                    }
                ],
            }
        }
    )

    manifest = build_runtime_feature_manifest(soul)
    assert "knowledge" in manifest["supported"]
    assert "knowledge" not in manifest["reserved"]
    assert manifest["reserved_status"]["knowledge"] == "supported_by_knowledge_layer"
    assert all("knowledge" not in w["section"] for w in manifest["unsupported_runtime_warnings"])


def test_feature_manifest_treats_empty_knowledge_sets_as_not_configured():
    from core.workflow.nodes.agent_v2.runtime_feature_manifest import build_runtime_feature_manifest

    soul = AgentSoulConfig.model_validate(
        {
            "knowledge": {
                "sets": [],
            }
        }
    )

    manifest = build_runtime_feature_manifest(soul)
    assert manifest["reserved_status"]["knowledge"] == "not_configured"
