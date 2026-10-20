"""Native Agent v2 caller outputs survive shared generator validation."""

from copy import deepcopy

import pytest

from core.workflow.generator.prompts.node_builder_prompts import format_node_outputs_section
from models.agent_config_entities import WorkflowNodeJobConfig
from services.workflow_generation.runner import WorkflowGenerator, _parse_node_outputs


def _native_agent():
    job = WorkflowNodeJobConfig.model_validate(
        {
            "declared_outputs": [
                {"name": "risks", "type": "array", "array_item": {"type": "string"}},
                {"name": "summary", "type": "string"},
                {
                    "name": "review",
                    "type": "object",
                    "children": [{"name": "approved", "type": "boolean"}],
                },
            ]
        }
    )
    return {
        "id": "node2",
        "data": {
            "type": "agent",
            "version": "2",
            "agent_node_kind": "dify_agent",
            "agent_declared_outputs": [output.model_dump(mode="json") for output in job.declared_outputs],
            "agent_output_routes": job.output_routes.model_dump(mode="json"),
        },
    }


@pytest.mark.parametrize("variable", ["risks", "summary", "text", "review", "review.approved"])
def test_native_agent_declares_actual_caller_and_system_outputs(variable):
    assert WorkflowGenerator._declares_variable(_native_agent(), variable)


@pytest.mark.parametrize(
    "variable",
    [
        "missing",
        "switch",
        "_session",
        "summary.text",
        "text.summary",
        "risks.item",
        "review.missing",
        "review.approved.x",
    ],
)
def test_native_agent_rejects_undeclared_fields_and_invalid_nesting(variable):
    assert not WorkflowGenerator._declares_variable(_native_agent(), variable)


def test_native_agent_end_selectors_pass_without_rewriting_to_text():
    nodes = [
        _native_agent(),
        {
            "id": "node3",
            "data": {
                "type": "end",
                "outputs": [
                    {"variable": "risks", "value_selector": ["node2", "risks"]},
                    {"variable": "summary", "value_selector": ["node2", "summary"]},
                ],
            },
        },
    ]
    before = deepcopy(nodes)
    assert WorkflowGenerator._collect_unresolved_refs(nodes=nodes, mode="workflow") == []
    assert nodes == before
    assert WorkflowGenerator._aliased_output(nodes[0], "result") is None
    assert WorkflowGenerator._sole_declared_variable(nodes[0]) is None


def test_native_agent_switch_only_exists_for_enabled_valid_routes():
    node = _native_agent()
    node["data"]["agent_output_routes"] = {
        "enabled": True,
        "routes": [{"id": "pass", "name": "Approved"}, {"id": "fail", "name": "Rejected"}],
    }
    assert WorkflowGenerator._declares_variable(node, "switch")
    assert not WorkflowGenerator._declares_variable(node, "switch.id")


@pytest.mark.parametrize(
    "outputs", [[{"name": "text", "type": "string"}], [{"name": "summary", "type": "invented"}], "summary"]
)
def test_malformed_or_reserved_agent_declarations_fail_closed(outputs):
    node = _native_agent()
    node["data"]["agent_declared_outputs"] = outputs
    assert not WorkflowGenerator._declares_variable(node, "summary")
    assert not WorkflowGenerator._declares_variable(node, "text")


@pytest.mark.parametrize(
    "identity", [{}, {"version": "1"}, {"version": "2"}, {"version": "2", "agent_node_kind": "other"}]
)
def test_legacy_and_ambiguous_agents_do_not_gain_native_outputs(identity):
    node = _native_agent()
    node["data"].pop("version")
    node["data"].pop("agent_node_kind")
    node["data"].update(identity)
    assert not WorkflowGenerator._declares_variable(node, "summary")
    assert not WorkflowGenerator._declares_variable(node, "text")


def test_agent_plan_name_promises_reach_end_builder_without_becoming_runtime_authority():
    plan = [
        {"id": "node2", "node_type": "agent", "purpose": "Review the contract using the selected Agent"},
    ]
    parsed = _parse_node_outputs({"node2": ["risks", "summary"]}, plan)
    assert parsed == {"node2": ["risks", "summary"]}
    section = format_node_outputs_section(parsed, "node3", {"node2": "agent", "node3": "end"})
    assert "'risks'" in section
    assert "'summary'" in section
    assert "structured_output.summary" not in section


def test_agent_plan_to_parallel_builder_to_valid_end_graph(monkeypatch):
    configs = {
        "node1": {"type": "start", "variables": []},
        "node2": _native_agent()["data"],
        "node3": {
            "type": "end",
            "outputs": [
                {"variable": "risks", "value_selector": ["node2", "risks"]},
                {"variable": "summary", "value_selector": ["node2", "summary"]},
            ],
        },
    }
    plan = {
        "title": "Contract Reviewer",
        "description": "Review a synthetic contract",
        "nodes": [
            {"id": node_id, "node_type": config["type"], "label": node_id, "purpose": "Review contract"}
            for node_id, config in configs.items()
        ],
        "edges": [{"source": "node1", "target": "node2"}, {"source": "node2", "target": "node3"}],
        "node_outputs": {"node2": ["risks", "summary"]},
    }
    prompts = {}

    def model_boundary(**kwargs):
        stage = kwargs["stage"]
        if stage == "Planner":
            return deepcopy(plan)
        node_id = stage.removeprefix("Builder ")
        prompts[node_id] = kwargs["messages"][-1].content
        return {"config": deepcopy(configs[node_id])}

    monkeypatch.setattr(WorkflowGenerator, "_invoke_and_parse_json", staticmethod(model_boundary))
    result = WorkflowGenerator.generate_workflow_graph(
        model_instance=object(),
        model_parameters={},
        provider="fixture",
        model_name="fixture",
        model_mode="chat",
        mode="workflow",
        instruction="Use the selected native Agent and return risks and summary unchanged",
    )
    assert result["error"] == ""
    assert "node2: 'risks', 'summary'" in prompts["node3"]
    end = next(node for node in result["graph"]["nodes"] if node["data"]["type"] == "end")
    assert end["data"]["outputs"] == configs["node3"]["outputs"]


def _run_agent_model_responses(responses):
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    results = [
        SimpleNamespace(message=SimpleNamespace(get_text_content=lambda text=text: text), usage=None)
        for text in responses
    ]
    model = SimpleNamespace(invoke_llm=MagicMock(side_effect=results))
    result = WorkflowGenerator._run_node_builder(
        model_instance=model,
        model_parameters={},
        provider="fixture",
        model_name="fixture",
        model_mode="chat",
        mode_section="workflow",
        instruction="Use only the confirmed published Agent binding",
        ideal_output="",
        target_node={"id": "node2", "node_type": "agent", "label": "Reviewer", "purpose": "Review contract"},
        plan_json="{}",
        tool_catalogue_text="",
        tool_catalogue_entries=[],
        start_inputs=[],
        node_outputs={"node2": ["risks", "summary"]},
        node_types={"node2": "agent"},
        existing_node=None,
    )
    return result, model


def _observed_bad_native_config():
    # Actual pre-assembly and final-validation shape captured in
    # actual-agent-generation-shapes.json: numeric version + JSON Schema items.
    return {
        "version": 2,
        "agent_node_kind": "dify_agent",
        "agent_task": "Review synthetic contract",
        "agent_binding": {
            "binding_type": "roster_agent",
            "agent_id": "selected-agent",
            "current_snapshot_id": "selected-snapshot",
        },
        "agent_declared_outputs": [
            {"name": "risks", "type": "array", "items": {"type": "string"}},
            {"name": "summary", "type": "string"},
        ],
    }


def test_real_agent_response_parser_corrects_both_observed_schema_errors_in_one_retry():
    import json

    bad = _observed_bad_native_config()
    canonical = deepcopy(bad)
    canonical["version"] = "2"
    canonical["agent_declared_outputs"][0].pop("items")
    canonical["agent_declared_outputs"][0]["array_item"] = {"type": "string"}
    result, model = _run_agent_model_responses([json.dumps({"config": bad}), json.dumps({"config": canonical})])
    assert result == canonical
    assert model.invoke_llm.call_count == 2
    correction = json.loads(model.invoke_llm.call_args_list[1].kwargs["prompt_messages"][-1].content)
    assert correction["code"] == "INVALID_SCHEMA"
    assert "version" in correction["detail"]
    assert "string_type" in correction["detail"]
    assert "declared_outputs" in correction["detail"]
    assert "items" in correction["detail"]
    assert "extra_forbidden" in correction["detail"]
    assert "Review synthetic contract" not in correction["detail"]
    assert "selected-agent" not in correction["detail"]


@pytest.mark.parametrize("invalid_kind", ["items", "reserved"])
def test_invalid_native_declarations_exhaust_existing_two_attempt_budget_without_conversion(invalid_kind):
    import json

    from services.workflow_generation.runner import _StageSchemaError

    bad = _observed_bad_native_config()
    bad["version"] = "2"
    if invalid_kind == "reserved":
        bad["agent_declared_outputs"] = [{"name": "text", "type": "string"}]
    raw = json.dumps({"config": bad})
    with pytest.raises(_StageSchemaError):
        _run_agent_model_responses([raw, raw])


def test_legacy_agent_builder_config_does_not_enter_native_schema_correction():
    import json

    legacy = {"version": "1", "agent_strategy_name": "legacy-fixture"}
    result, model = _run_agent_model_responses([json.dumps({"config": legacy})])
    assert result == legacy
    assert model.invoke_llm.call_count == 1


def test_agent_system_schema_example_validates_with_native_owners():
    import json

    from core.workflow.generator.prompts.builder_prompts import get_node_config_snippet
    from core.workflow.generator.prompts.node_builder_prompts import get_node_builder_system_prompt
    from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData

    snippet = get_node_config_snippet("agent")
    assert snippet
    config, _ = json.JSONDecoder().raw_decode(snippet[snippet.index("{") :])
    node = DifyAgentNodeData.model_validate({"type": "agent", "title": "Fixture", **config})
    assert node.version == "2"
    job = WorkflowNodeJobConfig.model_validate(
        {"declared_outputs": config["agent_declared_outputs"], "output_routes": config["agent_output_routes"]}
    )
    assert any(output.type == "array" and output.array_item.type == "string" for output in job.declared_outputs)
    assert any(output.type == "object" and output.children for output in job.declared_outputs)
    assert snippet in get_node_builder_system_prompt("agent")
