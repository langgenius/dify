"""Native Agent v2 caller outputs survive shared generator validation."""

from copy import deepcopy

import pytest

from core.workflow.generator.prompts.node_builder_prompts import format_node_outputs_section
from core.workflow.generator.runner import WorkflowGenerator, _parse_node_outputs
from models.agent_config_entities import WorkflowNodeJobConfig


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
