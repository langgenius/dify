"""Isolated consumers must reference the native aggregate envelope, not rename it."""

import json
from copy import deepcopy

import pytest

from core.workflow.generator.prompts.node_builder_prompts import format_parallel_plan
from core.workflow.generator.prompts.planner_prompts import PLANNER_SYSTEM_PROMPT
from graphon.model_runtime.entities.message_entities import PromptMessage
from graphon.nodes.end.end_node import EndNode
from graphon.nodes.end.entities import EndNodeData
from graphon.nodes.variable_aggregator.entities import VariableAggregatorNodeData
from graphon.nodes.variable_aggregator.variable_aggregator_node import VariableAggregatorNode
from graphon.runtime import InitParams, RuntimeState, VariablePool
from services.workflow_generation.runner import WorkflowGenerator


def test_planner_and_shared_plan_name_native_aggregate_envelope() -> None:
    assert '["<merge-id>", "output", "<field>"]' in PLANNER_SYSTEM_PROMPT
    assert "output_type does not convert" in PLANNER_SYSTEM_PROMPT
    assert "Preserve every requested End output" in PLANNER_SYSTEM_PROMPT
    plan = json.loads(format_parallel_plan([{"id": "merge", "node_type": "variable-aggregator"}], []))
    contract = plan["native_variable_aggregator_contract"]
    assert contract["node_ids"] == ["merge"]
    assert "group_name" in contract["rules"]
    assert "does not flatten" in contract["rules"]
    assert "output_type does not convert" in contract["rules"]
    assert "every selected branch" in contract["rules"]
    assert "Preserve every requested End output" in contract["rules"]
    assert "actual native Tool file values" in contract["rules"]
    assert '["<merge-id>", "output", "<field>"]' in contract["rules"]


@pytest.mark.parametrize("branch", ["left", "right"])
def test_native_aggregate_object_reaches_end_as_nested_typed_fields(branch: str) -> None:
    pool = VariablePool()
    pool.add([branch, "bundle"], {"units": 2, "total": 350.5, "message": "ready", "attachments": []})
    runtime = RuntimeState(workflow_id="workflow", variable_pool=pool, start_at=0)
    init = InitParams(workflow_id="workflow", graph_config={}, run_context={}, call_depth=0)
    merge = VariableAggregatorNode(
        "merge",
        VariableAggregatorNodeData(
            title="Merge", output_type="object", variables=[["left", "bundle"], ["right", "bundle"]]
        ),
        init_params=init,
        runtime_state=runtime,
    )
    result = merge._run()
    assert set(result.outputs) == {"output"}
    pool.add(["merge", "output"], result.outputs["output"])
    end = EndNode(
        "end",
        EndNodeData(
            title="End",
            outputs=[
                {"variable": key, "value_selector": ["merge", "output", key]}
                for key in ("units", "total", "message", "attachments")
            ],
        ),
        init_params=init,
        runtime_state=runtime,
    )
    assert end._run().outputs == {"units": 2, "total": 350.5, "message": "ready", "attachments": []}
    assert pool.get(["merge", "units"]) is None


def test_each_parallel_builder_receives_contract_and_nested_end_selectors_survive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    variables: list[object] = []
    configs: dict[str, dict[str, object]] = {
        "start": {"variables": variables},
        "producer": {
            "code_language": "python3",
            "code": 'def main(): return {"bundle": {"units": 2}}',
            "variables": variables,
            "outputs": {"bundle": {"type": "object", "children": None}},
        },
        "merge": {"output_type": "object", "variables": [["producer", "bundle"]]},
        "end": {"outputs": [{"variable": "units", "value_selector": ["merge", "output", "units"]}]},
    }
    types = {"start": "start", "producer": "code", "merge": "variable-aggregator", "end": "end"}
    ids = list(types)
    plan: dict[str, object] = {
        "nodes": [{"id": node_id, "node_type": node_type} for node_id, node_type in types.items()],
        "edges": [{"source": source, "target": target} for source, target in zip(ids, ids[1:], strict=False)],
        "node_outputs": {"producer": ["bundle"]},
    }
    prompts: dict[str, str] = {}

    def model_boundary(*, stage: str, messages: list[PromptMessage], **_kwargs: object) -> dict[str, object]:
        if stage == "Planner":
            return deepcopy(plan)
        node_id = stage.removeprefix("Builder ")
        prompts[node_id] = messages[-1].get_text_content()
        return {"config": deepcopy(configs[node_id])}

    monkeypatch.setattr(WorkflowGenerator, "_invoke_and_parse_json", staticmethod(model_boundary))
    result = WorkflowGenerator.generate_workflow_graph(
        model_instance=object(),
        model_parameters={},
        provider="fixture",
        model_name="fixture",
        model_mode="chat",
        mode="workflow",
        instruction="Aggregate the selected branch object, then return its numeric units field.",
    )
    assert result["error"] == ""
    for content in prompts.values():
        assert "native_variable_aggregator_contract" in content
        assert "does not flatten" in content
        assert "output_type does not convert" in content
        assert "Preserve every requested End output" in content
    end = next(node for node in result["graph"]["nodes"] if node["id"] == "end")
    assert end["data"]["outputs"] == configs["end"]["outputs"]


@pytest.mark.parametrize("branch", ["left", "right"])
@pytest.mark.parametrize("declared_type", ["string", "object"])
def test_native_aggregate_does_not_turn_branch_text_into_requested_fields(branch: str, declared_type: str) -> None:
    pool = VariablePool()
    pool.add([branch, "message"], "ready")
    runtime = RuntimeState(workflow_id="workflow", variable_pool=pool, start_at=0)
    init = InitParams(workflow_id="workflow", graph_config={}, run_context={}, call_depth=0)
    merge = VariableAggregatorNode(
        "merge",
        VariableAggregatorNodeData(
            title="Merge", output_type=declared_type, variables=[["left", "message"], ["right", "message"]]
        ),
        init_params=init,
        runtime_state=runtime,
    )
    result = merge._run()
    pool.add(["merge", "output"], result.outputs["output"])
    selected = pool.get(["merge", "output"])
    assert selected is not None
    assert selected.to_object() == "ready"
    end = EndNode(
        "end",
        EndNodeData(
            title="End",
            outputs=[
                {"variable": key, "value_selector": ["merge", "output", key]}
                for key in ("units", "total", "message", "attachments")
            ],
        ),
        init_params=init,
        runtime_state=runtime,
    )
    assert end._run().outputs == {"units": None, "total": None, "message": None, "attachments": None}
