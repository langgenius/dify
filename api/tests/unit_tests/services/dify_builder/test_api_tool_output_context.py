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
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage
from tests.unit_tests.services.dify_builder.installed_tool_inventory import (
    TENANT_ID,
    FakeToolDaemon,
    forbid_secret_and_business_calls,
    install_fake_daemon,
)
from tests.unit_tests.services.tools.test_api_tool_catalogue import ACTION, PROVIDER_ID, _add_provider

type PublicApi = tuple[Engine, list[str]]


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
        self.requests: list[tuple[dict[str, object], bool]] = []

    def invoke_llm(
        self, *, prompt_messages: Sequence[PromptMessage], model_parameters: dict[str, object], stream: bool
    ) -> LLMResult:
        self.prompts.append(str(prompt_messages[-1].content))
        self.requests.append((model_parameters, stream))
        return LLMResult(
            model="fixture",
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(content='{"config":{}}'),
            usage=LLMUsage.empty_usage(),
        )


def _capture_consumer(entry: ToolCatalogueEntry, *, target: str = "node3", planned_api_count: int = 1) -> str:
    model = CapturingModel()
    nodes = [
        {"id": "node1", "node_type": "start"},
        {
            "id": "node2",
            "node_type": "tool",
            "tool": {"provider_id": PROVIDER_ID, "tool_name": ACTION},
        },
        {"id": "node3", "node_type": "code"},
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
        instruction="Use runtime keyword, fixed24h/5, return only title/url result. No LLM workflow node.",
        ideal_output="",
        target_node={"id": target, "node_type": "code", "label": "Project", "purpose": "Project requested records."},
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
