"""Native ApiTool envelopes stay distinct from controlled HTTP response fields."""

from copy import deepcopy
from typing import cast

import pytest

from core.workflow.generator.runner import WorkflowGenerator
from core.workflow.generator.types import GraphDict, GraphNodeDict, WorkflowGenerateErrorDict

PROVIDER = "14076462-4152-4ef0-aad2-3eaea9369b1a"


def _graph(selector: list[str], **overrides: object) -> GraphDict:
    tool: dict[str, object] = {
        "type": "tool",
        "title": "QA News Search",
        "provider_type": "api",
        "provider_id": PROVIDER,
        "provider_name": PROVIDER,
        "tool_name": "qa_news_search",
        "tool_label": "QA News Search",
        "tool_parameters": {
            "query": {"type": "variable", "value": ["node1", "keyword"]},
            "timespan": {"type": "constant", "value": "24h"},
            "maxrecords": {"type": "constant", "value": 5},
        },
        "tool_configurations": {},
        "output_schema": {},
    }
    tool.update(overrides)
    return cast(
        GraphDict,
        {
            "nodes": [
                {
                    "id": "node1",
                    "data": {
                        "type": "start",
                        "title": "Start",
                        "variables": [{"variable": "keyword", "type": "text-input", "required": True}],
                    },
                },
                {"id": "node2", "data": tool},
                {
                    "id": "node3",
                    "data": {
                        "type": "code",
                        "title": "Project result",
                        "code_language": "python3",
                        "code": "def main(payload):\n    return {'result': payload}",
                        "variables": [{"variable": "payload", "value_selector": selector}],
                        "outputs": {"result": {"type": "array[object]"}},
                    },
                },
                {
                    "id": "node4",
                    "data": {
                        "type": "end",
                        "title": "End",
                        "outputs": [{"variable": "result", "value_selector": ["node3", "result"]}],
                    },
                },
            ],
            "edges": [
                {"source": "node1", "target": "node2"},
                {"source": "node2", "target": "node3"},
                {"source": "node3", "target": "node4"},
            ],
        },
    )


def _process(graph: GraphDict) -> tuple[GraphDict, list[WorkflowGenerateErrorDict]]:
    processed = WorkflowGenerator._postprocess_graph(graph=deepcopy(graph), mode="workflow")
    return processed, WorkflowGenerator._validate_structure(graph=processed, mode="workflow")


def _selector(graph: GraphDict) -> list[str]:
    return cast(list[str], graph["nodes"][2]["data"]["variables"][0]["value_selector"])


@pytest.mark.parametrize("root", ["news", "result", "payload"])
@pytest.mark.parametrize(
    "schema",
    [None, {}, {"properties": {"news": {"type": "array"}, "result": {"type": "array"}, "payload": {"type": "object"}}}],
)
def test_native_api_business_roots_remain_unresolved_after_postprocess(root: str, schema: object) -> None:
    selector = ["node2", root]
    processed, errors = _process(_graph(selector, output_schema=schema))

    assert _selector(processed) == selector
    assert [(error["code"], error["node_id"]) for error in errors] == [("UNRESOLVED_REFERENCE", "node2")]
    detail = errors[0]["detail"]
    assert f"node2.{root}" in detail
    assert all(value in detail for value in ("api", "text", "json", "files", "Code"))
    assert "pars" in detail.lower()


@pytest.mark.parametrize("root", ["text", "json", "files"])
def test_native_api_plain_envelope_roots_are_accepted(root: str) -> None:
    processed, errors = _process(_graph(["node2", root]))

    assert errors == []
    assert _selector(processed) == ["node2", root]


@pytest.mark.parametrize(
    "selector",
    [
        ["node2", "text", "news"],
        ["node2", "text.news"],
        ["node2", "json", "0"],
        ["node2", "json", "news"],
        ["node2", "json", "0", "news"],
        ["node2", "json.0.news"],
        ["node2", "files", "0"],
    ],
)
def test_native_api_selector_cannot_traverse_scalar_or_array_envelope(selector: list[str]) -> None:
    processed, errors = _process(_graph(selector))

    assert _selector(processed) == selector
    assert [(error["code"], error["node_id"]) for error in errors] == [("UNRESOLVED_REFERENCE", "node2")]
    assert ".".join(selector) in errors[0]["detail"]
    assert "Code" in errors[0]["detail"]


def test_native_api_placeholder_reference_does_not_expose_json_response_fields() -> None:
    graph = _graph(["node2", "json"])
    graph["nodes"][3]["data"]["outputs"] = [{"variable": "result", "value_selector": ["node3", "result"]}]
    graph["nodes"][3]["data"]["response_template"] = "{{#node2.text.news#}} {{#node2.json.news#}}"
    processed, errors = _process(graph)

    assert [error["code"] for error in errors] == ["UNRESOLVED_REFERENCE", "UNRESOLVED_REFERENCE"]
    assert processed["nodes"][3]["data"]["response_template"] == "{{#node2.text.news#}} {{#node2.json.news#}}"


def test_native_api_typed_variable_binding_with_long_selector_is_rejected() -> None:
    graph = _graph(["node2", "json"])
    graph["nodes"][3]["data"]["inputs"] = {"nested": {"type": "variable", "value": ["node2", "json", "0", "news"]}}
    processed, errors = _process(graph)

    assert [(error["code"], error["node_id"]) for error in errors] == [("UNRESOLVED_REFERENCE", "node2")]
    assert processed["nodes"][3]["data"]["inputs"]["nested"]["value"] == ["node2", "json", "0", "news"]


def test_native_api_long_plain_string_array_stays_data() -> None:
    graph = _graph(["node2", "json"])
    graph["nodes"][3]["data"]["tags"] = ["node2", "json", "news"]
    processed, errors = _process(graph)

    assert errors == []
    assert processed["nodes"][3]["data"]["tags"] == ["node2", "json", "news"]


@pytest.mark.parametrize(
    "identity",
    [
        {"provider_type": "builtin", "provider_id": "plugin", "provider_name": "plugin"},
        {"provider_type": "api", "provider_id": "code", "provider_name": "code"},
        {"provider_type": None},
        {"provider_type": "workflow"},
    ],
)
def test_unknown_and_plugin_tool_dynamic_outputs_keep_compatibility(identity: dict[str, object]) -> None:
    processed, errors = _process(_graph(["node2", "news"], **identity))

    assert errors == []
    assert _selector(processed) == ["node2", "news"]


def test_native_api_diagnostics_never_include_tool_parameters_or_credentials() -> None:
    graph = _graph(["node2", "news"])
    graph["nodes"][1]["data"]["tool_parameters"]["query"] = {"type": "constant", "value": "private-query-do-not-emit"}
    graph["nodes"][1]["data"]["credential_id"] = "private-credential-do-not-emit"
    _, errors = _process(graph)

    assert len(errors) == 1
    assert "private-query-do-not-emit" not in errors[0]["detail"]
    assert "private-credential-do-not-emit" not in errors[0]["detail"]


def _literal_graph(container: str) -> GraphDict:
    graph = _graph(["node2", "json"])
    data = graph["nodes"][2]["data"]
    literal = {"value_selector": ["node2", "json", "0", "news"]}
    if container == "constant":
        data["inputs"] = {"literal": {"type": "constant", "value": literal}}
    elif container == "condition-value":
        data["conditions"] = [{"variable_selector": ["node2", "json"], "value": literal}]
    elif container == "outputs":
        data["outputs"]["result"]["example"] = literal
    else:
        data[container] = literal
    return graph


@pytest.mark.parametrize(
    "container",
    ["constant", "condition-value", "output_schema", "paramSchemas", "outputs", "default", "options", "metadata"],
)
def test_native_api_literal_selector_keys_are_not_reference_fields(container: str) -> None:
    from services.dify_builder.native_api_output_contract import collect_native_api_selector_refs

    graph = _literal_graph(container)
    nodes = cast(list[dict[str, object]], graph["nodes"])
    assert collect_native_api_selector_refs(nodes, placeholder_pattern=WorkflowGenerator._VAR_REF_RE) == {
        ("node2", "json")
    }


@pytest.mark.parametrize(
    "container",
    ["constant", "condition-value", "output_schema", "paramSchemas", "outputs", "default", "options", "metadata"],
)
def test_native_api_literal_selector_payloads_survive_full_postprocess(container: str) -> None:
    graph = _literal_graph(container)
    processed, errors = _process(graph)

    assert errors == []
    assert _selector(processed) == ["node2", "json"]
    assert (
        processed["nodes"][2]["data"][
            "inputs" if container == "constant" else "conditions" if container == "condition-value" else container
        ]
        == graph["nodes"][2]["data"][
            "inputs" if container == "constant" else "conditions" if container == "condition-value" else container
        ]
    )


@pytest.mark.parametrize("container", ["constant", "output_schema", "paramSchemas"])
def test_native_api_two_segment_literal_array_keeps_existing_data_meaning(container: str) -> None:
    graph = _graph(["node2", "json"])
    data = graph["nodes"][2]["data"]
    literal = ["node2", "news"]
    if container == "constant":
        data["inputs"] = {"literal": {"type": "constant", "value": literal}}
    else:
        data[container] = {"literal": literal}
    processed, errors = _process(graph)

    assert errors == []
    assert _selector(processed) == ["node2", "json"]


def test_native_api_authoritative_refs_include_real_placeholders() -> None:
    from services.dify_builder.native_api_output_contract import collect_native_api_selector_refs

    graph = _graph(["node2", "json"])
    graph["nodes"][3]["data"]["response_template"] = "{{#node2.news#}} {{#node2.text.news#}} {{#node1.keyword#}}"
    nodes = cast(list[dict[str, object]], graph["nodes"])
    assert collect_native_api_selector_refs(nodes, placeholder_pattern=WorkflowGenerator._VAR_REF_RE) == {
        ("node2", "json"),
        ("node2", "news"),
        ("node2", "text.news"),
    }


_RUNTIME_PATHS = (
    "iteration-input",
    "iteration-output",
    "retrieval-query",
    "classifier-query",
    "list-variable",
    "parameter-query",
    "aggregator",
    "aggregator-group",
    "human-default",
    "human-options",
    "assigner-value",
    "loop-variable",
    "tool-mixed",
    "tool-constant-template",
)


def _runtime_consumer(path: str, selector: list[str]) -> dict[str, object]:
    if path.startswith("iteration"):
        return {
            "type": "iteration",
            "iterator_selector": selector if path == "iteration-input" else ["node3", "result"],
            "output_selector": selector if path == "iteration-output" else ["node3", "result"],
        }
    if path in {"retrieval-query", "classifier-query"}:
        return {
            "type": "knowledge-retrieval" if path == "retrieval-query" else "question-classifier",
            "query_variable_selector": selector,
        }
    if path == "list-variable":
        return {"type": "list-operator", "variable": selector}
    if path == "parameter-query":
        return {"type": "parameter-extractor", "query": selector, "parameters": []}
    if path.startswith("aggregator"):
        return {
            "type": "variable-aggregator",
            "variables": [selector] if path == "aggregator" else [],
            "advanced_settings": {
                "group_enabled": path == "aggregator-group",
                "groups": [{"group_name": "group", "output_type": "string", "variables": [selector]}],
            },
        }
    if path.startswith("human"):
        field = "default" if path == "human-default" else "option_source"
        return {
            "type": "human-input",
            "inputs": [
                {
                    "type": "paragraph" if path == "human-default" else "select",
                    "output_variable_name": "reply",
                    field: {"type": "variable", "selector": selector, "value": "" if path == "human-default" else []},
                }
            ],
        }
    if path == "assigner-value":
        return {
            "type": "assigner",
            "version": "2",
            "items": [
                {
                    "variable_selector": ["node1", "keyword"],
                    "input_type": "variable",
                    "operation": "over-write",
                    "value": selector,
                }
            ],
        }
    if path == "loop-variable":
        return {
            "type": "loop",
            "loop_variables": [{"label": "initial", "var_type": "string", "value_type": "variable", "value": selector}],
        }
    assert path in {"tool-mixed", "tool-constant-template"}
    return {
        "type": "tool",
        "provider_type": "builtin",
        "provider_id": "unknown",
        "tool_name": "consume",
        "tool_parameters": {
            "query": {
                "type": "mixed" if path == "tool-mixed" else "constant",
                "value": "{{#" + ".".join(selector) + "#}}",
            }
        },
        "tool_configurations": {},
    }


def _runtime_graph(path: str, selector: list[str]) -> GraphDict:
    graph = _graph(["node2", "json"])
    consumer = _runtime_consumer(path, selector)
    consumer["title"] = "Runtime consumer"
    graph["nodes"].append(cast(GraphNodeDict, {"id": "node5", "data": consumer}))
    if path.startswith("iteration") or path == "loop-variable":
        consumer["start_node_id"] = "node6"
        graph["nodes"].append(
            cast(
                GraphNodeDict,
                {
                    "id": "node6",
                    "parentId": "node5",
                    "data": {
                        "type": "iteration-start" if path.startswith("iteration") else "loop-start",
                        "title": "Inner start",
                    },
                },
            )
        )
    return graph


@pytest.mark.parametrize("path", _RUNTIME_PATHS)
@pytest.mark.parametrize("selector", [["node2", "news"], ["node2", "text", "news"]])
def test_native_api_real_runtime_reference_fields_cannot_silently_drop_invalid_outputs(
    path: str, selector: list[str]
) -> None:
    processed, errors = _process(_runtime_graph(path, selector))
    unresolved = [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]

    assert [(error["code"], error["node_id"]) for error in unresolved] == [("UNRESOLVED_REFERENCE", "node2")]
    assert ".".join(selector) in unresolved[0]["detail"]
    for key, value in _runtime_consumer(path, selector).items():
        assert processed["nodes"][4]["data"][key] == value


@pytest.mark.parametrize("path", _RUNTIME_PATHS)
def test_native_api_real_runtime_reference_fields_accept_whole_json_envelope(path: str) -> None:
    _, errors = _process(_runtime_graph(path, ["node2", "json"]))

    assert not [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]


def test_native_api_retrieval_attachment_selector_is_a_real_reference() -> None:
    graph = _runtime_graph("retrieval-query", ["node2", "json"])
    graph["nodes"][4]["data"]["query_attachment_selector"] = ["node2", "news"]
    _, errors = _process(graph)

    assert [(error["code"], error["node_id"]) for error in errors if error["code"] == "UNRESOLVED_REFERENCE"] == [
        ("UNRESOLVED_REFERENCE", "node2")
    ]


def test_native_api_retrieval_attachment_accepts_whole_files_envelope() -> None:
    graph = _runtime_graph("retrieval-query", ["node2", "text"])
    graph["nodes"][4]["data"]["query_attachment_selector"] = ["node2", "files"]
    _, errors = _process(graph)

    assert not [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]


def test_native_api_selector_segment_padding_cannot_hide_an_invalid_root() -> None:
    _, errors = _process(_graph([" node2 ", " news "]))

    assert [(error["code"], error["node_id"]) for error in errors] == [("UNRESOLVED_REFERENCE", "node2")]
    assert "node2.news" in errors[0]["detail"]


@pytest.mark.parametrize(
    "path",
    ["human-default", "human-options", "assigner-value", "loop-variable", "tool-mixed", "tool-constant-template"],
)
def test_native_api_paired_runtime_constant_values_remain_literal_data(path: str) -> None:
    graph = _runtime_graph(path, ["node2", "news"])
    data = graph["nodes"][4]["data"]
    if path.startswith("human"):
        source = data["inputs"][0]["default" if path == "human-default" else "option_source"]
        source["type"] = "constant"
        source["value"] = ["node2", "news"]
    elif path == "assigner-value":
        data["items"][0]["input_type"] = "constant"
    elif path == "loop-variable":
        data["loop_variables"][0]["value_type"] = "constant"
    else:
        data["tool_parameters"]["query"]["value"] = {"value_selector": ["node2", "news"]}
    processed, errors = _process(graph)

    assert not [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]
    for key in ("inputs", "items", "loop_variables", "tool_parameters"):
        if key in data:
            assert processed["nodes"][4]["data"][key] == data[key]


def test_native_api_aggregator_ignores_disabled_group_selector_data() -> None:
    graph = _runtime_graph("aggregator", ["node2", "json"])
    graph["nodes"][4]["data"]["advanced_settings"]["groups"][0]["variables"] = [["node2", "news"]]
    _, errors = _process(graph)

    assert not [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]


def test_native_api_aggregator_active_groups_ignore_stale_ungrouped_selectors() -> None:
    graph = _runtime_graph("aggregator-group", ["node2", "json"])
    graph["nodes"][4]["data"]["variables"] = [["node2", "news"]]
    _, errors = _process(graph)

    assert not [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]


@pytest.mark.parametrize("path", _RUNTIME_PATHS[:-2])
def test_native_api_runtime_selector_lists_cannot_index_json_payloads(path: str) -> None:
    _, errors = _process(_runtime_graph(path, ["node2", "json", "0"]))
    unresolved = [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]

    assert [(error["code"], error["node_id"]) for error in unresolved] == [("UNRESOLVED_REFERENCE", "node2")]
    assert "node2.json.0" in unresolved[0]["detail"]


_VALUE_TEMPLATE_PATHS = (
    "http-json",
    "http-raw-text",
    "http-form-urlencoded",
    "http-form-data",
    "if-else",
    "if-nested",
    "loop",
    "loop-nested",
    "list-filter",
    "agent-mixed",
    "agent-constant",
    "datasource-mixed",
)


def _value_template_graph(path: str, template: object) -> GraphDict:
    graph = _graph(["node2", "json"])
    condition = {
        "variable_selector": ["node1", "keyword"],
        "varType": "string",
        "comparison_operator": "is",
        "value": template,
    }
    if path.startswith("http"):
        body_type = {
            "http-json": "json",
            "http-raw-text": "raw-text",
            "http-form-urlencoded": "x-www-form-urlencoded",
            "http-form-data": "form-data",
        }[path]
        data: dict[str, object] = {
            "type": "http-request",
            "method": "post",
            "url": "https://fixture.invalid",
            "body": {"type": body_type, "data": [{"type": "text", "key": "", "value": template, "file": []}]},
        }
    elif path.startswith("if"):
        data = {
            "type": "if-else",
            "cases": [
                {
                    "case_id": "true",
                    "logical_operator": "and",
                    "conditions": [
                        condition
                        if path == "if-else"
                        else {
                            "variable_selector": ["node1", "keyword"],
                            "comparison_operator": "is",
                            "sub_variable_condition": {
                                "logical_operator": "and",
                                "conditions": [{"key": "name", "comparison_operator": "is", "value": template}],
                            },
                        }
                    ],
                }
            ],
        }
    elif path.startswith("loop"):
        data = {
            "type": "loop",
            "start_node_id": "node6",
            "loop_variables": [],
            "break_conditions": [
                condition
                if path == "loop"
                else {
                    "variable_selector": ["node1", "keyword"],
                    "comparison_operator": "is",
                    "sub_variable_condition": {
                        "logical_operator": "and",
                        "conditions": [{"key": "name", "comparison_operator": "is", "value": template}],
                    },
                }
            ],
        }
    elif path == "list-filter":
        data = {
            "type": "list-operator",
            "variable": ["node2", "json"],
            "filter_by": {"enabled": True, "conditions": [{"comparison_operator": "is", "value": template}]},
        }
    else:
        parameter_name = "datasource_parameters" if path == "datasource-mixed" else "agent_parameters"
        data = {
            "type": "datasource" if path == "datasource-mixed" else "agent",
            parameter_name: {"query": {"type": "constant" if path == "agent-constant" else "mixed", "value": template}},
        }
    data["title"] = "Template consumer"
    graph["nodes"].append(cast(GraphNodeDict, {"id": "node5", "data": data}))
    if path.startswith("loop"):
        graph["nodes"].append(
            cast(
                GraphNodeDict,
                {"id": "node6", "parentId": "node5", "data": {"type": "loop-start", "title": "Inner start"}},
            )
        )
    return graph


@pytest.mark.parametrize("path", _VALUE_TEMPLATE_PATHS)
@pytest.mark.parametrize("root", ["news", "text.news"])
def test_native_api_actual_value_templates_keep_invalid_references_visible(path: str, root: str) -> None:
    _, errors = _process(_value_template_graph(path, "{{#node2." + root + "#}}"))
    unresolved = [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]

    assert [(error["code"], error["node_id"]) for error in unresolved] == [("UNRESOLVED_REFERENCE", "node2")]
    assert "node2." + root in unresolved[0]["detail"]


@pytest.mark.parametrize("path", _VALUE_TEMPLATE_PATHS)
def test_native_api_actual_value_templates_accept_whole_text(path: str) -> None:
    _, errors = _process(_value_template_graph(path, "{{#node2.text#}}"))

    assert not [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]


def _http_file_graph(body_type: str, selector: list[str]) -> GraphDict:
    graph = _value_template_graph("http-form-data", "")
    graph["nodes"][4]["data"]["body"] = {
        "type": body_type,
        "data": [{"type": "file", "key": "upload", "value": "", "file": selector}],
    }
    return graph


@pytest.mark.parametrize("body_type", ["binary", "form-data"])
@pytest.mark.parametrize("selector", [["node2", "news"], ["node2", "json", "0"]])
def test_native_api_active_http_file_selectors_reject_business_or_index_roots(
    body_type: str, selector: list[str]
) -> None:
    _, errors = _process(_http_file_graph(body_type, selector))
    unresolved = [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]

    assert [(error["code"], error["node_id"]) for error in unresolved] == [("UNRESOLVED_REFERENCE", "node2")]
    assert ".".join(selector) in unresolved[0]["detail"]


@pytest.mark.parametrize("body_type", ["binary", "form-data"])
def test_native_api_active_http_file_selectors_accept_whole_files(body_type: str) -> None:
    _, errors = _process(_http_file_graph(body_type, ["node2", "files"]))

    assert not [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]


@pytest.mark.parametrize("path", ["if-else", "loop", "list-filter"])
@pytest.mark.parametrize("literal", [["node2", "news"], {"value_selector": ["node2", "json", "0"]}])
def test_native_api_comparison_array_or_object_values_stay_literal(path: str, literal: object) -> None:
    _, errors = _process(_value_template_graph(path, literal))

    assert not [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]


def test_native_api_inactive_http_body_and_file_fields_remain_data() -> None:
    graphs = [
        _http_file_graph("none", ["node2", "news"]),
        _http_file_graph("binary", ["node2", "files"]),
        _http_file_graph("form-data", ["node2", "files"]),
        _value_template_graph("http-form-data", "{{#node2.text#}}"),
    ]
    for index, graph in enumerate(graphs):
        entry = graph["nodes"][4]["data"]["body"]["data"][0]
        if index < 3:
            entry["value"] = "{{#node2.news#}}"
        else:
            entry["file"] = ["node2", "news"]
        _, errors = _process(graph)
        assert not [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]


def test_native_api_disabled_list_filter_template_remains_data() -> None:
    graph = _value_template_graph("list-filter", "{{#node2.news#}}")
    graph["nodes"][4]["data"]["filter_by"]["enabled"] = False
    _, errors = _process(graph)

    assert not [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]


@pytest.mark.parametrize("path", ["assigner-value", "loop-variable"])
def test_native_api_typed_constant_string_value_is_not_a_template(path: str) -> None:
    graph = _runtime_graph(path, ["node2", "json"])
    data = graph["nodes"][4]["data"]
    item = data["items"][0] if path == "assigner-value" else data["loop_variables"][0]
    item["input_type" if path == "assigner-value" else "value_type"] = "constant"
    item["value"] = "{{#node2.news#}}"
    _, errors = _process(graph)

    assert not [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]


def test_native_api_static_code_source_string_is_not_a_runtime_template() -> None:
    graph = _graph(["node2", "json"])
    graph["nodes"][2]["data"]["code"] = "def main(payload):\n    return {'result': '{{#node2.news#}}'}"
    _, errors = _process(graph)

    assert errors == []


_MODEL_REFERENCE_BRANCHES = (
    ("llm", "context"),
    ("llm", "vision"),
    ("question-classifier", "vision"),
    ("parameter-extractor", "vision"),
)


@pytest.mark.parametrize(("node_type", "branch"), _MODEL_REFERENCE_BRANCHES)
@pytest.mark.parametrize("enabled", [False, None, True])
@pytest.mark.parametrize("root", ["news", "files"])
def test_native_api_model_context_and_vision_refs_follow_runtime_enabled_flags(
    node_type: str, branch: str, enabled: bool | None, root: str
) -> None:
    graph = _graph(["node2", "json"])
    config: dict[str, object] = (
        {"variable_selector": ["node2", root]}
        if branch == "context"
        else {"configs": {"variable_selector": ["node2", root]}}
    )
    if enabled is not None:
        config["enabled"] = enabled
    data = {"type": node_type, "title": "Model reference consumer", branch: config}
    graph["nodes"].append(cast(GraphNodeDict, {"id": "node5", "data": data}))
    processed, errors = _process(graph)
    unresolved = [error for error in errors if error["code"] == "UNRESOLVED_REFERENCE"]

    if enabled is True and root == "news":
        assert [(error["code"], error["node_id"]) for error in unresolved] == [("UNRESOLVED_REFERENCE", "node2")]
    else:
        assert unresolved == []
    actual = processed["nodes"][4]["data"][branch]
    assert (actual["variable_selector"] if branch == "context" else actual["configs"]["variable_selector"]) == [
        "node2",
        root,
    ]


@pytest.mark.parametrize("branch", ["context", "vision"])
def test_native_api_enabled_flag_exception_is_scoped_to_model_schema_branches(branch: str) -> None:
    graph = _graph(["node2", "json"])
    graph["nodes"][2]["data"][branch] = {"enabled": False, "variable_selector": ["node2", "news"]}
    _, errors = _process(graph)

    assert [(error["code"], error["node_id"]) for error in errors] == [("UNRESOLVED_REFERENCE", "node2")]
