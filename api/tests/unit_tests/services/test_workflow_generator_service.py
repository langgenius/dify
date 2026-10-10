"""Exercise service wiring through the real model, tool catalogue and graph generator.

Only provider discovery, schema lookup, Redis commands and plugin-daemon I/O are
isolated. Delegating spies preserve the production generator and runtime behavior.
"""

import json
from collections.abc import Callable, Generator, Iterator
from dataclasses import dataclass, field

import pytest
from redis import Redis

from core.app.app_config.entities import ModelConfig
from core.credit_usage import CreditUsageAppType, CreditUsageCreatedBy
from core.entities.provider_configuration import ProviderModelBundle
from core.entities.provider_entities import CustomProviderConfiguration
from core.model_manager import ModelInstance
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from core.provider_manager import ProviderManager
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolProviderEntityWithPlugin,
    ToolProviderIdentity,
)
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_manager import ToolManager
from core.workflow.generator import WorkflowGenerator
from extensions.ext_redis import RedisClientWrapper
from graphon.model_runtime.entities.llm_entities import LLMMode, LLMResultChunk, LLMResultChunkDelta
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from services.workflow_generator_service import WorkflowGeneratorService
from tests.unit_tests.core.model_fixtures import make_model_config

TENANT_ID = "t-1"
PROVIDER = "langgenius/openai/openai"


def _model_config() -> ModelConfig:
    return ModelConfig(provider=PROVIDER, name="gpt-4o", mode=LLMMode.CHAT, completion_params={"temperature": 0.4})


def _record[**P, R](function: Callable[P, R], calls: list[dict[str, object]]) -> Callable[P, R]:
    """Observe keyword arguments and execute the original method unchanged."""

    def delegated(*args: P.args, **kwargs: P.kwargs) -> R:
        calls.append(dict(kwargs))
        return function(*args, **kwargs)

    return delegated


@dataclass
class GenerationObservations:
    """Fixture data and captured calls, not a substitute for a production dependency."""

    bundle: ProviderModelBundle
    providers: list[PluginToolProviderController] = field(default_factory=list)
    generator_calls: list[dict[str, object]] = field(default_factory=list)
    runtime_calls: list[dict[str, object]] = field(default_factory=list)
    daemon_calls: list[dict[str, object]] = field(default_factory=list)
    resolutions: list[tuple[str, str, ModelType]] = field(default_factory=list)


@pytest.fixture
def generation(monkeypatch: pytest.MonkeyPatch) -> Iterator[GenerationObservations]:
    config = make_model_config(provider=PROVIDER, model="gpt-4o", mode="chat")
    bundle = config.provider_model_bundle
    bundle.configuration.tenant_id = TENANT_ID
    bundle.configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "token"})
    bundle.model_type_instance = LargeLanguageModel(
        provider_schema=bundle.configuration.provider,
        model_runtime=create_plugin_model_runtime(tenant_id=TENANT_ID),
    )
    observed = GenerationObservations(bundle=bundle)

    def provider_bundle(
        _manager: ProviderManager, *, tenant_id: str, provider: str, model_type: ModelType
    ) -> ProviderModelBundle:
        observed.resolutions.append((tenant_id, provider, model_type))
        return bundle

    def providers(tenant_id: str) -> list[PluginToolProviderController]:
        assert tenant_id == TENANT_ID
        return observed.providers

    def dispatch(_client: PluginModelClient, **kwargs: object) -> Generator[LLMResultChunk]:
        observed.daemon_calls.append(kwargs)
        data = kwargs["data"]
        assert isinstance(data, dict)
        messages = data["data"]["prompt_messages"]
        system_prompt = messages[0]["content"]
        user_prompt = messages[-1]["content"]
        if "workflow planner" in system_prompt.lower():
            terminal = "answer" if "# Mode\n\nadvanced-chat" in user_prompt else "end"
            response: dict[str, object] = {
                "title": "Generated graph",
                "description": "ok",
                "nodes": [
                    {"id": "start", "node_type": "start", "label": "Start", "purpose": "Input"},
                    {"id": "finish", "node_type": terminal, "label": "Finish", "purpose": "Output"},
                ],
                "edges": [{"source": "start", "target": "finish"}],
            }
        else:
            response = {"config": {"variables": [], "outputs": [], "answer": "Done"}}
        yield LLMResultChunk(
            model="gpt-4o",
            delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content=json.dumps(response))),
        )

    monkeypatch.setattr(ProviderManager, "get_provider_model_bundle", provider_bundle)
    monkeypatch.setattr(ToolManager, "list_builtin_providers", providers)
    monkeypatch.setattr(PluginModelClient, "get_model_schema", lambda *_args, **_kwargs: config.model_schema)
    monkeypatch.setattr(PluginModelClient, "_request_with_plugin_daemon_response_stream", dispatch)
    monkeypatch.setattr(
        PluginModelRuntime, "invoke_llm", _record(PluginModelRuntime.invoke_llm, observed.runtime_calls)
    )
    monkeypatch.setattr(
        WorkflowGenerator,
        "_iter_generation_events",
        _record(WorkflowGenerator._iter_generation_events, observed.generator_calls),
    )
    with Redis() as client:
        monkeypatch.setattr(client, "execute_command", lambda *_args, **_kwargs: None)
        redis = RedisClientWrapper()
        redis.initialize(client)
        monkeypatch.setattr("core.plugin.impl.model_runtime.redis_client", redis)
        yield observed


def _planner_prompt(generation: GenerationObservations) -> str:
    data = generation.daemon_calls[0]["data"]
    assert isinstance(data, dict)
    return data["data"]["prompt_messages"][-1]["content"]


def _assert_model_resolution(generation: GenerationObservations, app_type: CreditUsageAppType) -> None:
    assert generation.resolutions == [(TENANT_ID, PROVIDER, ModelType.LLM)]
    assert len(generation.generator_calls) == 1
    call = generation.generator_calls[0]
    instance = call["model_instance"]
    assert type(instance) is ModelInstance
    assert instance.provider_model_bundle is generation.bundle
    assert instance.credentials == {"api_key": "token"}
    assert call["provider"] == PROVIDER
    assert call["model_name"] == "gpt-4o"
    assert call["model_mode"] == "chat"
    assert call["model_parameters"] == {"temperature": 0.4}
    assert len(generation.runtime_calls) == len(generation.daemon_calls) == 3
    for runtime_call in generation.runtime_calls:
        assert runtime_call["request_metadata"] == {
            "app_type": app_type,
            "created_by": CreditUsageCreatedBy.WORKFLOW_GENERATION,
        }


def test_forwards_model_instance_and_complete_catalogue_to_generator(generation: GenerationObservations) -> None:
    label = I18nObject(en_US="Search")
    generation.providers.append(
        PluginToolProviderController(
            entity=ToolProviderEntityWithPlugin(
                identity=ToolProviderIdentity(author="test", name="google", description=label, icon="", label=label),
                tools=[
                    ToolEntity(
                        identity=ToolIdentity(author="test", name="search", label=label, provider="google"),
                        description=ToolDescription(human=label, llm="Search."),
                    )
                ],
            ),
            plugin_id="langgenius/google",
            plugin_unique_identifier="langgenius/google:1.0.0",
            tenant_id=TENANT_ID,
        )
    )
    result = WorkflowGeneratorService.generate_workflow_graph(
        tenant_id=TENANT_ID,
        mode="workflow",
        instruction="Summarize a URL",
        model_config=_model_config(),
        ideal_output="A 3-sentence summary",
    )

    _assert_model_resolution(generation, CreditUsageAppType.WORKFLOW)
    call = generation.generator_calls[0]
    assert call["instruction"] == "Summarize a URL"
    assert call["ideal_output"] == "A 3-sentence summary"
    assert call["tool_catalogue_text"] == ""
    assert call["installed_tools"] == {("google", "search")}
    assert call["tool_catalogue_entries"] == [
        {
            "provider_name": "google",
            "provider_type": "builtin",
            "plugin_id": "langgenius/google",
            "plugin_unique_identifier": "langgenius/google:1.0.0",
            "tool_name": "search",
            "tool_label": "Search",
            "description": "Search.",
            "parameters": [],
            "output_schema": {},
        }
    ]
    assert "google/search" in _planner_prompt(generation)
    assert "A 3-sentence summary" in _planner_prompt(generation)
    assert result["error"] == ""
    assert [node["data"]["type"] for node in result["graph"]["nodes"]] == ["start", "end"]


def test_catalogue_build_failure_falls_back_to_empty_text(
    generation: GenerationObservations, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A discovery outage must still run the real planner and builders without tool validation."""

    def unavailable(tenant_id: str) -> list[PluginToolProviderController]:
        assert tenant_id == TENANT_ID
        raise RuntimeError("plugin daemon unreachable")

    monkeypatch.setattr(ToolManager, "list_builtin_providers", unavailable)
    result = WorkflowGeneratorService.generate_workflow_graph(
        tenant_id=TENANT_ID, mode="workflow", instruction="Summarize a URL", model_config=_model_config()
    )
    assert result["error"] == ""
    call = generation.generator_calls[0]
    assert call["tool_catalogue_text"] == ""
    assert call["tool_catalogue_entries"] == []
    assert call["installed_tools"] is None
    _assert_model_resolution(generation, CreditUsageAppType.WORKFLOW)


def test_defaults_ideal_output_to_empty_string(generation: GenerationObservations) -> None:
    result = WorkflowGeneratorService.generate_workflow_graph(
        tenant_id=TENANT_ID, mode="advanced-chat", instruction="A chat bot", model_config=_model_config()
    )
    assert result["error"] == ""
    assert generation.generator_calls[0]["ideal_output"] == ""
    assert generation.generator_calls[0]["mode"] == "advanced-chat"
    assert "# Ideal output" not in _planner_prompt(generation)
    _assert_model_resolution(generation, CreditUsageAppType.CHATFLOW)


def test_forwards_current_graph_for_refine(generation: GenerationObservations) -> None:
    graph: dict[str, object] = {"nodes": [{"id": "node1", "data": {"type": "start", "title": "Original"}}], "edges": []}
    result = WorkflowGeneratorService.generate_workflow_graph(
        tenant_id=TENANT_ID,
        mode="workflow",
        instruction="Add a translation step",
        model_config=_model_config(),
        current_graph=graph,
    )
    assert result["error"] == ""
    assert generation.generator_calls[0]["current_graph"] is graph
    assert "# Existing graph to refine" in _planner_prompt(generation)
    assert "id='node1' type='start' title='Original'" in _planner_prompt(generation)


def test_defaults_current_graph_to_none_for_create(generation: GenerationObservations) -> None:
    result = WorkflowGeneratorService.generate_workflow_graph(
        tenant_id=TENANT_ID, mode="workflow", instruction="Summarize a URL", model_config=_model_config()
    )
    assert result["error"] == ""
    assert generation.generator_calls[0]["current_graph"] is None
    assert generation.generator_calls[0]["installed_tools"] == set()
    assert "# Existing graph to refine" not in _planner_prompt(generation)


def test_auto_mode_forwards_sentinel_to_runner(generation: GenerationObservations) -> None:
    result = WorkflowGeneratorService.generate_workflow_graph(
        tenant_id=TENANT_ID, mode="auto", instruction="Summarize a URL", model_config=_model_config()
    )
    assert result["error"] == ""
    assert result["mode"] == "workflow"
    assert generation.generator_calls[0]["mode"] == "auto"
    _assert_model_resolution(generation, CreditUsageAppType.UNKNOWN)


def test_explicit_mode_passes_through_unchanged(generation: GenerationObservations) -> None:
    result = WorkflowGeneratorService.generate_workflow_graph(
        tenant_id=TENANT_ID, mode="advanced-chat", instruction="A chat bot", model_config=_model_config()
    )
    assert result["error"] == ""
    assert result["mode"] == "advanced-chat"
    assert generation.generator_calls[0]["mode"] == "advanced-chat"
    assert result["graph"]["nodes"][-1]["data"]["type"] == "answer"


def test_stream_delegates_to_runner_stream(generation: GenerationObservations) -> None:
    stream = WorkflowGeneratorService.generate_workflow_graph_stream(
        tenant_id=TENANT_ID, mode="workflow", instruction="Summarize a URL", model_config=_model_config()
    )
    name, plan = next(stream)
    assert name == "plan"
    assert plan["mode"] == "workflow"
    assert len(generation.daemon_calls) == 1  # Builders start only after the caller receives the plan.
    name, result = next(stream)
    assert name == "result"
    assert result["error"] == ""
    assert result["mode"] == "workflow"
    assert list(stream) == []
    assert generation.generator_calls[0]["mode"] == "workflow"
    _assert_model_resolution(generation, CreditUsageAppType.WORKFLOW)
