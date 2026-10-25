"""Generated Template syntax uses native Jinja before a graph can be returned."""

import json
import time
from copy import deepcopy
from typing import Literal

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.workflow.generator.types import GraphDict, PlannerResultDict, WorkflowGenerateResultDict
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.node_events.base import NodeRunResult
from graphon.nodes.template_transform.entities import TemplateTransformNodeData
from graphon.nodes.template_transform.template_transform_node import TemplateTransformNode
from graphon.runtime import RuntimeState, VariablePool
from services.dify_builder.template_execution import BoundedJinja2TemplateRenderer
from services.workflow_generation.runner import WorkflowGenerator
from tests.unit_tests.services.workflow_generation.test_runner import _ParallelBuilderModel
from tests.workflow_test_utils import build_test_graph_init_params

# Exact template and bindings from Dev run 51e13ecc-ad86-4c44-8b89-53687981475b.
_REJECTED: dict[str, object] = {
    "variables": [
        {"variable": "paid_order_count", "value_selector": ["node2", "paid_order_count"]},
        {"variable": "cancelled_order_count", "value_selector": ["node2", "cancelled_order_count"]},
        {"variable": "actual_received_amount", "value_selector": ["node2", "actual_received_amount"]},
    ],
    "template": (
        "今日订单日报：已支付 {{#node2.paid_order_count#}} 单，取消 "
        "{{#node2.cancelled_order_count#}} 单，实收金额 {{#node2.actual_received_amount#}} 元。"
    ),
}
_CORRECTED: dict[str, object] = {
    **_REJECTED,
    "template": (
        "今日订单日报：已支付 {{ paid_order_count }} 单，取消 "
        "{{ cancelled_order_count }} 单，实收金额 {{ actual_received_amount }} 元。"
    ),
}
_PLAN: PlannerResultDict = {
    "title": "订单日报",
    "description": "使用精确统计生成报告。",
    "nodes": [
        {"id": "node1", "label": "Start", "node_type": "start", "purpose": "Start."},
        {"id": "node2", "label": "Counts", "node_type": "code", "purpose": "Calculate counts."},
        {"id": "node4", "label": "Report", "node_type": "template-transform", "purpose": "Format report."},
        {"id": "node7", "label": "End", "node_type": "end", "purpose": "Return report."},
    ],
    "edges": [
        {"source": "node1", "target": "node2"},
        {"source": "node2", "target": "node4"},
        {"source": "node4", "target": "node7"},
    ],
}
_CONFIGS: dict[str, dict[str, object]] = {
    "node1": {"variables": []},
    "node2": {
        "code_language": "python3",
        "code": (
            'def main():\n    return {"paid_order_count": 2, "cancelled_order_count": 1, '
            '"actual_received_amount": "350.00"}'
        ),
        "variables": [],
        "outputs": {
            "paid_order_count": {"type": "number", "children": None},
            "cancelled_order_count": {"type": "number", "children": None},
            "actual_received_amount": {"type": "string", "children": None},
        },
    },
    "node4": _CORRECTED,
    "node7": {"outputs": [{"variable": "report", "value_selector": ["node4", "output"]}]},
}


def _generate(model: _ParallelBuilderModel, current_graph: GraphDict | None = None) -> WorkflowGenerateResultDict:
    return WorkflowGenerator.generate_workflow_graph(
        model_instance=model,
        model_parameters={},
        provider="deepseek",
        model_name="deepseek-v4-pro",
        model_mode="chat",
        mode="workflow",
        instruction="生成订单日报",
        current_graph=dict(current_graph) if current_graph is not None else None,
    )


def _existing_graph() -> GraphDict:
    return {
        "nodes": [
            {
                "id": n.get("id", ""),
                "type": "custom",
                "position": {"x": 0, "y": 0},
                "data": {"type": n["node_type"], "title": n["label"], **deepcopy(_CONFIGS[n.get("id", "")])},
            }
            for n in _PLAN["nodes"]
        ],
        "edges": [
            {"id": str(i), "type": "custom", "source": e["source"], "target": e["target"]}
            for i, e in enumerate(_PLAN.get("edges", []))
        ],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }


def _native_template(config: dict[str, object]) -> NodeRunResult:
    graph = _existing_graph()
    data = {"type": "template-transform", "title": "Report", **config}
    pool = VariablePool()
    pool.add(["node2", "paid_order_count"], 2)
    pool.add(["node2", "cancelled_order_count"], 1)
    pool.add(["node2", "actual_received_amount"], "350.00")
    params = build_test_graph_init_params(
        workflow_id="orders",
        graph_config=graph,
        tenant_id="tenant",
        app_id="app",
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )
    node = TemplateTransformNode(
        node_id="node4",
        data=TemplateTransformNodeData.model_validate(data),
        init_params=params,
        runtime_state=RuntimeState(workflow_id="orders", variable_pool=pool, start_at=time.perf_counter()),
        jinja2_template_renderer=BoundedJinja2TemplateRenderer(),
    )
    return node._run()


@pytest.mark.parametrize("action", ["add", "update"])
def test_generated_template_correction_reaches_native_aliases(action: Literal["add", "update"]) -> None:
    assert _native_template(_REJECTED).status == WorkflowNodeExecutionStatus.FAILED
    plan = deepcopy(_PLAN)
    plan["nodes"][2]["action"] = action
    current = _existing_graph() if action == "update" else None
    before = deepcopy(current)
    model = _ParallelBuilderModel(
        dict(plan),
        deepcopy(_CONFIGS),
        barrier_parties=0,
        responses_by_node={"node4": [json.dumps({"config": _REJECTED}), json.dumps({"config": _CORRECTED})]},
    )

    result = _generate(model, current)

    assert result["errors"] == []
    assert model.calls_for("node4") == 2
    generated = next(n["data"] for n in result["graph"]["nodes"] if n["id"] == "node4")
    assert generated["template"] == _CORRECTED["template"]
    assert generated["variables"] == _REJECTED["variables"]
    native = _native_template(generated)
    assert native.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert native.inputs == {"paid_order_count": 2, "cancelled_order_count": 1, "actual_received_amount": "350.00"}
    assert native.outputs == {"output": "今日订单日报：已支付 2 单，取消 1 单，实收金额 350.00 元。"}
    assert current == before
    assert str(_REJECTED["template"]).startswith("今日订单日报：已支付 {{#node2.")
    correction = json.loads(str(model.messages_by_node["node4"][1][-1].content))
    assert correction["code"] == "INVALID_SCHEMA"
    assert "Jinja" in correction["detail"]
    assert "{{ alias }}" in correction["detail"]


@pytest.mark.parametrize("first", ["invalid-syntax", "invalid-json", "missing-template", "non-string"])
def test_invalid_template_exhausts_shared_correction_budget_without_graph(
    first: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level("INFO", logger="services.workflow_generation.runner")
    bad = {**_REJECTED, "template": str(_REJECTED["template"]) + " private-template-value"}
    rejected = {
        "invalid-syntax": json.dumps({"config": bad}),
        "invalid-json": "[]",
        "missing-template": json.dumps({"config": {"variables": []}}),
        "non-string": json.dumps({"config": {"template": ["private-template-value"]}}),
    }[first]
    model = _ParallelBuilderModel(
        dict(deepcopy(_PLAN)),
        deepcopy(_CONFIGS),
        barrier_parties=0,
        responses_by_node={"node4": [rejected, json.dumps({"config": bad}), json.dumps({"config": _CORRECTED})]},
    )

    result = _generate(model)

    assert result["graph"]["nodes"] == result["graph"]["edges"] == []
    assert [e["code"] for e in result["errors"]] == ["INVALID_SCHEMA"]
    assert "Builder node4" in result["error"]
    assert model.calls_for("node4") == 2
    feedback = str(model.messages_by_node["node4"][1][-1].content)
    assert "private-template-value" not in feedback + result["error"] + caplog.text


@pytest.mark.parametrize(
    "template",
    [
        "固定中文日报",
        "{{ actual_received_amount }}",
        "{% raw %}{{#node2.paid_order_count#}}{% endraw %}",
        '{{ "{{#node2.paid_order_count#}}" }}',
        "{# {{#not-a-valid-expression #}",
        "{% set amount = actual_received_amount %}{{ amount | upper }}",
        "{% for item in [1, 2] %}{{ loop.index }}:{{ item }}{% endfor %}",
        "{% macro report(x) %}{{ x }}{% endmacro %}{{ report(actual_received_amount) }}",
        "{{ unknown_function(unknown_variable) }}",
    ],
)
def test_valid_native_jinja_is_preserved_without_rendering_or_alias_guessing(template: str) -> None:
    configs = deepcopy(_CONFIGS)
    configs["node4"]["template"] = template
    model = _ParallelBuilderModel(dict(deepcopy(_PLAN)), configs, barrier_parties=0)

    result = _generate(model)

    assert result["errors"] == []
    assert model.calls_for("node4") == 1
    generated = next(n["data"] for n in result["graph"]["nodes"] if n["id"] == "node4")
    assert generated["template"] == template
    assert generated["variables"] == _REJECTED["variables"]


def test_kept_historical_template_bypasses_generated_syntax_validation() -> None:
    current = _existing_graph()
    current["nodes"][2]["data"].update(deepcopy(_REJECTED))
    before = deepcopy(current)
    plan = deepcopy(_PLAN)
    plan["nodes"][2]["action"] = "keep"
    model = _ParallelBuilderModel(dict(plan), deepcopy(_CONFIGS), barrier_parties=0)

    result = _generate(model, current)

    assert result["errors"] == []
    assert model.calls_for("node4") == 0
    generated = next(n["data"] for n in result["graph"]["nodes"] if n["id"] == "node4")
    assert generated["template"] == _REJECTED["template"]
    assert generated["variables"] == _REJECTED["variables"]
    assert current == before
