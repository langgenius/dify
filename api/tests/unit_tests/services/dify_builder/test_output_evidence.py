from types import SimpleNamespace

import pytest

from core.dify_builder.models import NodeOutput
from services.dify_builder import run_mapping


def graph(selector=None):
    return {
        "nodes": [
            {"id": "tool", "data": {"type": "tool"}},
            {
                "id": "end",
                "data": {
                    "type": "end",
                    "outputs": [{"variable": "result", "value_selector": selector or ["tool", "text"]}],
                },
            },
        ],
        "edges": [],
    }


@pytest.mark.parametrize("outputs", [{"result": None}, {}, {"zero": 0, "false": False, "empty": []}, None])
def test_verification_terminal_outputs(outputs):
    run = run_mapping.map_run_result({"id": "native", "status": "succeeded", "outputs": outputs}, [])
    assert run.verification.terminal_outputs == outputs


def test_verification_node_availability_and_inputs():
    rows = [
        SimpleNamespace(
            node_id="tool", title="", status="succeeded", error=None, inputs_dict={"x": 0}, outputs_dict=outputs
        )
        for outputs in [{}, None, {"text": None}]
    ]
    run = run_mapping.map_run_result({"id": "native", "status": "succeeded"}, rows)
    assert [n.outputs_available for n in run.per_node] == [True, False, True]
    assert run.per_node[0].inputs == {"x": 0}


@pytest.mark.parametrize(
    ("outputs", "available", "selector", "count", "expected"),
    [
        ({}, True, ["tool", "text"], 1, "unresolved"),
        ({"text": None}, True, ["tool", "text"], 1, "present"),
        ({}, False, ["tool", "text"], 1, "unknown"),
        ({}, True, ["tool", "text"], 0, "unknown"),
        ({}, True, ["tool", "text"], 2, "unknown"),
        ({}, True, ["tool", "text", "child"], 1, "unknown"),
        ({}, True, ["absent", "text"], 1, "unresolved"),
        ({}, True, ["sys", "query"], 1, "unknown"),
        ({}, True, ["tool"], 1, "unresolved"),
    ],
)
def test_output_evidence(outputs, available, selector, count, expected):
    from services.dify_builder.output_evidence import collect_output_findings

    rows = [
        NodeOutput(node_id="tool", status="succeeded", outputs=outputs, outputs_available=available)
        for _ in range(count)
    ]
    rows.append(NodeOutput(node_id="end", status="succeeded"))
    assert collect_output_findings(graph(selector), rows)[0].state == expected


def test_output_evidence_container_and_retry_unknown():
    from services.dify_builder.output_evidence import collect_output_findings

    rows = [
        NodeOutput(node_id="tool", status="succeeded", outputs_available=True),
        NodeOutput(node_id="end", status="succeeded"),
    ]
    for extra in [
        {"parentId": "iteration"},
        {"data": {"type": "tool", "isInIteration": True}},
        {"data": {"type": "tool", "retry_config": {"retry_enabled": True}}},
    ]:
        g = graph()
        g["nodes"][0].update(extra)
        assert collect_output_findings(g, rows)[0].state == "unknown"


def test_verification_offloaded_outputs_are_not_complete():
    row = SimpleNamespace(
        node_id="tool",
        title="",
        status="succeeded",
        error=None,
        inputs_dict={},
        outputs_dict={},
        outputs_truncated=True,
    )
    run = run_mapping.map_run_result({"id": "native", "status": "succeeded"}, [row])
    assert run.per_node[0].outputs_available is False


def test_verification_native_missing_outputs_stays_unavailable():
    row = SimpleNamespace(id="native", status="succeeded", outputs=None, outputs_dict={})
    assert run_mapping.run_result_data_from_run_row(row)["outputs"] is None


def test_output_evidence_wfs_reported_tool_reference():
    # ENG-1128 authoritative WFS stored rows: tool exports text/files/json,
    # while the executed End selects node2.result. Values here are synthetic.
    from services.dify_builder.output_evidence import collect_output_findings

    g = {
        "nodes": [
            {"id": "node1", "data": {"type": "start"}},
            {"id": "node2", "data": {"type": "tool"}},
            {
                "id": "node3",
                "data": {"type": "end", "outputs": [{"variable": "result", "value_selector": ["node2", "result"]}]},
            },
        ],
        "edges": [],
    }
    rows = [
        NodeOutput(node_id="node1", status="succeeded"),
        NodeOutput(
            node_id="node2",
            status="succeeded",
            outputs={"text": "synthetic", "files": [], "json": []},
            outputs_available=True,
        ),
        NodeOutput(node_id="node3", status="succeeded", outputs={"result": None}, outputs_available=True),
    ]
    assert collect_output_findings(g, rows)[0].state == "unresolved"
