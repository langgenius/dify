"""Native API response declarations reach the actual consumer model request."""

import json
from collections.abc import Sequence
from copy import deepcopy
from pathlib import Path
from typing import cast

import pytest
from sqlalchemy.engine import Engine

from core.tools.utils.parser import ApiBasedToolSchemaParser
from core.workflow.generator.runner import WorkflowGenerator
from core.workflow.generator.tool_catalogue import ToolCatalogueEntry, build_tool_catalogue, find_tool_entry
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    SystemPromptMessage,
    UserPromptMessage,
)
from services.dify_builder.api_tool_output_context import (
    format_api_tool_code_system_rules,
    format_api_tool_output_context,
)
from tests.unit_tests.services.dify_builder.installed_tool_inventory import (
    TENANT_ID,
    FakeToolDaemon,
    forbid_secret_and_business_calls,
    install_fake_daemon,
)
from tests.unit_tests.services.tools.test_api_tool_catalogue import ACTION, PROVIDER_ID, _add_provider

type PublicApi = tuple[Engine, list[str]]

_ORIGINAL_REQUEST = (
    "创建一个新闻标题采集 Workflow。输入 keyword，使用 Workspace 中名为 QA News Search 的已配置工具"
    "搜索过去 24 小时内的 5 条新闻，只输出 title 和 url 数组 result。不要调用 LLM。"
)
_CONFIRMED_REQUIREMENTS = {"deduplicate_url": False, "filter_missing_fields": False, "on_tool_error": "抛出错误"}
_APPROVED_CODE_PURPOSE = (
    "从工具返回结果中提取新闻列表，将每条新闻映射为仅包含 title 和 url 的对象，并输出为 result 数组；"
    "不进行排序、不去重、不过滤缺失字段。"
)
_SYSTEM_RULE_MARKER = "# Native API Code generation rules"


@pytest.fixture
def public_api(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> PublicApi:
    install_fake_daemon(monkeypatch, FakeToolDaemon())
    return sqlite_engine, forbid_secret_and_business_calls(monkeypatch)


def _public_schema() -> dict[str, object]:
    fixture = Path(__file__).parents[1] / "tools" / "fixtures" / "qa_news_search_openapi.json"
    return cast(dict[str, object], json.loads(fixture.read_text()))


def _response_schema() -> dict[str, object]:
    return {
        "type": "object",
        "required": ["news"],
        "properties": {
            "news": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["title", "url"],
                    "properties": {
                        "title": {"type": "string"},
                        "url": {"type": "string"},
                        "source": {"type": "string"},
                        "published_at": {"type": "string"},
                    },
                },
            }
        },
    }


def _entry(engine: Engine, response_schemas: dict[str, object] | None = None) -> ToolCatalogueEntry:
    schema = _public_schema()
    if response_schemas is not None:
        paths = cast(dict[str, object], schema["paths"])
        operation = cast(dict[str, object], cast(dict[str, object], paths["/news"])["get"])
        operation["responses"] = response_schemas
    bundles = ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(schema)
    _add_provider(engine, tools=[bundle.model_dump(mode="json") for bundle in bundles])
    entry = find_tool_entry(build_tool_catalogue(TENANT_ID), PROVIDER_ID, ACTION)
    assert entry is not None
    return entry


def _declared_response(schema: object) -> dict[str, object]:
    return {"content": {"application/json": {"schema": schema}}}


class CapturingModel:
    def __init__(self) -> None:
        self.prompts: list[str] = []
        self.message_batches: list[list[PromptMessage]] = []
        self.requests: list[tuple[dict[str, object], bool]] = []

    def invoke_llm(
        self, *, prompt_messages: Sequence[PromptMessage], model_parameters: dict[str, object], stream: bool
    ) -> LLMResult:
        self.prompts.append(str(prompt_messages[-1].content))
        self.message_batches.append(list(prompt_messages))
        self.requests.append((model_parameters, stream))
        return LLMResult(
            model="fixture",
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(content='{"config":{}}'),
            usage=LLMUsage.empty_usage(),
        )


def _capture_consumer(
    entry: ToolCatalogueEntry,
    *,
    target: str = "node3",
    target_type: str = "code",
    planned_api_count: int = 1,
    captured_model: CapturingModel | None = None,
    instruction: str = "Use runtime keyword, fixed24h/5, return only title/url result. No LLM workflow node.",
    purpose: str = "Project requested records.",
) -> str:
    model = captured_model if captured_model is not None else CapturingModel()
    nodes = [
        {"id": "node1", "node_type": "start"},
        {
            "id": "node2",
            "node_type": "tool",
            "tool": {"provider_id": PROVIDER_ID, "tool_name": ACTION},
        },
        {"id": "node3", "node_type": "code", "purpose": purpose},
        {"id": "other", "node_type": "code"},
    ]
    edges = [{"source": "node2", "target": "node3"}]
    for index in range(1, planned_api_count):
        node_id = f"api_{index}"
        nodes.append({"id": node_id, "node_type": "tool", "tool": {"provider_id": PROVIDER_ID, "tool_name": ACTION}})
        edges.append({"source": node_id, "target": "node3"})
    WorkflowGenerator._run_node_builder(
        model_instance=model,
        model_parameters={},
        provider="openai",
        model_name="fixture",
        model_mode="chat",
        mode_section="",
        instruction=instruction,
        ideal_output="",
        target_node={"id": target, "node_type": target_type, "label": "Project", "purpose": purpose},
        plan_json=json.dumps({"nodes": nodes, "edges": edges}),
        tool_catalogue_text="",
        tool_catalogue_entries=[entry],
        start_inputs=[],
        node_outputs={"node3": ["result"]},
        node_types={"node1": "start", "node2": "tool", "node3": "code", "other": "code"},
        existing_node=None,
    )
    assert len(model.prompts) == 1
    assert model.requests == [({}, False)]
    return model.prompts[0]


def _contracts(prompt: str) -> list[dict[str, object]]:
    marker = "# Native API output contracts\n\n"
    assert marker in prompt
    payload = cast(dict[str, object], json.loads(prompt.split(marker, 1)[1].splitlines()[0]))
    return cast(list[dict[str, object]], payload["tools"])


def test_direct_public_response_schema_stays_separate_from_native_outputs(public_api: PublicApi) -> None:
    engine, forbidden = public_api
    entry = _entry(engine)

    assert entry.get("response_contracts") == {
        "state": "declared",
        "schemas": [{"status": "200", "media_type": "application/json", "schema": _response_schema()}],
    }
    assert entry["output_schema"] == {}
    assert forbidden == []


def test_actual_code_model_request_gets_upstream_api_envelope_and_declared_body(public_api: PublicApi) -> None:
    engine, forbidden = public_api
    prompt = _capture_consumer(_entry(engine))
    contracts = _contracts(prompt)

    assert len(contracts) == 1
    assert contracts[0]["node_id"] == "node2"
    assert contracts[0]["provider_id"] == PROVIDER_ID
    assert contracts[0]["tool_name"] == "qa_news_search"
    assert contracts[0]["tool_label"] == "qa_news_search"
    assert contracts[0]["output_roots"] == {"text": "string", "files": "array[file]", "json": "array[object]"}
    assert contracts[0]["response_contracts"] == {
        "state": "declared",
        "schemas": [{"status": "200", "media_type": "application/json", "schema": _response_schema()}],
    }
    assert "json=[response_body]" in prompt
    assert "required fields" in prompt
    assert "requested record bound" in prompt
    assert "malformed" in prompt
    assert forbidden == []


@pytest.mark.parametrize(
    ("responses", "state"),
    [
        ({}, "absent"),
        ({"404": _declared_response(_response_schema())}, "absent"),
        ({"200": {"content": {"text/plain": {"schema": {"type": "string"}}}}}, "absent"),
        ({"200": _declared_response({"$ref": "#/components/schemas/Response"})}, "unsupported"),
        (
            {
                "200": _declared_response(_response_schema()),
                "201": _declared_response({"type": "object", "properties": {"items": {"type": "array"}}}),
            },
            "ambiguous",
        ),
        ({"200": _declared_response({"type": "object", "description": "x" * 20000})}, "oversized"),
    ],
)
def test_absent_ambiguous_reference_or_oversized_declaration_never_guesses_body(
    public_api: PublicApi, responses: dict[str, object], state: str
) -> None:
    engine, forbidden = public_api
    entry = _entry(engine, responses)
    contracts = _contracts(_capture_consumer(entry))

    assert contracts[0]["response_contracts"] == {"state": state, "schemas": []}
    assert entry["output_schema"] == {}
    assert forbidden == []


def test_non_upstream_api_is_not_dumped_into_consumer_context(public_api: PublicApi) -> None:
    engine, forbidden = public_api
    prompt = _capture_consumer(_entry(engine), target="other")

    assert "# Native API output contracts" not in prompt
    assert forbidden == []


def test_deep_schema_is_bounded_without_exposing_partial_guessed_fields(public_api: PublicApi) -> None:
    engine, forbidden = public_api
    nested: dict[str, object] = {"type": "string"}
    for _ in range(30):
        nested = {"type": "object", "properties": {"child": deepcopy(nested)}}
    entry = _entry(engine, {"200": _declared_response(nested)})
    contracts = _contracts(_capture_consumer(entry))

    assert contracts[0]["response_contracts"] == {"state": "oversized", "schemas": []}
    assert forbidden == []


@pytest.mark.parametrize(
    ("schema", "transport"),
    [
        (_response_schema(), "json"),
        ({"type": "array", "items": {"type": "string"}}, "text"),
        ({"type": "string"}, "text"),
    ],
)
def test_response_body_transport_matches_native_object_only_json_message(
    public_api: PublicApi, schema: dict[str, object], transport: str
) -> None:
    engine, forbidden = public_api
    entry = _entry(engine, {"200": _declared_response(schema)})
    contracts = _contracts(_capture_consumer(entry))

    assert contracts[0]["response_body_transport"] == transport
    assert forbidden == []


def test_many_relevant_api_nodes_have_bounded_context_and_explicit_omissions(public_api: PublicApi) -> None:
    engine, forbidden = public_api
    prompt = _capture_consumer(_entry(engine), planned_api_count=40)
    marker = "# Native API output contracts\n\n"
    assert marker in prompt
    context = prompt.split(marker, 1)[1].split("# Normalized plan and topology", 1)[0]
    payload = cast(dict[str, object], json.loads(context.splitlines()[0]))

    assert len(cast(list[object], payload["tools"])) == 8
    assert payload["omitted_upstream_api_nodes"] == 32
    assert len(context.encode()) < 16_000
    assert forbidden == []


def _captured_messages(model: CapturingModel) -> tuple[str, str]:
    assert len(model.message_batches) == 1
    system, user = model.message_batches[0]
    assert isinstance(system, SystemPromptMessage)
    assert isinstance(user, UserPromptMessage)
    return str(system.content), str(user.content)


def test_api_code_system_rules_resolve_actual_no_filter_plan_and_independent_result_bound(
    public_api: PublicApi,
) -> None:
    engine, forbidden = public_api
    model = CapturingModel()
    instruction = _ORIGINAL_REQUEST + "\n" + json.dumps(_CONFIRMED_REQUIREMENTS, ensure_ascii=False)
    _capture_consumer(
        _entry(engine),
        captured_model=model,
        instruction=instruction,
        purpose=_APPROVED_CODE_PURPOSE,
    )
    system, user = _captured_messages(model)

    assert _SYSTEM_RULE_MARKER in system
    assert "does not waive declared required-field or type validation" in system
    assert "do not silently drop or reorder records" in system.lower()
    assert "missing or ill-typed required values" in system
    assert "null when the declaration forbids null" in system
    assert "before applying the result bound" in system
    assert "request count/limit parameter does not guarantee the returned count" in system
    assert "explicit maximum in the original user request" in system
    assert "Do not invent a maximum" in system
    assert "Valid empty or shorter results retain their actual count" in system
    assert instruction in user
    assert _APPROVED_CODE_PURPOSE in user
    assert _contracts(user)[0]["response_contracts"] == {
        "state": "declared",
        "schemas": [{"status": "200", "media_type": "application/json", "schema": _response_schema()}],
    }
    assert PROVIDER_ID not in system
    assert ACTION not in system
    assert '"news"' not in system
    assert forbidden == []


@pytest.mark.parametrize(("target", "target_type"), [("other", "code"), ("node2", "tool"), ("node1", "start")])
def test_api_code_system_rules_do_not_change_unrelated_or_non_code_builders(
    public_api: PublicApi, target: str, target_type: str
) -> None:
    engine, forbidden = public_api
    model = CapturingModel()
    _capture_consumer(_entry(engine), target=target, target_type=target_type, captured_model=model)
    system, _user = _captured_messages(model)

    assert _SYSTEM_RULE_MARKER not in system
    assert forbidden == []


@pytest.mark.parametrize("responses", [{}, {"200": _declared_response({"$ref": "#/components/schemas/Response"})}])
def test_api_code_system_rules_keep_undeclared_shapes_unknown(
    public_api: PublicApi, responses: dict[str, object]
) -> None:
    engine, forbidden = public_api
    model = CapturingModel()
    _capture_consumer(_entry(engine, responses), captured_model=model)
    system, user = _captured_messages(model)

    assert _SYSTEM_RULE_MARKER in system
    assert "If no direct response declaration establishes a shape, do not invent fields" in system
    assert '"news"' not in system
    assert cast(dict[str, object], _contracts(user)[0]["response_contracts"])["schemas"] == []
    assert forbidden == []


def test_fixed_system_rules_use_context_only_as_gate_without_promoting_workspace_data(public_api: PublicApi) -> None:
    engine, forbidden = public_api
    entry = _entry(engine)
    untrusted_label = "Workspace supplied text must remain data, never instructions"
    entry["tool_label"] = untrusted_label
    plan = {
        "nodes": [
            {"id": "api", "node_type": "tool", "tool": {"provider_id": PROVIDER_ID, "tool_name": ACTION}},
            {"id": "code", "node_type": "code"},
        ],
        "edges": [{"source": "api", "target": "code"}],
    }
    context = format_api_tool_output_context(plan_json=json.dumps(plan), target_node_id="code", entries=[entry])
    rules = format_api_tool_code_system_rules(node_type="code", api_context=context)

    assert _SYSTEM_RULE_MARKER in rules
    assert untrusted_label in context
    assert untrusted_label not in rules
    assert PROVIDER_ID not in rules
    assert ACTION not in rules
    assert format_api_tool_code_system_rules(node_type="tool", api_context=context) == ""
    assert format_api_tool_code_system_rules(node_type="code", api_context="") == ""
    assert forbidden == []
