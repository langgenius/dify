"""Native Loop state is declared consistently across isolated generation calls."""

import json
from copy import deepcopy

import pytest

from core.workflow.generator.prompts.node_builder_prompts import (
    format_node_outputs_section,
    get_node_builder_system_prompt,
)
from core.workflow.generator.prompts.planner_prompts import PLANNER_SYSTEM_PROMPT
from graphon.node_events.node import StreamCompletedEvent, VariableUpdatedEvent
from graphon.nodes.loop.entities import LoopNodeData
from graphon.nodes.loop.loop_node import LoopNode
from graphon.nodes.variable_assigner.v2.entities import VariableAssignerNodeData
from graphon.nodes.variable_assigner.v2.node import VariableAssignerNode
from graphon.runtime import InitParams, RuntimeState, VariablePool
from services.workflow_generation.runner import WorkflowGenerator, _parse_node_outputs


def _prompt_loop_config() -> dict:
    prompt = get_node_builder_system_prompt("loop")
    config, _ = json.JSONDecoder().raw_decode(prompt.split("- loop:", 1)[1].lstrip())
    return config


def test_loop_prompt_declares_native_state_instead_of_just_exit_conditions():
    config = _prompt_loop_config()
    assert config["loop_variables"] == [
        {"label": "counter", "var_type": "number", "value_type": "constant", "value": 0}
    ]
    data = LoopNodeData.model_validate({"title": "Counter", "start_node_id": "loopstart", **config})
    assert data.break_conditions[0].variable_selector == ["<loop-id>", "counter"]
    assert data.break_conditions[0].comparison_operator == "≥"
    assert "loop_variables[].label" in get_node_builder_system_prompt("loop")


def test_loop_plan_names_reach_producer_and_consumers_without_granting_output_authority():
    nodes = [{"id": "loop", "node_type": "loop"}, {"id": "end", "node_type": "end"}]
    parsed = _parse_node_outputs({"loop": ["counter"]}, nodes)
    assert parsed == {"loop": ["counter"]}
    assert '"loop" (``loop_variables[].label``)' in PLANNER_SYSTEM_PROMPT
    own = format_node_outputs_section(parsed, "loop", {"loop": "loop"})
    assert "loop_variables[].label" in own
    assert "loop: 'counter'" in format_node_outputs_section(parsed, "end", {"loop": "loop"})
    actual = {"id": "loop", "data": {"type": "loop", **_prompt_loop_config()}}
    assert WorkflowGenerator._declares_variable(actual, "counter")
    actual["data"]["loop_variables"] = []
    assert not WorkflowGenerator._declares_variable(actual, "counter")


@pytest.mark.parametrize("initialization", ["constant", "variable"])
def test_prompt_state_initializes_native_pool_and_assigner_increments_same_selector(initialization):
    config = _prompt_loop_config()
    variable = config["loop_variables"][0]
    variable["value_type"] = initialization
    variable["value"] = 0 if initialization == "constant" else ["start", "initial_counter"]
    pool = VariablePool()
    pool.add(["start", "initial_counter"], 0)
    runtime = RuntimeState(workflow_id="workflow", variable_pool=pool, start_at=0)
    init = InitParams(workflow_id="workflow", graph_config={}, run_context={}, call_depth=0)
    loop = LoopNode(
        "loop",
        LoopNodeData.model_validate({"title": "Loop", "start_node_id": "loopstart", **config}),
        init_params=init,
        runtime_state=runtime,
    )
    inputs = {}
    assert loop._initialize_loop_variables(inputs=inputs) == {"counter": ("loop", "counter")}
    assert inputs == {"counter": 0}
    assigner = VariableAssignerNode(
        "increment",
        VariableAssignerNodeData.model_validate(
            {
                "title": "Increment",
                "items": [
                    {
                        "variable_selector": ["loop", "counter"],
                        "input_type": "constant",
                        "operation": "+=",
                        "value": 1,
                    }
                ],
            }
        ),
        init_params=init,
        runtime_state=runtime,
    )
    events = list(assigner._run())
    updates = [event for event in events if isinstance(event, VariableUpdatedEvent)]
    assert len(updates) == 1
    assert list(updates[0].variable.selector) == ["loop", "counter"]
    assert updates[0].variable.value == 1
    assert isinstance(events[-1], StreamCompletedEvent)
    assert events[-1].node_run_result.status == "succeeded"


def test_loop_declarations_survive_real_planner_and_parallel_builder_boundaries(monkeypatch):
    configs = {
        "start": {"variables": [{"variable": "limit", "label": "limit", "type": "number", "required": True}]},
        "loop": _prompt_loop_config(),
        "increment": {
            "version": "2",
            "items": [
                {
                    "variable_selector": ["loop", "counter"],
                    "input_type": "constant",
                    "operation": "+=",
                    "value": 1,
                }
            ],
        },
        "end": {"outputs": [{"variable": "final_counter", "value_selector": ["loop", "counter"]}]},
    }
    configs["loop"]["break_conditions"][0].update(
        variable_selector=["loop", "counter"],
        value="{{#start.limit#}}",
    )
    plan = {
        "nodes": [
            {"id": "start", "node_type": "start"},
            {"id": "loop", "node_type": "loop"},
            {"id": "increment", "node_type": "assigner", "parent": "loop"},
            {"id": "end", "node_type": "end"},
        ],
        "edges": [{"source": "start", "target": "loop"}, {"source": "loop", "target": "end"}],
        "start_inputs": configs["start"]["variables"],
        "node_outputs": {"loop": ["counter"]},
    }
    prompts = {}

    def model_boundary(*, stage, messages, **_kwargs):
        if stage == "Planner":
            return deepcopy(plan)
        node_id = stage.removeprefix("Builder ")
        prompts[node_id] = messages[-1].content
        return {"config": deepcopy(configs[node_id])}

    monkeypatch.setattr(WorkflowGenerator, "_invoke_and_parse_json", staticmethod(model_boundary))
    result = WorkflowGenerator.generate_workflow_graph(
        model_instance=object(),
        model_parameters={},
        provider="fixture",
        model_name="fixture",
        model_mode="chat",
        mode="workflow",
        instruction="Native Loop counter=0; assigner counter += 1; exit counter ≥ limit; max 10; End counter",
    )
    assert result["error"] == ""
    assert "loop_variables[].label" in prompts["loop"]
    assert "loop: 'counter'" in prompts["increment"]
    assert "loop: 'counter'" in prompts["end"]
    loop = next(node for node in result["graph"]["nodes"] if node["id"] == "loop")
    LoopNodeData.model_validate(loop["data"])
    assert WorkflowGenerator._declares_variable(loop, "counter")
