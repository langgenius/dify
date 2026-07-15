import sys
import types
from typing import cast

from pydantic import BaseModel


if "pydantic_settings" not in sys.modules:
    pydantic_settings = types.ModuleType("pydantic_settings")
    pydantic_settings.BaseSettings = BaseModel
    pydantic_settings.SettingsConfigDict = dict
    sys.modules["pydantic_settings"] = pydantic_settings

if "graphon.model_runtime.entities.llm_entities" not in sys.modules:
    graphon_module = types.ModuleType("graphon")
    model_runtime_module = types.ModuleType("graphon.model_runtime")
    entities_module = types.ModuleType("graphon.model_runtime.entities")
    llm_entities_module = types.ModuleType("graphon.model_runtime.entities.llm_entities")
    message_entities_module = types.ModuleType("graphon.model_runtime.entities.message_entities")

    llm_entities_module.LLMResultChunk = type("LLMResultChunk", (), {})
    llm_entities_module.LLMUsage = type("LLMUsage", (), {})

    for name in (
        "AssistantPromptMessage",
        "AudioPromptMessageContent",
        "DocumentPromptMessageContent",
        "ImagePromptMessageContent",
        "PromptMessage",
        "PromptMessageContentUnionTypes",
        "PromptMessageTool",
        "SystemPromptMessage",
        "TextPromptMessageContent",
        "ToolPromptMessage",
        "UserPromptMessage",
        "VideoPromptMessageContent",
    ):
        setattr(message_entities_module, name, type(name, (), {}))

    sys.modules["graphon"] = graphon_module
    sys.modules["graphon.model_runtime"] = model_runtime_module
    sys.modules["graphon.model_runtime.entities"] = entities_module
    sys.modules["graphon.model_runtime.entities.llm_entities"] = llm_entities_module
    sys.modules["graphon.model_runtime.entities.message_entities"] = message_entities_module

    graphon_module.model_runtime = model_runtime_module
    model_runtime_module.entities = entities_module
    entities_module.llm_entities = llm_entities_module
    entities_module.message_entities = message_entities_module

if "jsonschema" not in sys.modules:
    jsonschema_module = types.ModuleType("jsonschema")
    jsonschema_exceptions_module = types.ModuleType("jsonschema.exceptions")
    jsonschema_protocols_module = types.ModuleType("jsonschema.protocols")
    jsonschema_validators_module = types.ModuleType("jsonschema.validators")

    class _SchemaError(Exception):
        pass

    class _ValidationError(Exception):
        path: tuple[object, ...] = ()

    class _Validator:
        @staticmethod
        def check_schema(schema):
            return None

        def __init__(self, schema):
            self.schema = schema

        def iter_errors(self, value):
            return iter(())

    def _validator_for(schema):
        return _Validator

    jsonschema_module.SchemaError = _SchemaError
    jsonschema_exceptions_module.ValidationError = _ValidationError
    jsonschema_protocols_module.Validator = _Validator
    jsonschema_validators_module.validator_for = _validator_for

    sys.modules["jsonschema"] = jsonschema_module
    sys.modules["jsonschema.exceptions"] = jsonschema_exceptions_module
    sys.modules["jsonschema.protocols"] = jsonschema_protocols_module
    sys.modules["jsonschema.validators"] = jsonschema_validators_module

from dify_agent.adapters.shell.protocols import ShellProviderProtocol
from dify_agent.layers.dify_core_tools import DIFY_CORE_TOOLS_LAYER_TYPE_ID, DifyCoreToolsLayerConfig
from dify_agent.layers.dify_core_tools.layer import DifyCoreToolsLayer
from dify_agent.layers.shell import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.shell.layer import DifyShellLayer
from dify_agent.runtime.compositor_factory import create_default_layer_providers


class FakeProvider:
    """No-op provider for tests that never actually open a shell resource."""

    async def create(self) -> object:
        raise AssertionError("create should not be called by these tests")


def test_default_layer_providers_wire_provided_shell_provider() -> None:
    fake_provider = FakeProvider()

    providers = create_default_layer_providers(
        shell_provider=cast(ShellProviderProtocol, fake_provider),
        shell_home_root="/tmp/dify-agent-home",
    )
    shell_provider = next(provider for provider in providers if provider.type_id == DIFY_SHELL_LAYER_TYPE_ID)
    shell_layer = shell_provider.create_layer(DifyShellLayerConfig())

    assert isinstance(shell_layer, DifyShellLayer)
    assert shell_layer.shell_provider is fake_provider
    assert shell_layer.shell_home_root == "/tmp/dify-agent-home"


def test_default_layer_providers_forward_agent_stub_token_factory() -> None:
    captured_calls: list[tuple[DifyExecutionContextLayerConfig, str | None]] = []

    def build_agent_stub_token(
        execution_context: DifyExecutionContextLayerConfig,
        *,
        session_id: str | None,
    ) -> str:
        captured_calls.append((execution_context, session_id))
        return f"token-for:{execution_context.tenant_id}:{session_id}"

    providers = create_default_layer_providers(
        shell_provider=cast(ShellProviderProtocol, FakeProvider()),
        agent_stub_api_base_url="https://agent.example.com/agent-stub",
        agent_stub_token_factory=build_agent_stub_token,
    )
    shell_provider = next(provider for provider in providers if provider.type_id == DIFY_SHELL_LAYER_TYPE_ID)
    shell_layer = shell_provider.create_layer(DifyShellLayerConfig())

    token = shell_layer.agent_stub_token_factory(
        DifyExecutionContextLayerConfig(
            tenant_id="tenant-1",
            user_id="user-1",
            user_from="account",
            agent_mode="workflow_run",
            invoke_from="service-api",
        ),
        session_id="abc12ff",
    )

    assert token == "token-for:tenant-1:abc12ff"
    assert captured_calls == [
        (
            DifyExecutionContextLayerConfig(
                tenant_id="tenant-1",
                user_id="user-1",
                user_from="account",
                agent_mode="workflow_run",
                invoke_from="service-api",
            ),
            "abc12ff",
        )
    ]


def test_default_layer_providers_register_core_tools_layer() -> None:
    providers = create_default_layer_providers(inner_api_url="http://dify-api", inner_api_key="inner-secret")

    core_provider = next(provider for provider in providers if provider.type_id == DIFY_CORE_TOOLS_LAYER_TYPE_ID)
    layer = core_provider.create_layer(DifyCoreToolsLayerConfig())

    assert isinstance(layer, DifyCoreToolsLayer)
    assert layer.type_id == DIFY_CORE_TOOLS_LAYER_TYPE_ID
    assert layer.inner_api_url == "http://dify-api"
    assert layer.inner_api_key == "inner-secret"
    assert layer.config == DifyCoreToolsLayerConfig()
