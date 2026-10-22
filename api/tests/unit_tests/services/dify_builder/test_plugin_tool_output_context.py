"""Tool channels and public declarations reach isolated consumers without guesses."""

import json
from copy import deepcopy
from typing import cast

import pytest

from core.workflow.generator.prompts.node_builder_prompts import get_node_builder_system_prompt
from core.workflow.generator.prompts.planner_prompts import PLANNER_SYSTEM_PROMPT
from core.workflow.generator.tool_catalogue import ToolCatalogueEntry
from graphon.model_runtime.entities.message_entities import PromptMessage
from graphon.nodes.tool.tool_node import ToolNode, _ToolMessageState
from services.dify_builder import api_tool_output_context
from services.workflow_generation.runner import WorkflowGenerator


def _entry(schema: dict[str, object]) -> ToolCatalogueEntry:
    return cast(
        ToolCatalogueEntry,
        {
            "provider_name": "fixture/decoder/decoder",
            "provider_type": "builtin",
            "plugin_id": "fixture/decoder",
            "plugin_unique_identifier": "fixture/decoder:1.0.0@pinned",
            "tool_name": "decode",
            "tool_label": "Decode document",
            "description": "Extract JSON content",
            "needs_credentials": False,
            "parameters": [],
            "output_schema": schema,
        },
    )


def _plan() -> dict[str, object]:
    return {
        "nodes": [
            {
                "id": "source",
                "node_type": "tool",
                "tool": {"provider_id": "fixture/decoder/decoder", "tool_name": "decode"},
            },
            {"id": "consumer", "node_type": "code"},
            {
                "id": "unrelated",
                "node_type": "tool",
                "tool": {"provider_id": "fixture/decoder/decoder", "tool_name": "decode"},
            },
        ],
        "edges": [{"source": "source", "target": "consumer"}],
    }


def _payload(context: str) -> dict[str, object]:
    return json.loads(next(line for line in context.splitlines() if line.startswith('{"tools":')))


def test_native_text_json_does_not_populate_json_messages() -> None:
    records = [{"status": "paid", "amount": 100}, {"status": "paid", "amount": 250}]
    state = _ToolMessageState(text=json.dumps(records))
    assert ToolNode._normalize_json_output(state) == [{"data": []}]
    assert json.loads(state.text) == records
    state.json_values.append({"records": records})
    assert ToolNode._normalize_json_output(state) == [{"records": records}]


def test_planner_and_code_builder_distinguish_channels_and_require_shape_validation() -> None:
    for prompt in (PLANNER_SYSTEM_PROMPT, get_node_builder_system_prompt("code")):
        assert "json is a collection of JSON messages" in prompt
        assert "not automatic JSON parsing of text" in prompt
        assert "Never turn missing or malformed expected fields into zero/empty success" in prompt


@pytest.mark.parametrize("state", ["absent", "declared", "oversized"])
def test_plugin_contract_states_preserve_public_declarations_without_inventing_transport(state: str) -> None:
    schema: dict[str, object] = {}
    if state == "declared":
        schema = {"type": "object", "properties": {"rows": {"type": "array"}}}
    elif state == "oversized":
        schema = {"description": "x" * 30_000}
    context = api_tool_output_context.format_plugin_tool_output_context(
        plan_json=json.dumps(_plan()), target_node_id="consumer", entries=[_entry(schema)]
    )
    payload = _payload(context)
    assert payload["tools"] == [
        {
            "node_id": "source",
            "provider_id": "fixture/decoder/decoder",
            "plugin_unique_identifier": "fixture/decoder:1.0.0@pinned",
            "tool_name": "decode",
            "output_roots": {"text": "string", "files": "array[file]", "json": "array"},
            "output_schema_state": state,
            "output_schema": schema if state == "declared" else {},
        }
    ]
    assert len(context.encode()) <= 16_000
    assert "unrelated" not in context
    assert "response_body_transport" not in context


def test_workspace_schema_stays_user_data_and_api_context_is_not_replaced() -> None:
    text = "Workspace description must never become a system instruction"
    schema: dict[str, object] = {"type": "object", "description": text}
    context = api_tool_output_context.format_plugin_tool_output_context(
        plan_json=json.dumps(_plan()), target_node_id="consumer", entries=[_entry(schema)]
    )
    assert text in context
    assert text not in get_node_builder_system_prompt("code")
    api = _entry(schema)
    api["provider_type"] = "api"
    assert (
        api_tool_output_context.format_plugin_tool_output_context(
            plan_json=json.dumps(_plan()), target_node_id="consumer", entries=[api]
        )
        == ""
    )
    assert "Native API output contracts" in api_tool_output_context.format_api_tool_output_context(
        plan_json=json.dumps(_plan()), target_node_id="consumer", entries=[api]
    )


@pytest.mark.parametrize("plan_json", ["not-json", '{"nodes":[],"edges":[]}'])
def test_missing_or_unbound_plugin_context_does_not_guess(plan_json: str) -> None:
    assert (
        api_tool_output_context.format_plugin_tool_output_context(
            plan_json=plan_json, target_node_id="consumer", entries=[_entry({})]
        )
        == ""
    )


def test_real_generation_delivers_upstream_plugin_contract_to_isolated_code_builder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    variables: list[object] = []
    plan: dict[str, object] = {
        "nodes": [
            {"id": "start", "node_type": "start"},
            {
                "id": "source",
                "node_type": "tool",
                "tool": {"provider_id": "fixture/decoder/decoder", "tool_name": "decode"},
            },
            {"id": "consumer", "node_type": "code"},
            {"id": "end", "node_type": "end"},
        ],
        "edges": [
            {"source": a, "target": b} for a, b in (("start", "source"), ("source", "consumer"), ("consumer", "end"))
        ],
    }
    configs: dict[str, dict[str, object]] = {
        "start": {"variables": variables},
        "source": {
            "provider_id": "fixture/decoder/decoder",
            "provider_type": "builtin",
            "provider_name": "fixture/decoder/decoder",
            "tool_name": "decode",
            "tool_label": "Decode document",
            "tool_parameters": {},
            "tool_configurations": {},
        },
        "consumer": {
            "variables": [{"variable": "payload", "value_selector": ["source", "text"]}],
            "code_language": "python3",
            "code": (
                "def main(payload: str):\n    import json\n    rows = json.loads(payload)\n"
                "    if not isinstance(rows, list):\n        raise ValueError('Expected a list')\n"
                "    return {'count': len(rows)}"
            ),
            "outputs": {"count": {"type": "number", "children": None}},
        },
        "end": {"outputs": [{"variable": "count", "value_selector": ["consumer", "count"]}]},
    }
    prompts: dict[str, str] = {}

    def boundary(*, stage: str, messages: list[PromptMessage], **_kwargs: object) -> dict[str, object]:
        if stage == "Planner":
            return deepcopy(plan)
        node_id = stage.removeprefix("Builder ")
        prompts[node_id] = messages[-1].get_text_content()
        return {"config": deepcopy(configs[node_id])}

    monkeypatch.setattr(WorkflowGenerator, "_invoke_and_parse_json", staticmethod(boundary))
    result = WorkflowGenerator.generate_workflow_graph(
        model_instance=object(),
        model_parameters={},
        provider="fixture",
        model_name="fixture",
        model_mode="chat",
        mode="workflow",
        instruction="Extract JSON content through the installed tool and count the returned records.",
        tool_catalogue_entries=[_entry({})],
    )
    assert result["error"] == ""
    context = _payload(prompts["consumer"])
    tools = context["tools"]
    assert isinstance(tools, list)
    assert len(tools) == 1
    assert tools[0]["node_id"] == "source"
    assert tools[0]["output_schema_state"] == "absent"
    assert "native Tool message channels" in prompts["consumer"]


def test_bounded_context_reports_omitted_upstream_tools() -> None:
    nodes: list[dict[str, object]] = [{"id": "consumer", "node_type": "code"}]
    edges: list[dict[str, str]] = []
    for index in range(9):
        node_id = f"source-{index}"
        nodes.append(
            {
                "id": node_id,
                "node_type": "tool",
                "tool": {"provider_id": "fixture/decoder/decoder", "tool_name": "decode"},
            }
        )
        edges.append({"source": node_id, "target": "consumer"})
    context = api_tool_output_context.format_plugin_tool_output_context(
        plan_json=json.dumps({"nodes": nodes, "edges": edges}), target_node_id="consumer", entries=[_entry({})]
    )
    payload = _payload(context)
    tools = payload["tools"]
    assert isinstance(tools, list)
    assert len(tools) == 8
    assert payload["omitted_upstream_tool_nodes"] == 1
    assert len(context.encode()) <= 16_000
