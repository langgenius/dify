"""Pure admission for the installed, qualified JSON Process parse workflow.

This module inspects raw source before Graphon builds a Tool node. Its resolved
parameter envelope is an expectation for the later native adapter, never a
replacement for native parameter conversion or JSONPath evaluation.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, NoReturn

from core.dify_builder.execution_policy import (
    RestrictedAdmissionSnapshot,
    admit_raw_execution_metadata,
)
from core.workflow.variable_prefixes import (
    CONVERSATION_VARIABLE_NODE_ID,
    ENVIRONMENT_VARIABLE_NODE_ID,
    SYSTEM_VARIABLE_NODE_ID,
)
from services.dify_builder.execution_contracts import (
    AdmittedNodeBinding,
    BuilderExecutionPolicyError,
    QualifiedJsonToolBinding,
    canonical_digest,
)

__all__ = [
    "JsonToolAdmission",
    "QualifiedJsonToolBinding",
    "admit_json_workflow",
    "resolve_json_parameters",
    "validate_json_parameters",
]

_PLUGIN_ID = "langgenius/json_process"
_PROVIDER_ID = "langgenius/json_process/json_process"
_UNIQUE_IDENTIFIER = "langgenius/json_process:0.0.8@3333687ec0412e1f2a1798d632fc5f3187f36ebd4bf2432a599a96c74e92f503"
_NODE_ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z", re.ASCII)
_RESERVED_NATIVE_OWNERS = frozenset(
    {SYSTEM_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID, CONVERSATION_VARIABLE_NODE_ID}
)
_START_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}\Z", re.ASCII)
_PURE_MIXED = re.compile(r"\{\{#([A-Za-z0-9_]{1,50})\.([A-Za-z_][A-Za-z0-9_]{0,29})#\}\}\Z", re.ASCII)
_PATH_PART = re.compile(r"\.([A-Za-z_][A-Za-z0-9_]{0,63})|\[([0-9]{1,5}|\*)\]", re.ASCII)
_UNSAFE_CONTENT = re.compile(r"\.|\{\{#|#\}\}|\\u(?:002e|0023|007b|007d)", re.IGNORECASE)
_START_DATA = {"type", "version", "variables", "title", "desc", "selected"}
_END_DATA = {"type", "version", "outputs", "title", "desc", "selected"}
_TOOL_DATA = {
    "type",
    "version",
    "tool_node_version",
    "provider_type",
    "provider_id",
    "provider_name",
    "plugin_id",
    "plugin_unique_identifier",
    "tool_name",
    "tool_label",
    "tool_description",
    "tool_configurations",
    "tool_parameters",
    "paramSchemas",
    "params",
    "output_schema",
    "title",
    "desc",
    "selected",
    "credential_id",
    "credential_type",
    "credential_name",
}
_PARAM_SCHEMA_KEYS = {
    "auto_generate",
    "default",
    "form",
    "human_description",
    "input_schema",
    "label",
    "llm_description",
    "max",
    "min",
    "multiple",
    "name",
    "options",
    "placeholder",
    "precision",
    "required",
    "scope",
    "template",
    "type",
}
_GRAPH_KEYS = {"nodes", "edges", "viewport"}
_NODE_KEYS = {
    "id",
    "data",
    "height",
    "position",
    "positionAbsolute",
    "selected",
    "sourcePosition",
    "targetPosition",
    "type",
    "width",
    "zIndex",
}
_EDGE_KEYS = {
    "id",
    "source",
    "target",
    "sourceHandle",
    "targetHandle",
    "type",
    "data",
    "zIndex",
}
_MAX_CONTENT = 65536
_MAX_FILTER = 1024


@dataclass(frozen=True, slots=True)
class JsonToolAdmission:
    nodes: tuple[AdmittedNodeBinding, AdmittedNodeBinding, AdmittedNodeBinding]
    start_node_id: str
    tool_node_id: str
    end_node_id: str


def _refuse(reason: str = "unsupported_json_tool_configuration") -> NoReturn:
    raise BuilderExecutionPolicyError(reason)


def _bounded_text(value: object, limit: int) -> str:
    if type(value) is not str:
        _refuse()
    if len(value) > limit:
        _refuse("json_execution_limit")
    try:
        size = len(value.encode("utf-8"))
    except UnicodeError:
        _refuse()
    if size > limit:
        _refuse("json_execution_limit")
    return value


def _validate_path(value: object) -> str:
    path = _bounded_text(value, _MAX_FILTER)
    if not path.startswith("$"):
        _refuse("unsupported_json_filter")
    index, count, wildcards = 1, 0, 0
    while index < len(path):
        match = _PATH_PART.match(path, index)
        if match is None:
            _refuse("unsupported_json_filter")
        count += 1
        if count > 16:
            _refuse("unsupported_json_filter")
        part = match.group(0)
        if part == "[*]":
            wildcards += 1
            if wildcards > 1:
                _refuse("unsupported_json_filter")
        elif match.group(2) is not None and int(match.group(2)) > 65535:
            _refuse("unsupported_json_filter")
        index = match.end()
    return path


def _validate_content(value: object, *, constant: bool) -> str:
    content = _bounded_text(value, _MAX_CONTENT)
    if constant and _UNSAFE_CONTENT.search(content):
        _refuse("unsupported_json_content_constant")
    return content


def _start_variables(data: Mapping[str, Any]) -> set[str]:
    variables = data.get("variables")
    if not isinstance(variables, list) or len(variables) > 128:
        _refuse("unsupported_start_input")
    names: set[str] = set()
    for item in variables:
        if not isinstance(item, dict) or set(item) - {"variable", "type", "label", "required", "max_length", "options"}:
            _refuse("unsupported_start_input")
        name = item.get("variable")
        if (
            type(name) is not str
            or not _START_NAME.fullmatch(name)
            or name in names
            or item.get("type") not in {"text-input", "paragraph", "select"}
            or ("required" in item and type(item["required"]) is not bool)
            or (
                "max_length" in item
                and (type(item["max_length"]) is not int or not 0 <= item["max_length"] <= _MAX_CONTENT)
            )
            or (
                "options" in item
                and (
                    not isinstance(item["options"], list) or any(type(option) is not str for option in item["options"])
                )
            )
        ):
            _refuse("unsupported_start_input")
        names.add(name)
    return names


def _string_source(raw: object, *, parameter: str, start_id: str, names: set[str]) -> tuple[str, str]:
    if not isinstance(raw, dict) or set(raw) != {"type", "value"}:
        _refuse()
    kind, value = raw["type"], raw["value"]
    if kind == "constant":
        if parameter == "content":
            return kind, _validate_content(value, constant=True)
        return kind, _validate_path(value)
    if kind == "variable":
        if (
            not isinstance(value, list)
            or len(value) != 2
            or type(value[0]) is not str
            or type(value[1]) is not str
            or value[0] != start_id
            or value[1] not in names
        ):
            _refuse("unsupported_json_selector")
        return kind, value[1]
    if kind == "mixed":
        if type(value) is not str:
            _refuse("unsupported_json_selector")
        match = _PURE_MIXED.fullmatch(value)
        if match is None or match.group(1) != start_id or match.group(2) not in names:
            _refuse("unsupported_json_selector")
        return kind, match.group(2)
    _refuse("unsupported_json_selector")


def _ensure_ascii(value: object) -> bool:
    if type(value) is bool:
        return value
    if isinstance(value, dict) and set(value) == {"type", "value"} and value["type"] == "constant":
        if type(value["value"]) is bool:
            return value["value"]
    _refuse()


def _preflight_tool(data: Mapping[str, Any], start_id: str, names: set[str]) -> None:
    if set(data) - _TOOL_DATA or data.get("type") != "tool" or data.get("version", "1") != "1":
        _refuse()
    if (
        data.get("tool_node_version") != "2"
        or data.get("provider_type") != "builtin"
        or data.get("provider_id") != _PROVIDER_ID
        or data.get("plugin_id") != _PLUGIN_ID
        or data.get("tool_name") != "parse"
        or (
            data.get("plugin_unique_identifier") is not None
            and data.get("plugin_unique_identifier") != _UNIQUE_IDENTIFIER
        )
        or data.get("provider_name") not in (None, _PROVIDER_ID)
    ):
        _refuse()
    if any(data.get(key) is not None for key in ("credential_id", "credential_type", "credential_name")):
        _refuse("unsupported_json_credentials")
    if data.get("output_schema", {}) != {}:
        _refuse()
    parameters, configurations = data.get("tool_parameters"), data.get("tool_configurations")
    if (
        not isinstance(parameters, dict)
        or set(parameters) != {"content", "json_filter"}
        or not isinstance(configurations, dict)
        or set(configurations) != {"ensure_ascii"}
    ):
        _refuse()
    _ensure_ascii(configurations["ensure_ascii"])
    for name in ("content", "json_filter"):
        _string_source(parameters[name], parameter=name, start_id=start_id, names=names)
    schemas = data.get("paramSchemas")
    if not isinstance(schemas, list) or len(schemas) != 3:
        _refuse()
    schema_by_name = {}
    for schema in schemas:
        if (
            not isinstance(schema, dict)
            or set(schema) - _PARAM_SCHEMA_KEYS
            or type(schema.get("name")) is not str
            or schema["name"] in schema_by_name
        ):
            _refuse()
        schema_by_name[schema["name"]] = schema
    if set(schema_by_name) != {"content", "json_filter", "ensure_ascii"}:
        _refuse()
    for name, form, kind in (
        ("content", "llm", "string"),
        ("json_filter", "llm", "string"),
        ("ensure_ascii", "form", "boolean"),
    ):
        schema = schema_by_name[name]
        if (
            schema.get("form") != form
            or schema.get("type") != kind
            or schema.get("scope") is not None
            or schema.get("auto_generate") is not None
            or schema.get("input_schema") is not None
            or schema.get("template") is not None
            or schema.get("multiple") is not False
            or schema.get("options") != []
            or schema.get("required") is not (name != "ensure_ascii")
            or schema.get("default") != (True if name == "ensure_ascii" else None)
        ):
            _refuse()
    if data.get("params") != {"content": "", "json_filter": "", "ensure_ascii": ""}:
        _refuse()


def admit_json_workflow(snapshot: RestrictedAdmissionSnapshot) -> JsonToolAdmission:
    """Require exactly the audited native Start→Tool→End graph and raw values."""
    from pydantic import ValidationError

    from core.workflow.node_factory import resolve_workflow_node_class
    from graphon.nodes.end.end_node import EndNode
    from graphon.nodes.start.start_node import StartNode
    from graphon.nodes.tool.tool_node import ToolNode

    admit_raw_execution_metadata(snapshot)
    graph = snapshot.graph
    if set(graph) - _GRAPH_KEYS:
        _refuse("unsupported_graph")
    nodes, edges = graph.get("nodes"), graph.get("edges")
    if not isinstance(nodes, list) or len(nodes) != 3 or not isinstance(edges, list) or len(edges) != 2:
        _refuse("unsupported_graph")
    by_type: dict[str, tuple[str, dict[str, Any]]] = {}
    seen: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict) or set(node) - _NODE_KEYS or not isinstance(node.get("data"), dict):
            _refuse("unsupported_graph")
        data, node_id = node["data"], node.get("id")
        if (
            type(node_id) is not str
            or not _NODE_ID.fullmatch(node_id)
            or node_id in seen
            or node_id in _RESERVED_NATIVE_OWNERS
        ):
            _refuse("unsupported_graph")
        if any(
            node.get(key) or data.get(key)
            for key in ("parentId", "parent_id", "iteration_id", "loop_id", "isInIteration", "isInLoop")
        ):
            _refuse("unsupported_graph")
        kind = data.get("type")
        if type(kind) is not str or kind not in {"start", "tool", "end"} or kind in by_type:
            _refuse("unsupported_graph")
        seen.add(node_id)
        by_type[kind] = (node_id, data)
    if set(by_type) != {"start", "tool", "end"}:
        _refuse("unsupported_graph")
    start_id, start_data = by_type["start"]
    tool_id, tool_data = by_type["tool"]
    end_id, end_data = by_type["end"]
    if set(start_data) - _START_DATA or set(end_data) - _END_DATA:
        _refuse()
    names = _start_variables(start_data)
    _preflight_tool(tool_data, start_id, names)
    outputs = end_data.get("outputs")
    if not isinstance(outputs, list) or not outputs or len(outputs) > 128:
        _refuse("unsupported_selector")
    tool_output = False
    output_names: set[str] = set()
    for output in outputs:
        if not isinstance(output, dict) or set(output) != {"variable", "value_selector"}:
            _refuse("unsupported_selector")
        name, selector = output["variable"], output["value_selector"]
        if type(name) is not str or not _START_NAME.fullmatch(name) or name in output_names:
            _refuse("unsupported_selector")
        output_names.add(name)
        if not isinstance(selector, list) or len(selector) != 2 or any(type(x) is not str for x in selector):
            _refuse("unsupported_selector")
        if selector == [tool_id, "text"]:
            tool_output = True
        elif selector[0] != start_id or selector[1] not in names:
            _refuse("unsupported_selector")
    if not tool_output:
        _refuse("unsupported_selector")
    connections = set()
    for edge in edges:
        if (
            not isinstance(edge, dict)
            or set(edge) - _EDGE_KEYS
            or edge.get("sourceHandle", "source") != "source"
            or edge.get("targetHandle", "target") != "target"
        ):
            _refuse("unsupported_graph")
        if not all(type(edge.get(key)) is str for key in ("source", "target")):
            _refuse("unsupported_graph")
        edge_data = edge.get("data", {})
        if not isinstance(edge_data, dict) or any(
            edge_data.get(key) for key in ("isInIteration", "isInLoop", "iteration_id", "loop_id")
        ):
            _refuse("unsupported_graph")
        connections.add((edge["source"], edge["target"]))
    if connections != {(start_id, tool_id), (tool_id, end_id)}:
        _refuse("unsupported_graph")
    # Source checks above run before graph hashing, native class construction or logging.
    canonical_digest(graph)
    audited = {"start": StartNode, "tool": ToolNode, "end": EndNode}
    bindings = []
    for kind in ("start", "tool", "end"):
        node_id, data = by_type[kind]
        version = data.get("version", "1")
        if version != "1":
            _refuse("unsupported_node_implementation")
        cls = resolve_workflow_node_class(node_type=kind, node_version=version, node_data=data)
        if cls is not audited[kind] or cls.version() != "1":
            _refuse("unsupported_node_implementation")
        try:
            cls.validate_node_data(data)
        except (ValidationError, ValueError, TypeError):
            _refuse("invalid_node_configuration")
        bindings.append(
            AdmittedNodeBinding(
                node_id=node_id,
                implementation=f"{cls.__module__}.{cls.__qualname__}",
                node_version="1",
                normalized_config_digest=canonical_digest({**data, "version": "1"}),
            )
        )
    return JsonToolAdmission(
        nodes=(bindings[0], bindings[1], bindings[2]), start_node_id=start_id, tool_node_id=tool_id, end_node_id=end_id
    )


def resolve_json_parameters(
    snapshot: RestrictedAdmissionSnapshot, effective_inputs: Mapping[str, object]
) -> dict[str, str | bool]:
    """Compute the expected scalar envelope solely from owned effective Start inputs."""
    admitted = admit_json_workflow(snapshot)
    if not isinstance(effective_inputs, Mapping):
        _refuse("unsupported_input_value")
    nodes = {node["id"]: node["data"] for node in snapshot.graph["nodes"]}
    data = nodes[admitted.tool_node_id]
    names = _start_variables(nodes[admitted.start_node_id])
    resolved: dict[str, str | bool] = {}
    for parameter in ("content", "json_filter"):
        kind, source = _string_source(
            data["tool_parameters"][parameter], parameter=parameter, start_id=admitted.start_node_id, names=names
        )
        if kind == "constant":
            resolved[parameter] = source
        else:
            value = effective_inputs.get(source)
            resolved[parameter] = (
                _validate_content(value, constant=False) if parameter == "content" else _validate_path(value)
            )
    resolved["ensure_ascii"] = _ensure_ascii(data["tool_configurations"]["ensure_ascii"])
    validate_json_parameters(resolved)
    return resolved


def validate_json_parameters(parameters: Mapping[str, object]) -> None:
    """Validate the final native scalar envelope before its digest or dispatch."""
    if not isinstance(parameters, Mapping) or set(parameters) != {"content", "json_filter", "ensure_ascii"}:
        _refuse("invalid_json_parameters")
    _validate_content(parameters["content"], constant=False)
    _validate_path(parameters["json_filter"])
    if type(parameters["ensure_ascii"]) is not bool:
        _refuse("invalid_json_parameters")
