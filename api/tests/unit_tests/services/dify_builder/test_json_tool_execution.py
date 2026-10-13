"""Pure admission for the single qualified native JSON Parse graph."""

import json
from copy import deepcopy
from pathlib import Path

import pytest
from pydantic import ValidationError

from core.dify_builder.execution_policy import BuilderExecutionPolicyError, RestrictedAdmissionSnapshot
from services.dify_builder.json_tool_execution import (
    QualifiedJsonToolBinding,
    admit_json_workflow,
    resolve_json_parameters,
    validate_json_parameters,
)

_GRAPH = Path(__file__).resolve().parents[3] / "fixtures/workflow/builder_restricted/json_parse_owned_graph.json"


@pytest.fixture
def json_graph():
    return json.loads(_GRAPH.read_text())


def snapshot_for(graph):
    return RestrictedAdmissionSnapshot(
        app_mode="workflow",
        workflow_kind="standard",
        graph=graph,
        input_schema={"variables": deepcopy(graph["nodes"][0]["data"]["variables"])},
        features={},
        has_environment_variables=False,
        has_conversation_variables=False,
        has_external_tracing=False,
    )


def _inputs():
    return {"payload": '{"customer":{"name":"Ada"}}', "json_path": "$.customer.name"}


def _tool(graph):
    return graph["nodes"][1]["data"]


def test_reviewed_pure_mixed_graph_admits_exact_native_chain(json_graph):
    admitted = admit_json_workflow(snapshot_for(json_graph))
    assert (admitted.start_node_id, admitted.tool_node_id, admitted.end_node_id) == ("node1", "node2", "node3")
    assert [node.node_id for node in admitted.nodes] == ["node1", "node2", "node3"]
    assert resolve_json_parameters(snapshot_for(json_graph), _inputs()) == {
        "content": _inputs()["payload"],
        "json_filter": _inputs()["json_path"],
        "ensure_ascii": True,
    }


@pytest.mark.parametrize("source_kind", ["constant", "variable", "mixed"])
@pytest.mark.parametrize("parameter", ["content", "json_filter"])
def test_string_source_variants(json_graph, source_kind, parameter):
    expected = _inputs()["payload" if parameter == "content" else "json_path"]
    name = "payload" if parameter == "content" else "json_path"
    if source_kind == "constant":
        if parameter == "content":
            expected = '{"x":1}'
        _tool(json_graph)["tool_parameters"][parameter] = {"type": "constant", "value": expected}
    elif source_kind == "variable":
        _tool(json_graph)["tool_parameters"][parameter] = {"type": "variable", "value": ["node1", name]}
    assert resolve_json_parameters(snapshot_for(json_graph), _inputs())[parameter] == expected


def test_constant_json_parameters_need_no_start_declarations_or_inputs(json_graph):
    json_graph["nodes"][0]["data"]["variables"] = []
    _tool(json_graph)["tool_parameters"] = {
        "content": {"type": "constant", "value": '{"x":1}'},
        "json_filter": {"type": "constant", "value": "$.x"},
    }
    assert resolve_json_parameters(snapshot_for(json_graph), {}) == {
        "content": '{"x":1}',
        "json_filter": "$.x",
        "ensure_ascii": True,
    }


def test_empty_start_declarations_still_refuse_variable_selector(json_graph):
    json_graph["nodes"][0]["data"]["variables"] = []
    _tool(json_graph)["tool_parameters"]["content"] = {"type": "variable", "value": ["node1", "payload"]}
    with pytest.raises(BuilderExecutionPolicyError):
        admit_json_workflow(snapshot_for(json_graph))


@pytest.mark.parametrize("ascii_value", [True, False], ids=["true", "false"])
@pytest.mark.parametrize("wrapped", [True, False], ids=["wrapped", "raw"])
def test_final_parameters_keep_native_boolean(json_graph, ascii_value, wrapped):
    _tool(json_graph)["tool_configurations"]["ensure_ascii"] = (
        {"type": "constant", "value": ascii_value} if wrapped else ascii_value
    )
    actual = resolve_json_parameters(snapshot_for(json_graph), _inputs())
    assert actual == {"content": _inputs()["payload"], "json_filter": "$.customer.name", "ensure_ascii": ascii_value}
    assert type(actual["ensure_ascii"]) is bool


@pytest.mark.parametrize(
    "invalid",
    [
        0,
        1,
        "true",
        "false",
        None,
        {},
        {"type": "variable", "value": ["node1", "flag"]},
        {"type": "mixed", "value": "true"},
        {"type": "constant", "value": 1},
        {"type": "constant", "value": False, "extra": 1},
    ],
)
def test_non_boolean_ensure_ascii_refuses_before_coercion(json_graph, invalid):
    _tool(json_graph)["tool_configurations"]["ensure_ascii"] = invalid
    with pytest.raises(BuilderExecutionPolicyError):
        admit_json_workflow(snapshot_for(json_graph))


@pytest.mark.parametrize(
    "mutation",
    [
        "provider",
        "provider_type",
        "action",
        "identifier",
        "version",
        "tool_version",
        "tool_extra",
        "config_extra",
        "config_missing",
        "parameter_extra",
        "parameter_missing",
        "credential",
        "dynamic_schema",
        "secret_schema",
        "file_schema",
        "graph_store",
        "node_extra",
        "edge_extra",
        "retry",
        "recovery",
        "second_tool",
        "extra_edge",
        "wrong_end_selector",
        "undeclared_source",
        "nested_selector",
        "environment_source",
        "number_source",
        "duplicate_start_name",
        "dollar_node",
    ],
)
def test_exact_graph_and_static_tool_shape_refuse_mutations(json_graph, mutation):
    graph = json_graph
    tool = _tool(graph)
    if mutation == "provider":
        tool["provider_id"] = "other/provider"
    elif mutation == "provider_type":
        tool["provider_type"] = "api"
    elif mutation == "action":
        tool["tool_name"] = "serialize"
    elif mutation == "identifier":
        tool["plugin_unique_identifier"] = "changed"
    elif mutation == "version":
        tool["version"] = "latest"
    elif mutation == "tool_version":
        tool["tool_node_version"] = "1"
    elif mutation == "tool_extra":
        tool["unreviewed_config"] = True
    elif mutation == "config_extra":
        tool["tool_configurations"]["other"] = True
    elif mutation == "config_missing":
        del tool["tool_configurations"]["ensure_ascii"]
    elif mutation == "parameter_extra":
        tool["tool_parameters"]["ensure_ascii"] = {"type": "constant", "value": True}
    elif mutation == "parameter_missing":
        del tool["tool_parameters"]["content"]
    elif mutation == "credential":
        tool["credential_id"] = "selected"
    elif mutation == "dynamic_schema":
        tool["paramSchemas"][0]["auto_generate"] = True
    elif mutation == "secret_schema":
        tool["paramSchemas"][0]["type"] = "secret-input"
    elif mutation == "file_schema":
        tool["paramSchemas"][0]["type"] = "file"
    elif mutation == "graph_store":
        graph["environment_variables"] = {"secret": "private"}
    elif mutation == "node_extra":
        graph["nodes"][1]["runtime"] = {"unreviewed": True}
    elif mutation == "edge_extra":
        graph["edges"][0]["condition"] = "unreviewed"
    elif mutation == "retry":
        tool["retry_config"] = {"max_retries": 1}
    elif mutation == "recovery":
        tool["default_value"] = [{"value": "fallback"}]
    elif mutation == "second_tool":
        graph["nodes"].append(deepcopy(graph["nodes"][1]))
    elif mutation == "extra_edge":
        graph["edges"].append({"source": "node1", "target": "node3"})
    elif mutation == "wrong_end_selector":
        graph["nodes"][2]["data"]["outputs"][0]["value_selector"] = ["node2", "json"]
    elif mutation == "undeclared_source":
        tool["tool_parameters"]["content"] = {"type": "variable", "value": ["node1", "unknown"]}
    elif mutation == "nested_selector":
        tool["tool_parameters"]["content"] = {"type": "variable", "value": ["node1", "payload", "x"]}
    elif mutation == "environment_source":
        tool["tool_parameters"]["content"] = {"type": "variable", "value": ["env", "secret"]}
    elif mutation == "number_source":
        graph["nodes"][0]["data"]["variables"][0]["type"] = "number"
    elif mutation == "duplicate_start_name":
        graph["nodes"][0]["data"]["variables"][1]["variable"] = "payload"
    elif mutation == "dollar_node":
        graph["nodes"][0]["id"] = "$"
    with pytest.raises(BuilderExecutionPolicyError):
        admit_json_workflow(snapshot_for(graph))


def test_wrong_resolved_tool_class_refuses_before_class_validation(json_graph, monkeypatch):
    from core.workflow import node_factory

    original = node_factory.resolve_workflow_node_class

    class Unreviewed:
        @staticmethod
        def validate_node_data(_data):
            pytest.fail("unreviewed Tool class validated")

    def swapped(*, node_type, node_version, node_data):
        if node_type == "tool":
            return Unreviewed
        return original(node_type=node_type, node_version=node_version, node_data=node_data)

    monkeypatch.setattr(node_factory, "resolve_workflow_node_class", swapped)
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_node_implementation"):
        admit_json_workflow(snapshot_for(json_graph))


@pytest.mark.parametrize(
    ("start_length", "name_length", "admitted"), [(50, 30, True), (51, 30, False), (50, 31, False)]
)
def test_pure_mixed_native_marker_source_limits(json_graph, start_length, name_length, admitted):
    start_id = "n" * start_length
    name = "p" * name_length
    json_graph["nodes"][0]["id"] = start_id
    json_graph["edges"][0]["source"] = start_id
    json_graph["nodes"][0]["data"]["variables"][0]["variable"] = name
    _tool(json_graph)["tool_parameters"]["content"] = {"type": "mixed", "value": f"{{{{#{start_id}.{name}#}}}}"}
    _tool(json_graph)["tool_parameters"]["json_filter"] = {"type": "variable", "value": [start_id, "json_path"]}
    if admitted:
        assert admit_json_workflow(snapshot_for(json_graph)).start_node_id == start_id
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            admit_json_workflow(snapshot_for(json_graph))


def test_direct_variable_retains_general_name_limit(json_graph):
    name = "p" * 64
    json_graph["nodes"][0]["data"]["variables"][0]["variable"] = name
    _tool(json_graph)["tool_parameters"]["content"] = {"type": "variable", "value": ["node1", name]}
    actual = resolve_json_parameters(snapshot_for(json_graph), {name: "{}", "json_path": "$.x"})
    assert actual["content"] == "{}"


@pytest.mark.parametrize("owner", ["sys", "env", "conversation"])
@pytest.mark.parametrize("node_kind", ["start", "tool", "end"])
def test_reserved_native_owner_refuses_for_every_node(json_graph, owner, node_kind):
    index = {"start": 0, "tool": 1, "end": 2}[node_kind]
    original_id = json_graph["nodes"][index]["id"]
    json_graph["nodes"][index]["id"] = owner
    for edge in json_graph["edges"]:
        for key in ("source", "target"):
            if edge[key] == original_id:
                edge[key] = owner
    if node_kind == "start":
        for parameter, name in (("content", "payload"), ("json_filter", "json_path")):
            _tool(json_graph)["tool_parameters"][parameter] = {"type": "mixed", "value": f"{{{{#{owner}.{name}#}}}}"}
    if node_kind == "tool":
        json_graph["nodes"][2]["data"]["outputs"][0]["value_selector"] = [owner, "text"]
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_graph"):
        admit_json_workflow(snapshot_for(json_graph))


def test_optional_start_user_id_cannot_collide_with_native_system_owner(json_graph, monkeypatch):
    from graphon.nodes.start.start_node import StartNode
    from graphon.runtime.variable_pool import VariablePool

    pool = VariablePool()
    pool.add(["sys", "user_id"], "private-system-user")
    assert pool.get(["sys", "user_id"]).value == "private-system-user"
    json_graph["nodes"][0]["id"] = "sys"
    json_graph["edges"][0]["source"] = "sys"
    json_graph["nodes"][0]["data"]["variables"].append(
        {"variable": "user_id", "type": "text-input", "label": "User ID", "required": False, "options": []}
    )
    json_graph["nodes"][2]["data"]["outputs"].append({"variable": "leak", "value_selector": ["sys", "user_id"]})
    for parameter, name in (("content", "payload"), ("json_filter", "json_path")):
        _tool(json_graph)["tool_parameters"][parameter] = {"type": "mixed", "value": f"{{{{#sys.{name}#}}}}"}

    def forbidden(*_args, **_kwargs):
        pytest.fail("reserved owner reached native class validation or pool lookup")

    monkeypatch.setattr(StartNode, "validate_node_data", forbidden)
    monkeypatch.setattr(VariablePool, "get", forbidden)
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_graph"):
        admit_json_workflow(snapshot_for(json_graph))


def test_missing_or_duplicated_ensure_ascii_refuses(json_graph):
    missing = deepcopy(json_graph)
    del _tool(missing)["tool_configurations"]["ensure_ascii"]
    duplicate = deepcopy(json_graph)
    _tool(duplicate)["tool_parameters"]["ensure_ascii"] = {"type": "constant", "value": True}
    for graph in (missing, duplicate):
        with pytest.raises(BuilderExecutionPolicyError):
            admit_json_workflow(snapshot_for(graph))


@pytest.mark.parametrize(
    "value",
    [
        "{{#node1.payload#}}x",
        "x{{#node1.payload#}}",
        "{{#node1.payload#}}{{#node1.payload#}}",
        " {{#node1.payload#}}",
        "{{#node1.payload#}} ",
        "{{#node1.payload.more#}}",
        "{{#sys.user_id#}}",
        "{{#env.secret#}}",
        "{{#node3.text#}}",
        "{{#node1.unknown#}}",
        "{{#node1.payload#}}.secret",
        "{{#node1.payload#}} {{#node1.json_path#}}",
    ],
)
def test_non_pure_mixed_refuses_before_resolution(json_graph, value):
    _tool(json_graph)["tool_parameters"]["content"] = {"type": "mixed", "value": value}
    with pytest.raises(BuilderExecutionPolicyError):
        admit_json_workflow(snapshot_for(json_graph))


@pytest.mark.parametrize(
    "value",
    [
        "node1.payload",
        "sys.user_id",
        "env.secret",
        "a.b",
        "{{#node1.payload#}}",
        "#}}",
        r"\\u002e",
        r"\\u002E",
        r"\\u0023",
        r"\\u007b",
        r"\\u007D",
        "\ud800",
    ],
)
def test_content_constant_lookup_hazards_refuse(json_graph, value):
    _tool(json_graph)["tool_parameters"]["content"] = {"type": "constant", "value": value}
    with pytest.raises(BuilderExecutionPolicyError):
        admit_json_workflow(snapshot_for(json_graph))


def test_direct_start_text_keeps_literal_markers_and_dots(json_graph):
    _tool(json_graph)["tool_parameters"]["content"] = {"type": "variable", "value": ["node1", "payload"]}
    value = r'{"x":"sys.user_id {{#env.secret#}} \\u002e"}'
    actual = resolve_json_parameters(snapshot_for(json_graph), {**_inputs(), "payload": value})
    assert actual["content"] == value


@pytest.mark.parametrize("source_kind", ["mixed", "variable"])
def test_native_generation_and_log_read_only_declared_start_values(json_graph, source_kind):
    from graphon.nodes.tool.tool_node import ToolNode
    from graphon.nodes.tool_runtime_entities import ToolRuntimeParameter
    from graphon.variables.segments import StringSegment

    if source_kind == "variable":
        for parameter, name in (("content", "payload"), ("json_filter", "json_path")):
            _tool(json_graph)["tool_parameters"][parameter] = {"type": "variable", "value": ["node1", name]}
    content = r'{"message":"env.secret {{#sys.user_id#}} \\u002e"}'
    expected = {"content": content, "json_filter": "$.message"}
    values = {("node1", "payload"): content, ("node1", "json_path"): "$.message"}

    class Pool:
        def __init__(self):
            self.reads = []

        def get(self, selector):
            key = tuple(selector)
            self.reads.append(key)
            assert key in values
            return StringSegment(value=values[key])

    pool = Pool()
    native_data = ToolNode.validate_node_data(_tool(json_graph))
    parameters = (ToolRuntimeParameter("content", required=True), ToolRuntimeParameter("json_filter", required=True))
    for for_log in (False, True):
        generated = ToolNode._generate_parameters(
            None, tool_parameters=parameters, variable_pool=pool, node_data=native_data, for_log=for_log
        )
        assert generated == expected
    assert pool.reads == [("node1", "payload"), ("node1", "json_path")] * 2


def test_native_jsonpath_constant_cannot_read_non_start_value(json_graph):
    from graphon.nodes.tool.tool_node import ToolNode
    from graphon.nodes.tool_runtime_entities import ToolRuntimeParameter
    from graphon.variables.segments import StringSegment

    _tool(json_graph)["tool_parameters"]["json_filter"] = {"type": "constant", "value": "$.customer.name"}
    _tool(json_graph)["tool_parameters"]["content"] = {"type": "variable", "value": ["node1", "payload"]}
    reads = []

    class Pool:
        def get(self, selector):
            key = tuple(selector)
            reads.append(key)
            if key == ("node1", "payload"):
                return StringSegment(value='{"customer":{"name":"Ada"}}')
            assert key == ("$", "customer", "name")
            return None

    assert admit_json_workflow(snapshot_for(json_graph)).tool_node_id == "node2"
    native_data = ToolNode.validate_node_data(_tool(json_graph))
    generated = ToolNode._generate_parameters(
        None,
        tool_parameters=(
            ToolRuntimeParameter("content", required=True),
            ToolRuntimeParameter("json_filter", required=True),
        ),
        variable_pool=Pool(),
        node_data=native_data,
    )
    assert generated == {"content": '{"customer":{"name":"Ada"}}', "json_filter": "$.customer.name"}
    assert reads == [("node1", "payload"), ("$", "customer", "name")]


@pytest.mark.parametrize(
    "path",
    [
        "$",
        "$.customer.name",
        "$[0]",
        "$[65535]",
        "$.items[*].name",
        "$.*.name",
        "$." + ".".join(f"n{i}" for i in range(16)),
    ],
)
def test_admitted_jsonpath_grammar(json_graph, path):
    _tool(json_graph)["tool_parameters"]["json_filter"] = {"type": "constant", "value": path}
    assert resolve_json_parameters(snapshot_for(json_graph), _inputs())["json_filter"] == path


@pytest.mark.parametrize(
    "path",
    [
        "$." + "a" * 64,
        "$[00000]",
        "$." + ".".join(["a" * 64] * 15 + ["a" * 47]),
    ],
    ids=["identifier-64", "index-five-digits", "filter-1024-bounded-segments"],
)
def test_jsonpath_detailed_grammar_boundaries_admit(json_graph, path):
    _tool(json_graph)["tool_parameters"]["json_filter"] = {"type": "constant", "value": path}
    assert resolve_json_parameters(snapshot_for(json_graph), _inputs())["json_filter"] == path


@pytest.mark.parametrize(
    "path",
    [
        "$." + "a" * 65,
        "$[000000]",
        "$.*.name",
        "$." + ".".join(["a" * 64] * 15 + ["a" * 48]),
    ],
    ids=["identifier-65", "index-six-digits", "dot-wildcard", "filter-1025-bounded-segments"],
)
@pytest.mark.parametrize("source_kind", ["constant", "variable"])
def test_jsonpath_detailed_grammar_boundaries_refuse(json_graph, path, source_kind):
    inputs = _inputs()
    if source_kind == "constant":
        _tool(json_graph)["tool_parameters"]["json_filter"] = {"type": "constant", "value": path}
    else:
        inputs["json_path"] = path
    with pytest.raises(BuilderExecutionPolicyError):
        resolve_json_parameters(snapshot_for(json_graph), inputs)


@pytest.mark.parametrize(
    "path",
    [
        "",
        "customer",
        "$.a..b",
        "$.a[?(@.x)]",
        "$.a[0:2]",
        "$.a[0,1]",
        "$['a']",
        "$[-1]",
        "$[65536]",
        "$.a[*][*]",
        "$.a b",
        "$.a ",
        "$." + ".".join(f"n{i}" for i in range(17)),
        "$.\ud800",
    ],
)
@pytest.mark.parametrize("source_kind", ["constant", "variable"])
def test_jsonpath_grammar_refuses_constant_and_resolved_values(json_graph, path, source_kind):
    inputs = _inputs()
    if source_kind == "constant":
        _tool(json_graph)["tool_parameters"]["json_filter"] = {"type": "constant", "value": path}
    else:
        inputs["json_path"] = path
    with pytest.raises(BuilderExecutionPolicyError):
        resolve_json_parameters(snapshot_for(json_graph), inputs)


@pytest.mark.parametrize(("size", "valid"), [(1024, True), (1025, False)])
def test_filter_utf8_byte_boundary(json_graph, size, valid):
    value = "$." + "a" * (size - 2)
    inputs = {**_inputs(), "json_path": value}
    if valid:
        assert resolve_json_parameters(snapshot_for(json_graph), inputs)["json_filter"] == value
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            resolve_json_parameters(snapshot_for(json_graph), inputs)


@pytest.mark.parametrize(("size", "valid"), [(65536, True), (65537, False), (32768, True), (32769, False)])
def test_content_utf8_byte_boundary(json_graph, size, valid):
    content = "a" * size if size > 32769 else "é" * size
    inputs = {**_inputs(), "payload": content}
    if valid:
        assert resolve_json_parameters(snapshot_for(json_graph), inputs)["content"] == content
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            resolve_json_parameters(snapshot_for(json_graph), inputs)


def test_parameter_validator_requires_exact_final_types_and_keys():
    valid = {"content": "{}", "json_filter": "$.x", "ensure_ascii": False}
    validate_json_parameters(valid)
    for invalid in ({**valid, "ensure_ascii": 0}, {**valid, "content": None}, {**valid, "extra": "x"}):
        with pytest.raises(BuilderExecutionPolicyError):
            validate_json_parameters(invalid)


def test_qualified_binding_is_frozen_and_strict():
    values = dict.fromkeys(
        ("checksum", "provider_schema_digest", "tool_schema_digest", "qualification_digest", "final_parameters_digest"),
        "a" * 64,
    )
    values.update(
        node_id="node2",
        tenant_id="tenant",
        installation_id="installation",
        plugin_id="plugin",
        provider_id="provider",
        tool_name="parse",
        unique_identifier="identifier",
        version="0.0.8",
        runtime_type="local",
    )
    binding = QualifiedJsonToolBinding(**values)
    with pytest.raises(ValidationError):
        binding.tenant_id = "other"
    with pytest.raises(ValidationError):
        QualifiedJsonToolBinding(**{**values, "runtime_type": "serverless"})
