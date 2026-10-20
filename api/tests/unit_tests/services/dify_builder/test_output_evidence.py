from types import SimpleNamespace

import pytest

from core.dify_builder.models import Graph, NodeOutput
from services.dify_builder import run_mapping


def graph(selector: list[str] | None = None) -> Graph:
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
def test_verification_terminal_outputs(outputs: dict[str, object] | None) -> None:
    run = run_mapping.map_run_result({"id": "native", "status": "succeeded", "outputs": outputs}, [])
    assert run.verification is not None
    assert run.verification.terminal_outputs == outputs


def test_verification_node_availability_and_inputs() -> None:
    output_values: list[dict[str, object] | None] = [{}, None, {"text": None}]
    rows = [
        SimpleNamespace(
            node_id="tool", title="", status="succeeded", error=None, inputs_dict={"x": 0}, outputs_dict=outputs
        )
        for outputs in output_values
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
def test_output_evidence(
    outputs: dict[str, object], available: bool, selector: list[str] | None, count: int, expected: str
) -> None:
    from services.dify_builder.output_evidence import collect_output_findings

    rows = [
        NodeOutput(node_id="tool", status="succeeded", outputs=outputs, outputs_available=available)
        for _ in range(count)
    ]
    rows.append(NodeOutput(node_id="end", status="succeeded"))
    assert collect_output_findings(graph(selector), rows)[0].state == expected


def test_output_evidence_container_and_retry_unknown() -> None:
    from services.dify_builder.output_evidence import collect_output_findings

    rows = [
        NodeOutput(node_id="tool", status="succeeded", outputs_available=True),
        NodeOutput(node_id="end", status="succeeded"),
    ]
    extras: list[Graph] = [
        {"parentId": "iteration"},
        {"data": {"type": "tool", "isInIteration": True}},
        {"data": {"type": "tool", "retry_config": {"retry_enabled": True}}},
    ]
    for extra in extras:
        g = graph()
        g["nodes"][0].update(extra)
        assert collect_output_findings(g, rows)[0].state == "unknown"


def test_verification_offloaded_outputs_are_not_complete() -> None:
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


def test_verification_native_missing_outputs_stays_unavailable() -> None:
    row = SimpleNamespace(id="native", status="succeeded", outputs=None, outputs_dict={})
    assert run_mapping.run_result_data_from_run_row(row)["outputs"] is None


def test_output_evidence_wfs_reported_tool_reference() -> None:
    # ENG-1128 authoritative WFS stored rows: tool exports text/files/json,
    # while the executed End selects node2.result. Values here are synthetic.
    from services.dify_builder.output_evidence import collect_output_findings

    g: Graph = {
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


def native_agent_graph(selector: list[str] | None = None) -> Graph:
    g: Graph = graph(selector or ["tool", "summary"])
    g["nodes"][0]["data"] = {
        "type": "agent",
        "version": "2",
        "agent_node_kind": "dify_agent",
        "agent_declared_outputs": [
            {"name": "risks", "type": "array", "array_item": {"type": "string"}},
            {"name": "summary", "type": "string"},
            {"name": "review", "type": "object", "children": [{"name": "approved", "type": "boolean"}]},
        ],
    }
    return g


@pytest.mark.parametrize(
    ("variable", "outputs", "state", "reason"),
    [
        ("risks", {"risks": ["synthetic risk"]}, "present", "key_present"),
        ("summary", {"summary": "synthetic summary"}, "present", "key_present"),
        ("summary", {"summary": None}, "present", "key_present"),
        ("summary", {}, "unresolved", "key_absent"),
    ],
)
def test_native_agent_direct_declared_output_evidence(
    variable: str, outputs: dict[str, object], state: str, reason: str
) -> None:
    from services.dify_builder.output_evidence import collect_output_findings

    rows = [
        NodeOutput(node_id="tool", status="succeeded", outputs=outputs, outputs_available=True),
        NodeOutput(node_id="end", status="succeeded"),
    ]
    finding = collect_output_findings(native_agent_graph(["tool", variable]), rows)[0]
    assert (finding.state, finding.reason) == (state, reason)


@pytest.mark.parametrize(
    "config",
    [
        {"type": "agent"},
        {"type": "agent", "version": "1", "agent_node_kind": "dify_agent"},
        {"type": "agent", "version": "2"},
        {"type": "agent", "version": "2", "agent_node_kind": "other"},
        {"type": "custom", "version": "2", "agent_node_kind": "dify_agent"},
    ],
)
def test_native_agent_evidence_requires_native_identity(config: dict[str, object]) -> None:
    from services.dify_builder.output_evidence import collect_output_findings

    g = native_agent_graph()
    g["nodes"][0]["data"] = {**config, "agent_declared_outputs": g["nodes"][0]["data"]["agent_declared_outputs"]}
    rows = [
        NodeOutput(node_id="tool", status="succeeded", outputs={"summary": "fixture"}, outputs_available=True),
        NodeOutput(node_id="end", status="succeeded"),
    ]
    finding = collect_output_findings(g, rows)[0]
    assert (finding.state, finding.reason) == ("unknown", "insufficient_provenance")


@pytest.mark.parametrize(
    "declarations",
    [
        [],
        "summary",
        [{"name": "summary", "type": "invented"}],
        [{"name": "summary", "type": "string"}, {"name": "text", "type": "string"}],
        [{"name": "summary", "type": "string"}, {"name": "risks", "type": "array", "items": {"type": "string"}}],
    ],
)
def test_native_agent_evidence_requires_valid_declaration(declarations: object) -> None:
    from services.dify_builder.output_evidence import collect_output_findings

    g = native_agent_graph()
    g["nodes"][0]["data"]["agent_declared_outputs"] = declarations
    rows = [
        NodeOutput(node_id="tool", status="succeeded", outputs={"summary": "fixture"}, outputs_available=True),
        NodeOutput(node_id="end", status="succeeded"),
    ]
    finding = collect_output_findings(g, rows)[0]
    assert (finding.state, finding.reason) == ("unknown", "insufficient_provenance")


@pytest.mark.parametrize(
    "selector",
    [["tool", "missing"], ["tool", "review", "approved"], ["tool", "review.approved"]],
)
def test_native_agent_evidence_does_not_infer_undeclared_or_nested_outputs(selector: list[str]) -> None:
    from services.dify_builder.output_evidence import collect_output_findings

    rows = [
        NodeOutput(
            node_id="tool",
            status="succeeded",
            outputs={"missing": "fixture", "review": {"approved": True}, "review.approved": True},
            outputs_available=True,
        ),
        NodeOutput(node_id="end", status="succeeded"),
    ]
    finding = collect_output_findings(native_agent_graph(selector), rows)[0]
    assert (finding.state, finding.reason) == ("unknown", "insufficient_provenance")


@pytest.mark.parametrize(
    "extra",
    [
        {"parentId": "iteration"},
        {"parent_id": "loop"},
        {"data": {"isInIteration": True}},
        {"data": {"isInLoop": True}},
        {"data": {"iteration_id": "iteration"}},
        {"data": {"loop_id": "loop"}},
        {"data": {"retry_config": {"retry_enabled": True}}},
        {"data": {"error_strategy": "default-value"}},
    ],
)
def test_native_agent_evidence_keeps_ambiguous_provenance_unknown(extra: dict[str, object]) -> None:
    from services.dify_builder.output_evidence import collect_output_findings

    g = native_agent_graph()
    g["nodes"][0]["data"].update(extra.get("data", {}))
    g["nodes"][0].update({key: value for key, value in extra.items() if key != "data"})
    rows = [
        NodeOutput(node_id="tool", status="succeeded", outputs={"summary": "fixture"}, outputs_available=True),
        NodeOutput(node_id="end", status="succeeded"),
    ]
    finding = collect_output_findings(g, rows)[0]
    assert (finding.state, finding.reason) == ("unknown", "insufficient_provenance")


@pytest.mark.parametrize(
    ("status", "available", "count"),
    [
        ("succeeded", True, 0),
        ("succeeded", True, 2),
        ("failed", True, 1),
        ("running", True, 1),
        ("succeeded", False, 1),
    ],
)
def test_native_agent_evidence_requires_single_succeeded_complete_row(status: str, available: bool, count: int) -> None:
    from services.dify_builder.output_evidence import collect_output_findings

    rows = [
        NodeOutput(node_id="tool", status=status, outputs={"summary": "fixture"}, outputs_available=available)
        for _ in range(count)
    ]
    rows.append(NodeOutput(node_id="end", status="succeeded"))
    finding = collect_output_findings(native_agent_graph(), rows)[0]
    assert (finding.state, finding.reason) == ("unknown", "insufficient_provenance")


def test_native_agent_offloaded_outputs_do_not_prove_key_absence() -> None:
    from services.dify_builder.output_evidence import collect_output_findings

    native_rows = [
        SimpleNamespace(
            node_id="tool",
            title="",
            status="succeeded",
            error=None,
            inputs_dict={},
            outputs_dict={},
            outputs_truncated=True,
        ),
        SimpleNamespace(node_id="end", title="", status="succeeded", error=None, inputs_dict={}, outputs_dict={}),
    ]
    run = run_mapping.map_run_result({"id": "native", "status": "succeeded"}, native_rows)
    finding = collect_output_findings(native_agent_graph(), run.per_node)[0]
    assert (finding.state, finding.reason) == ("unknown", "insufficient_provenance")
