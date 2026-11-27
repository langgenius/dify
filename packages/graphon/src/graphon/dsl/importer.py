from __future__ import annotations

import time
from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import asdict
from enum import StrEnum, auto
from typing import Any, cast
from uuid import uuid4

import yaml
from pydantic import ValidationError

from graphon.engine import Engine
from graphon.engine.command import CommandChannel
from graphon.engine.container_handler import ContainerHandlerFactory
from graphon.enums import BuiltinNodeTypes
from graphon.graph.graph import Graph
from graphon.graph.scoping import resolve_container_id
from graphon.graph.validation import GraphValidationError
from graphon.runtime.init_params import InitParams
from graphon.runtime.runtime_state import RuntimeState
from graphon.runtime.variable_pool import VariablePool

from .entities import (
    DslCredentials,
    DslDependency,
    DslDocument,
    DslImportPlan,
    DslKind,
    DslRuntimeVariable,
    DslRuntimeVariables,
    LoadStatus,
    PluginDependencyType,
)
from .errors import DslError
from .node_factory import SUPPORTED_DEFAULT_FACTORY_NODE_TYPES, SlimDslNodeFactory


class _DslKey(StrEnum):
    KIND = auto()
    APP = auto()
    RAG_PIPELINE = auto()
    GRAPH = auto()
    GRAPH_CONFIG = auto()
    WORKFLOW = auto()


_EXECUTABLE_DIFY_APP_MODES = frozenset(("workflow", "advanced-chat"))
_CONFIG_ONLY_DIFY_APP_MODES = frozenset((
    "completion",
    "chat",
    "agent-chat",
    "channel",
))


def _dsl_error(
    message: str,
    *,
    code: str,
    path: str | None = None,
    kind: str | None = None,
    details: Mapping[str, Any] | None = None,
) -> DslError:
    return DslError(
        message,
        code=code,
        path=path,
        kind=kind,
        details=details,
    )


def inspect(
    dsl: str,
    *,
    source_kind: DslKind | None = None,
) -> DslImportPlan:
    payload = _parse_yaml(dsl)
    kind = _resolve_kind(
        payload,
        source_kind=source_kind,
    )
    return _build_plan(payload, kind=kind)


def loads(
    dsl: str,
    *,
    credentials: dict[str, Any] | str | None = None,
    source_kind: DslKind | None = None,
    workflow_id: str | None = None,
    root_node_id: str | None = None,
    run_context: Mapping[str, Any] | None = None,
    start_inputs: Mapping[str, Any] | None = None,
    command_channel: CommandChannel | None = None,
    workers: int = 5,
    container_handler_factories: Sequence[ContainerHandlerFactory] = (),
) -> Engine:
    plan = inspect(dsl, source_kind=source_kind)
    if plan.load_status == LoadStatus.UNSUPPORTED:
        raise _dsl_error(
            plan.load_reason or "DSL cannot be loaded.",
            code="plan.unsupported",
            kind=plan.document.kind,
        )
    if plan.load_status == LoadStatus.FAILED:
        raise _dsl_error(
            plan.load_reason or "DSL import failed.",
            code="plan.failed",
            kind=plan.document.kind,
        )

    graph_config = plan.document.graph_config
    if graph_config is None:
        msg = "DSL does not contain an executable graph."
        raise _dsl_error(
            msg,
            code="graph.missing",
            kind=plan.document.kind,
        )

    root_id = root_node_id or _select_root_node_id(graph_config)
    workflow_id = workflow_id if workflow_id is not None else str(uuid4())
    variable_pool = _build_variable_pool(
        runtime_variables=plan.document.runtime_variables,
        root_node_id=root_id,
        run_context=run_context or {},
        start_inputs=start_inputs or {},
    )
    init_params = InitParams(
        workflow_id=workflow_id,
        graph_config=graph_config,
        run_context=run_context or {},
        call_depth=0,
    )
    runtime_state = RuntimeState(
        variable_pool=variable_pool,
        start_at=time.time(),
        workflow_id=workflow_id,
    )
    parsed_credentials = _parse_credentials(credentials)
    node_factory = SlimDslNodeFactory(
        graph_config=graph_config,
        init_params=init_params,
        runtime_state=runtime_state,
        credentials=parsed_credentials,
        dependencies=list(plan.dependencies),
    )

    try:
        graph = Graph.init(
            graph_config=graph_config,
            node_factory=node_factory,
            root_node_id=root_id,
        )
    except DslError:
        raise
    except GraphValidationError as error:
        raise _dsl_error(
            str(error),
            code="graph.validation_failed",
            kind=plan.document.kind,
            details={"issues": [asdict(issue) for issue in error.issues]},
        ) from error
    except Exception as error:
        raise _dsl_error(
            str(error),
            code="graph.build_failed",
            kind=plan.document.kind,
        ) from error

    return Engine(
        graph=graph,
        runtime_state=runtime_state,
        command_channel=command_channel,
        workers=workers,
        container_handler_factories=container_handler_factories,
    )


def _parse_credentials(
    credentials: dict[str, Any] | str | None,
) -> DslCredentials:
    if credentials is None:
        return DslCredentials()

    try:
        if isinstance(credentials, str):
            return DslCredentials.model_validate_json(credentials)
        if isinstance(credentials, dict):
            return DslCredentials.model_validate(credentials)
    except ValidationError as error:
        msg = "Invalid credentials JSON."
        raise _dsl_error(
            msg,
            code="credentials.invalid",
            path="/credentials",
        ) from error

    msg = "Credentials must be a JSON object or JSON string."
    raise _dsl_error(
        msg,
        code="credentials.expected_json",
        path="/credentials",
        details={"actual_type": type(credentials).__name__},
    )


def _parse_yaml(dsl: str) -> dict[str, Any]:
    try:
        loaded = yaml.safe_load(dsl)
    except yaml.YAMLError as error:
        msg = "Invalid YAML DSL."
        raise _dsl_error(
            msg,
            code="parse.invalid_yaml",
        ) from error
    if not isinstance(loaded, dict):
        msg = "DSL content must be a mapping."
        raise _dsl_error(
            msg,
            code="parse.expected_mapping",
        )
    return loaded


def _resolve_kind(
    payload: Mapping[str, Any],
    *,
    source_kind: DslKind | None,
) -> DslKind:
    actual_kind = _kind_from_value(payload.get(_DslKey.KIND))
    if source_kind is not None:
        if actual_kind != source_kind:
            msg = "DSL kind does not match requested source kind."
            raise _dsl_error(
                msg,
                code="kind.mismatch",
                path="/kind",
                kind=source_kind,
                details={"expected": source_kind, "actual": actual_kind},
            )
        return source_kind
    return actual_kind


def _kind_from_value(kind: object) -> DslKind:
    if not isinstance(kind, str) or not kind:
        msg = "DSL kind is required."
        raise _dsl_error(
            msg,
            code="kind.missing",
            path="/kind",
        )
    try:
        return DslKind(kind)
    except ValueError:
        msg = f"Unsupported DSL kind: {kind}"
        raise _dsl_error(
            msg,
            code="kind.unsupported",
            path="/kind",
            details={"kind": kind},
        ) from None


def _build_plan(
    payload: Mapping[str, Any],
    *,
    kind: DslKind,
) -> DslImportPlan:
    match kind:
        case DslKind.APP:
            return _build_dify_app_plan(payload)
        case DslKind.RAG_PIPELINE:
            return _unsupported_plan(
                kind=kind,
                reason="Dify RAG pipeline import is inspect-only.",
            )
        case DslKind.GRAPH:
            graph_config = _extract_graphon_graph(payload)
            return _build_graph_plan(
                kind=kind,
                graph_config=graph_config,
                dependencies=_extract_dependencies(payload),
            )


def _build_dify_app_plan(payload: Mapping[str, Any]) -> DslImportPlan:
    app = payload.get(_DslKey.APP)
    if not isinstance(app, Mapping):
        msg = "Dify app DSL must contain an app mapping."
        raise _dsl_error(
            msg,
            code="kind.missing_app",
            path="/app",
            kind=DslKind.APP,
        )

    app_mode = str(app.get("mode") or "")
    dependencies = _extract_dependencies(payload)
    if app_mode in _CONFIG_ONLY_DIFY_APP_MODES:
        return _unsupported_plan(
            kind=DslKind.APP,
            dependencies=dependencies,
            reason=f"Dify {app_mode} app import is inspect-only.",
        )
    if app_mode not in _EXECUTABLE_DIFY_APP_MODES:
        return _unsupported_plan(
            kind=DslKind.APP,
            dependencies=dependencies,
            reason=f"Dify app mode {app_mode!r} is not loadable.",
        )

    workflow = payload.get(_DslKey.WORKFLOW)
    if not isinstance(workflow, Mapping):
        msg = "Dify workflow app DSL must contain a workflow mapping."
        raise _dsl_error(
            msg,
            code="graph.missing_workflow",
            path="/workflow",
            kind=DslKind.APP,
        )
    graph = workflow.get(_DslKey.GRAPH)
    if not isinstance(graph, Mapping):
        msg = "Dify workflow app DSL must contain workflow.graph."
        raise _dsl_error(
            msg,
            code="graph.missing",
            path="/workflow/graph",
            kind=DslKind.APP,
        )
    return _build_graph_plan(
        kind=DslKind.APP,
        graph_config=graph,
        dependencies=dependencies,
        runtime_variables=_extract_app_runtime_variables(workflow),
    )


def _unsupported_plan(
    *,
    kind: DslKind,
    reason: str,
    dependencies: list[DslDependency] | None = None,
) -> DslImportPlan:
    return DslImportPlan(
        document=DslDocument(kind=kind, graph_config=None),
        load_status=LoadStatus.UNSUPPORTED,
        dependencies=dependencies or [],
        load_reason=reason,
    )


def _build_graph_plan(
    *,
    kind: DslKind,
    graph_config: Mapping[str, Any],
    dependencies: list[DslDependency],
    runtime_variables: DslRuntimeVariables | None = None,
) -> DslImportPlan:
    normalized_graph = _normalize_graph_config(graph_config, kind=kind)
    node_types = _node_types(normalized_graph)
    unsupported = sorted(
        node_type
        for node_type in node_types
        if node_type not in SUPPORTED_DEFAULT_FACTORY_NODE_TYPES
    )
    unsupported_node_reasons = _unsupported_node_reasons(normalized_graph)
    load_reasons: list[str] = []
    if unsupported:
        load_reasons.append(f"Unsupported node types: {', '.join(unsupported)}")
    load_reasons.extend(unsupported_node_reasons)

    return DslImportPlan(
        document=DslDocument(
            kind=kind,
            graph_config=normalized_graph,
            runtime_variables=runtime_variables or DslRuntimeVariables(),
        ),
        load_status=LoadStatus.UNSUPPORTED if load_reasons else LoadStatus.LOADABLE,
        dependencies=dependencies,
        load_reason="; ".join(load_reasons) or None,
    )


def _extract_graphon_graph(payload: Mapping[str, Any]) -> Mapping[str, Any]:
    graph_config = payload.get(_DslKey.GRAPH_CONFIG)
    if isinstance(graph_config, Mapping):
        return graph_config
    graph = payload.get(_DslKey.GRAPH)
    if isinstance(graph, Mapping):
        return graph
    workflow = payload.get(_DslKey.WORKFLOW)
    if isinstance(workflow, Mapping) and isinstance(
        workflow.get(_DslKey.GRAPH), Mapping
    ):
        return workflow[_DslKey.GRAPH]
    msg = "Graphon workflow DSL must contain graph_config or graph."
    raise _dsl_error(
        msg,
        code="graph.missing",
        kind=DslKind.GRAPH,
    )


def _normalize_graph_config(
    graph_config: Mapping[str, Any],
    *,
    kind: DslKind,
) -> dict[str, Any]:
    nodes = _normalize_nodes(graph_config.get("nodes"), kind=kind)
    edges = _normalize_edges(
        graph_config.get("edges"),
        nodes=nodes,
        kind=kind,
    )
    normalized = deepcopy(dict(graph_config))
    normalized["nodes"] = nodes
    normalized["edges"] = edges
    return normalized


def _extract_app_runtime_variables(
    workflow: Mapping[str, Any],
) -> DslRuntimeVariables:
    return DslRuntimeVariables(
        environment_variables=_normalize_runtime_variables(
            workflow.get("environment_variables"),
            path="/workflow/environment_variables",
        ),
        conversation_variables=_normalize_runtime_variables(
            workflow.get("conversation_variables"),
            path="/workflow/conversation_variables",
        ),
    )


def _normalize_runtime_variables(
    raw_variables: object,
    *,
    path: str,
) -> list[DslRuntimeVariable]:
    if raw_variables is None:
        return []
    if not isinstance(raw_variables, list):
        msg = "Runtime variables must be a list."
        raise _dsl_error(
            msg,
            code="runtime_variables.invalid",
            path=path,
            kind=DslKind.APP,
            details={"actual_type": type(raw_variables).__name__},
        )

    variables: list[DslRuntimeVariable] = []
    for index, raw_variable in enumerate(raw_variables):
        variable_path = f"{path}/{index}"
        if not isinstance(raw_variable, Mapping):
            msg = "Runtime variable must be a mapping."
            raise _dsl_error(
                msg,
                code="runtime_variables.invalid_item",
                path=variable_path,
                kind=DslKind.APP,
                details={"actual_type": type(raw_variable).__name__},
            )
        variable = cast(Mapping[str, Any], raw_variable)
        name = variable.get("name")
        if not isinstance(name, str) or not name:
            msg = "Runtime variable name must be a non-empty string."
            raise _dsl_error(
                msg,
                code="runtime_variables.invalid_name",
                path=f"{variable_path}/name",
                kind=DslKind.APP,
                details={"actual_type": type(name).__name__},
            )
        variables.append(
            DslRuntimeVariable(
                name=name,
                value=variable.get("value"),
                source=dict(variable),
            )
        )
    return variables


def _unsupported_node_reasons(graph_config: Mapping[str, Any]) -> list[str]:
    reasons: list[str] = []
    for node in graph_config.get("nodes", []):
        if not isinstance(node, Mapping) or not isinstance(node.get("data"), Mapping):
            continue
        data = cast(Mapping[str, Any], node["data"])
        if data.get("type") != BuiltinNodeTypes.HTTP_REQUEST:
            continue
        reason = _unsupported_http_request_reason(data)
        if reason is None:
            continue
        node_id = node.get("id")
        prefix = (
            f"HTTP request node {node_id!r}"
            if isinstance(node_id, str)
            else "HTTP request node"
        )
        reasons.append(f"{prefix} is unsupported: {reason}")
    return reasons


def _unsupported_http_request_reason(data: Mapping[str, Any]) -> str | None:
    body = data.get("body")
    if not isinstance(body, Mapping):
        return None
    body_type = body.get("type")
    if body_type == "binary":
        return "binary request bodies require file download support"
    if body_type != "form-data":
        return None
    body_data = body.get("data") or []
    if not isinstance(body_data, Sequence) or isinstance(body_data, str):
        return None
    for item in body_data:
        if isinstance(item, Mapping) and item.get("type") == "file":
            return "multipart file fields require file download support"
    return None


def _normalize_nodes(nodes: object, *, kind: DslKind) -> list[dict[str, Any]]:
    if not isinstance(nodes, list):
        msg = "Graph nodes must be a list."
        raise _dsl_error(
            msg,
            code="graph.invalid_nodes",
            path="/workflow/graph/nodes",
            kind=kind,
        )

    seen: set[str] = set()
    normalized_nodes: list[dict[str, Any]] = []
    for index, node in enumerate(nodes):
        path = f"/workflow/graph/nodes/{index}"
        if not isinstance(node, Mapping):
            msg = "Graph node must be a mapping."
            raise _dsl_error(
                msg,
                code="graph.invalid_node",
                path=path,
                kind=kind,
            )
        node_mapping = cast(Mapping[str, Any], node)
        if node_mapping.get("type") == "custom-note":
            continue
        node_id = node_mapping.get("id")
        if not isinstance(node_id, str) or not node_id:
            msg = "Graph node id must be a non-empty string."
            raise _dsl_error(
                msg,
                code="graph.invalid_node_id",
                path=f"{path}/id",
                kind=kind,
            )
        if node_id in seen:
            msg = f"Duplicate graph node id: {node_id}"
            raise _dsl_error(
                msg,
                code="graph.duplicate_node_id",
                path=f"{path}/id",
                kind=kind,
                details={"node_id": node_id},
            )
        seen.add(node_id)
        data = node_mapping.get("data")
        if not isinstance(data, Mapping):
            msg = "Graph node data must be a mapping."
            raise _dsl_error(
                msg,
                code="graph.invalid_node_data",
                path=f"{path}/data",
                kind=kind,
            )
        node_type = data.get("type")
        if not isinstance(node_type, str) or not node_type:
            msg = "Graph node data.type must be a non-empty string."
            raise _dsl_error(
                msg,
                code="graph.invalid_node_type",
                path=f"{path}/data/type",
                kind=kind,
            )
        normalized_node = deepcopy(dict(node_mapping))
        normalized_node["data"] = dict(data)
        _normalize_node_data(normalized_node["data"])
        normalized_nodes.append(normalized_node)
    return normalized_nodes


def _normalize_node_data(data: dict[str, Any]) -> None:
    if data.get("type") in {
        BuiltinNodeTypes.LLM,
        BuiltinNodeTypes.QUESTION_CLASSIFIER,
        BuiltinNodeTypes.PARAMETER_EXTRACTOR,
    }:
        model = data.get("model")
        if isinstance(model, Mapping):
            normalized_model = dict(model)
            provider = normalized_model.get("provider")
            if isinstance(provider, str) and provider:
                normalized_model["provider"] = _canonical_vendor(provider)
            data["model"] = normalized_model


def _canonical_vendor(provider: str | None) -> str | None:
    if not provider:
        return None
    parts = [part for part in provider.split("/") if part]
    return parts[-1] if parts else provider


def _node_owner_for_edge_validation(
    node: Mapping[str, Any],
    *,
    nodes_by_id: Mapping[str, Mapping[str, Any]],
) -> str | None:
    """Resolve a node's direct graph owner for scoped edge-ID validation.

    The graph scoping resolver owns canonical and legacy hierarchy semantics.
    Invalid or genuinely ambiguous ownership returns ``None`` here so edge-ID
    normalization does not mask the more actionable error raised by Graph.

    Returns:
        The direct container ID, ``""`` for the root graph, or ``None`` when
        ownership cannot be resolved safely.
    """
    try:
        return resolve_container_id(node, nodes_by_id=nodes_by_id)
    except (TypeError, ValueError):
        return None


def _normalize_edges(  # ruff:ignore[complex-structure]
    edges: object,
    *,
    nodes: Sequence[Mapping[str, Any]],
    kind: DslKind,
) -> list[dict[str, Any]]:
    if edges is None:
        return []
    if not isinstance(edges, list):
        msg = "Graph edges must be a list."
        raise _dsl_error(
            msg,
            code="graph.invalid_edges",
            path="/workflow/graph/edges",
            kind=kind,
        )

    node_types = {
        str(node["id"]): str(node["data"]["type"])
        for node in nodes
        if isinstance(node.get("data"), Mapping)
    }
    nodes_by_id = {str(node["id"]): node for node in nodes}
    node_owners = {
        node_id: _node_owner_for_edge_validation(
            node,
            nodes_by_id=nodes_by_id,
        )
        for node_id, node in nodes_by_id.items()
    }
    normalized_edges: list[dict[str, Any]] = []
    seen_edge_ids: set[tuple[str, str]] = set()
    for index, edge in enumerate(edges):
        path = f"/workflow/graph/edges/{index}"
        if not isinstance(edge, Mapping):
            msg = "Graph edge must be a mapping."
            raise _dsl_error(
                msg,
                code="graph.invalid_edge",
                path=path,
                kind=kind,
            )
        edge_mapping = cast(Mapping[str, Any], edge)
        source = edge_mapping.get("source")
        target = edge_mapping.get("target")
        if not isinstance(source, str) or not isinstance(target, str):
            msg = "Graph edge source and target must be strings."
            raise _dsl_error(
                msg,
                code="graph.invalid_edge_endpoint",
                path=path,
                kind=kind,
            )
        if source not in node_types or target not in node_types:
            msg = "Graph edge references an unknown node."
            raise _dsl_error(
                msg,
                code="graph.edge_unknown_node",
                path=path,
                kind=kind,
                details={"source": source, "target": target},
            )
        if "id" in edge_mapping:
            edge_id = edge_mapping["id"]
            if not isinstance(edge_id, str) or not edge_id:
                msg = "Graph edge id must be a non-empty string."
                raise _dsl_error(
                    msg,
                    code="graph.invalid_edge_id",
                    path=f"{path}/id",
                    kind=kind,
                )
            source_owner = node_owners[source]
            if source_owner is not None and source_owner == node_owners[target]:
                scoped_edge_id = (source_owner, edge_id)
                if scoped_edge_id in seen_edge_ids:
                    msg = f"Duplicate graph edge id: {edge_id}"
                    raise _dsl_error(
                        msg,
                        code="graph.duplicate_edge_id",
                        path=f"{path}/id",
                        kind=kind,
                        details={"edge_id": edge_id},
                    )
                seen_edge_ids.add(scoped_edge_id)

        normalized_edge = deepcopy(dict(edge_mapping))
        data = dict(normalized_edge.get("data") or {})
        data.setdefault("sourceType", node_types[source])
        data.setdefault("targetType", node_types[target])
        normalized_edge["data"] = data
        normalized_edges.append(normalized_edge)
    return normalized_edges


def _node_types(graph_config: Mapping[str, Any]) -> set[str]:
    node_types: set[str] = set()
    for node in graph_config.get("nodes", []):
        if isinstance(node, Mapping) and isinstance(node.get("data"), Mapping):
            node_type = node["data"].get("type")
            if isinstance(node_type, str):
                node_types.add(node_type)
    return node_types


def _extract_dependencies(payload: Mapping[str, Any]) -> list[DslDependency]:
    dependencies: list[DslDependency] = []
    raw_dependencies = payload.get("dependencies") or []
    if not isinstance(raw_dependencies, list):
        return dependencies
    for raw_dependency in raw_dependencies:
        if not isinstance(raw_dependency, Mapping):
            continue
        dependency_type = raw_dependency.get("type")
        value = raw_dependency.get("value")
        value_mapping = value if isinstance(value, Mapping) else {}
        dependencies.append(
            _dependency_from_mapping(
                raw_dependency=raw_dependency,
                dependency_type=dependency_type,
                value_mapping=value_mapping,
            ),
        )
    return dependencies


def _dependency_from_mapping(
    *,
    raw_dependency: Mapping[str, Any],
    dependency_type: object,
    value_mapping: Mapping[Any, Any],
) -> DslDependency:
    source = dict(raw_dependency)
    match dependency_type:
        case "github":
            plugin_unique_identifier = value_mapping.get(
                "github_plugin_unique_identifier",
            )
            repo = value_mapping.get("repo")
            package = value_mapping.get("package")
            return DslDependency(
                type=PluginDependencyType.GITHUB,
                plugin_unique_identifier=plugin_unique_identifier
                if isinstance(plugin_unique_identifier, str)
                else None,
                repo=repo if isinstance(repo, str) else None,
                package=package if isinstance(package, str) else None,
                source=source,
            )
        case "marketplace":
            plugin_unique_identifier = value_mapping.get(
                "marketplace_plugin_unique_identifier",
            )
            return DslDependency(
                type=PluginDependencyType.MARKETPLACE,
                plugin_unique_identifier=plugin_unique_identifier
                if isinstance(plugin_unique_identifier, str)
                else None,
                source=source,
            )
        case _:
            plugin_unique_identifier = value_mapping.get("plugin_unique_identifier")
            package = value_mapping.get("package")
            return DslDependency(
                type=PluginDependencyType.PACKAGE,
                plugin_unique_identifier=plugin_unique_identifier
                if isinstance(plugin_unique_identifier, str)
                else None,
                package=package if isinstance(package, str) else None,
                source=source,
            )


def _root_node_candidates(graph_config: Mapping[str, Any]) -> list[str]:
    return [
        str(node["id"])
        for node in graph_config.get("nodes", [])
        if isinstance(node, Mapping)
        and isinstance(node.get("data"), Mapping)
        and node["data"].get("type") == BuiltinNodeTypes.START
    ]


def _select_root_node_id(graph_config: Mapping[str, Any]) -> str:
    candidates = _root_node_candidates(graph_config)
    if len(candidates) != 1:
        msg = (
            "DSL graph must contain exactly one start node unless root_node_id is set."
        )
        raise _dsl_error(
            msg,
            code="graph.root_ambiguous",
            details={"root_node_candidates": candidates},
        )
    return candidates[0]


def _build_variable_pool(
    *,
    runtime_variables: DslRuntimeVariables,
    root_node_id: str,
    run_context: Mapping[str, Any],
    start_inputs: Mapping[str, Any],
) -> VariablePool:
    variable_pool = VariablePool()
    _add_runtime_variables(variable_pool, runtime_variables=runtime_variables)
    for key, value in run_context.items():
        if isinstance(value, str | int | float | bool) or value is None:
            variable_pool.add(("sys", str(key)), value)
    for key, value in start_inputs.items():
        # `loads()` keeps one simple input mapping while Dify separates start
        # node inputs from advanced-chat system variables like sys.query.
        variable_pool.add((root_node_id, str(key)), value)
        variable_pool.add(("sys", str(key)), value)
    return variable_pool


def _add_runtime_variables(
    variable_pool: VariablePool,
    *,
    runtime_variables: DslRuntimeVariables,
) -> None:
    for namespace, variables in (
        ("env", runtime_variables.environment_variables),
        ("conversation", runtime_variables.conversation_variables),
    ):
        for variable in variables:
            variable_pool.add((namespace, variable.name), variable.value)
