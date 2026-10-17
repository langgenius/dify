"""Pure diagnostic views of the qualified native HTTP or Code profile graph.

Structural qualification is not admission, authorization, binding provenance or
proof of dispatch. The trusted host must reload the protected request/ref/profile,
features and current Workflow revision. This component never changes operational
events, runtime outputs, variable pools, filters, journals or checkpoint data.
Every observer must request its own projection before any serialization/offload.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from typing import Any, Literal, NoReturn, Self, cast, overload

from graphon.entities.pause_reason import SchedulingPause
from graphon.entities.workflow_start_reason import WorkflowStartReason
from graphon.enums import WorkflowNodeExecutionMetadataKey as Metadata
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.graph_engine.layers import ExecutionLimitsLayer, GraphEngineLayer
from graphon.graph_events import (
    GraphEdgeSkippedEvent,
    GraphEdgeTakenEvent,
    GraphEngineEvent,
    GraphNodeEventBase,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunIterationFailedEvent,
    NodeRunIterationNextEvent,
    NodeRunIterationStartedEvent,
    NodeRunIterationSucceededEvent,
    NodeRunLoopFailedEvent,
    NodeRunLoopNextEvent,
    NodeRunLoopStartedEvent,
    NodeRunLoopSucceededEvent,
    NodeRunPauseRequestedEvent,
    NodeRunReasoningChunkEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events.base import NodeRunResult
from graphon.nodes.end.entities import EndNodeData
from graphon.nodes.iteration.entities import IterationNodeData, IterationStartNodeData
from graphon.nodes.loop.entities import LoopEndNodeData, LoopNodeData, LoopStartNodeData
from graphon.nodes.start.entities import StartNodeData
from graphon.variables.input_entities import VariableEntityType
from graphon.variables.segments import ArrayFileSegment
from services.dify_builder.execution_contracts import (
    BuilderExecutionPolicyError,
    canonical_digest,
    canonical_json,
)
from services.dify_builder.native_testing.context_binding import NativeRuntimeProfile
from services.dify_builder.native_testing.contracts import NativeTestContextRef
from services.dify_builder.native_testing.http_binding import (
    describe_http_resource,
    validate_native_http_profile,
)
from services.dify_builder.native_testing.runtime_contracts import (
    ResolvedNativeTestContext,
)

_REDACTED = "[native content redacted]"
_REASON = "native_observation_unsupported"
_ERROR_KINDS = frozenset(
    {
        "HTTPResponseCodeError",
        "HttpRequestNodeError",
        "AuthorizationConfigError",
        "FileFetchError",
        "InvalidHttpMethodError",
        "ResponseSizeError",
        "RequestBodyError",
        "InvalidURLError",
        "native_execution_error",
    }
)
# Schema allowlist only: execution/version/class resolution stays with the real
# native factory. No constructors, replacement registry or executor lives here.
_SCALAR_SCHEMAS = (
    StartNodeData,
    EndNodeData,
    IterationNodeData,
    IterationStartNodeData,
    LoopNodeData,
    LoopStartNodeData,
    LoopEndNodeData,
)
_GRAPH_EVENTS = frozenset(
    {
        GraphRunStartedEvent,
        GraphRunSucceededEvent,
        GraphRunFailedEvent,
        GraphRunPartialSucceededEvent,
        GraphRunAbortedEvent,
        GraphRunPausedEvent,
        GraphEdgeTakenEvent,
        GraphEdgeSkippedEvent,
    }
)
_NODE_EVENTS = frozenset(
    {
        NodeRunStartedEvent,
        NodeRunSucceededEvent,
        NodeRunFailedEvent,
        NodeRunExceptionEvent,
        NodeRunRetryEvent,
        NodeRunStreamChunkEvent,
        NodeRunReasoningChunkEvent,
        NodeRunPauseRequestedEvent,
        NodeRunIterationStartedEvent,
        NodeRunIterationNextEvent,
        NodeRunIterationSucceededEvent,
        NodeRunIterationFailedEvent,
        NodeRunLoopStartedEvent,
        NodeRunLoopNextEvent,
        NodeRunLoopSucceededEvent,
        NodeRunLoopFailedEvent,
    }
)
_ID_FIELDS = frozenset(
    {
        "id",
        "node_id",
        "in_iteration_id",
        "in_loop_id",
        "predecessor_node_id",
        "edge_id",
        "source_node_id",
        "target_node_id",
    }
)
_COUNT_FIELDS = frozenset({"exceptions_count", "retry_index", "index", "steps"})
_CONTENT_FIELDS = frozenset({"inputs", "outputs", "extras"})
_HISTORY = (
    "__dify_retry_history"  # Existing native retry contract, not an authority key.
)


def _refuse() -> NoReturn:
    raise BuilderExecutionPolicyError(_REASON)


@overload
def _identity(value: Any, *, optional: Literal[False] = False) -> str: ...


@overload
def _identity(value: Any, *, optional: bool) -> str | None: ...


def _identity(value: Any, *, optional: bool = False) -> str | None:
    if value is None and optional:
        return None
    if type(value) is not str or not value or len(value) > 512:
        _refuse()
    return value


def _count(value: Any) -> int:
    if type(value) is not int or not 0 <= value <= 2**63 - 1:
        _refuse()
    return value


def _shape(
    value: Any, *, depth: int = 0, budget: list[int] | None = None
) -> dict[str, Any]:
    """Validate bounded plain values without rendering objects or leaking keys.

    All children are checked, even when only eight shapes are displayed. The
    native empty files segment is allowed; file-bearing segments are not.
    """
    if budget is None:
        budget = [100_000]
    budget[0] -= 1
    if depth > 24 or budget[0] < 0:
        _refuse()
    kind = type(value)
    if value is None:
        return {"type": "null"}
    if kind is bool:
        return {"type": "boolean"}
    if kind is int:
        return {"type": "integer"}
    if kind is float:
        if not math.isfinite(value):
            _refuse()
        return {"type": "number"}
    if kind is str:
        return {"type": "string", "length": len(value)}
    if (
        kind is ArrayFileSegment
        and type(value.value) in (list, tuple)
        and not value.value
    ):
        return {"type": "array", "length": 0}
    if kind is dict:
        if not all(type(key) is str for key in value):
            _refuse()
        shapes = [
            _shape(item, depth=depth + 1, budget=budget) for item in value.values()
        ]
        return {
            "type": "object",
            "fields": len(value),
            "values": shapes[:8] if depth < 3 else [],
        }
    if kind in (list, tuple):
        shapes = [_shape(item, depth=depth + 1, budget=budget) for item in value]
        return {
            "type": "array",
            "length": len(value),
            "items": shapes[:8] if depth < 3 else [],
        }
    _refuse()
    raise AssertionError("unreachable")


def _pause(reason: Any) -> SchedulingPause:
    if type(reason) is not SchedulingPause or type(reason.message) is not str:
        _refuse()
    return SchedulingPause(message=_REDACTED)


class NativeHttpObservationPolicy:
    """An immutable-identity structural snapshot, never an execution receipt.

    Instantiate through qualify. No method establishes ownership/currentness or
    describes an unprepared occurrence as dispatched. Optional values preserve
    None for existing diagnostic consumers; all actual content is redacted.
    """

    def __init__(
        self,
        *,
        graph_json: bytes,
        nodes: dict[str, tuple[str, str]],
        edges: tuple[tuple[str | None, str, str], ...],
    ):
        self._graph_json = graph_json
        self._nodes = nodes.copy()
        self._edges = edges

    @classmethod
    def qualify(
        cls,
        *,
        context: ResolvedNativeTestContext,
        profile: NativeRuntimeProfile,
        code_qualification=None,
    ) -> Self:
        """Check actual server profile and descriptor shapes, without protected IO.

        Context has no stored profile/features or serialized Workflow revision
        material. The host must verify them against their real owner first; no
        substitute profile or invented Workflow revision hash is accepted here.
        An admitted scalar graph can have no HTTP resources; the exact empty
        descriptor match still requires every existing node schema and guard.
        """
        try:
            if (
                type(context) is not ResolvedNativeTestContext
                or type(profile) is not NativeRuntimeProfile
            ):
                _refuse()
            if type(context.ref) is not NativeTestContextRef:
                _refuse()
            for model in (context, context.ref, profile):
                if model.model_extra or set(model.__dict__) != set(
                    type(model).model_fields
                ):
                    _refuse()
            # Unchecked frozen DTO copies can contain arbitrary objects. Inspect
            # plain fields before Pydantic serialization can warn with repr(data).
            profile_data = {
                name: getattr(profile, name)
                for name in NativeRuntimeProfile.model_fields
            }
            _shape(profile_data)
            from services.dify_builder.native_testing.sandbox.qualification import (
                PROFILE_ID as CODE_PROFILE_ID,
            )
            from services.dify_builder.native_testing.sandbox.qualification import (
                NativeCodeQualification,
                describe_code_resource,
            )

            code_profile = profile.profile_id == CODE_PROFILE_ID
            if code_profile:
                if type(code_qualification) is not NativeCodeQualification:
                    _refuse()
                code_qualification.validate_profile(
                    NativeRuntimeProfile.model_validate(profile_data)
                )
            else:
                validate_native_http_profile(
                    NativeRuntimeProfile.model_validate(profile_data)
                )
            context_data = {
                name: getattr(context, name)
                for name in ResolvedNativeTestContext.model_fields
            }
            context_data["ref"] = {
                name: getattr(context.ref, name)
                for name in NativeTestContextRef.model_fields
            }
            _shape(context_data)
            checked = ResolvedNativeTestContext.model_validate(context_data)
            if (
                checked.execution_mode != "native"
                or checked.parent_invocation_id is not None
                or checked.call_depth != 0
                or not checked.native_run_id
                or checked.root_native_run_id != checked.native_run_id
                or checked.input_revision != canonical_digest(checked.inputs)
            ):
                _refuse()
            if len(checked.graph_revision) != 64 or any(
                c not in "0123456789abcdef" for c in checked.graph_revision
            ):
                _refuse()
            graph: dict[str, Any] = checked.graph
            if (
                set(graph) - {"nodes", "edges", "viewport"}
                or type(graph.get("nodes")) is not list
                or type(graph.get("edges")) is not list
            ):
                _refuse()
            nodes: dict[str, tuple[str, str]] = {}
            expected = []
            schemas = {
                schema.model_fields["type"].default: schema
                for schema in _SCALAR_SCHEMAS
            }
            for item in graph["nodes"]:
                if type(item) is not dict or type(item.get("data")) is not dict:
                    _refuse()
                node_id = _identity(item.get("id"))
                raw = item["data"]
                kind, version = raw.get("type"), raw.get("version", "1")
                if node_id in nodes or type(kind) is not str or version != "1":
                    _refuse()
                nodes[node_id] = (kind, version)
                if code_profile and kind in {"code", "template-transform"}:
                    expected.append(
                        describe_code_resource(
                            qualification=code_qualification,
                            node_id=node_id,
                            raw=raw,
                            workflow_revision=checked.graph_revision,
                            app_id=checked.app_id,
                            workflow_id=checked.workflow_id,
                        )
                    )
                elif kind == "http-request" and not code_profile:
                    expected.append(
                        describe_http_resource(
                            node_id=node_id,
                            raw=raw,
                            workflow_revision=checked.graph_revision,
                            app_id=checked.app_id,
                            workflow_id=checked.workflow_id,
                        )
                    )
                elif kind in schemas:
                    parsed = schemas[kind].model_validate(raw, strict=True)
                    if isinstance(parsed, StartNodeData) and any(
                        v.type
                        in (VariableEntityType.FILE, VariableEntityType.FILE_LIST)
                        for v in parsed.variables
                    ):
                        _refuse()
                    if isinstance(parsed, EndNodeData) and any(
                        v.value_type in ("secret", "file", "array[file]")
                        for v in parsed.outputs
                    ):
                        _refuse()
                else:
                    _refuse()
            if canonical_json(expected) != canonical_json(
                list(checked.resource_manifest)
            ):
                _refuse()
            if sum(kind == "start" for kind, _ in nodes.values()) != 1:
                _refuse()
            for item in graph["nodes"]:
                raw = item["data"]
                if raw["type"] in ("loop", "iteration"):
                    start = raw.get("start_node_id")
                    if start not in nodes or nodes[start][0] != raw["type"] + "-start":
                        _refuse()
            edges: list[tuple[str | None, str, str]] = []
            edge_ids: set[str] = set()
            for edge in graph["edges"]:
                if (
                    type(edge) is not dict
                    or edge.get("source") not in nodes
                    or edge.get("target") not in nodes
                ):
                    _refuse()
                edge_id = edge.get("id")
                if edge_id is not None:
                    edge_id = _identity(edge_id)
                    if edge_id in edge_ids:
                        _refuse()
                    edge_ids.add(edge_id)
                edges.append((edge_id, edge["source"], edge["target"]))
            return cls(
                graph_json=canonical_json(graph), nodes=nodes, edges=tuple(edges)
            )
        except Exception:
            raise BuilderExecutionPolicyError(_REASON) from None

    @overload
    def values(self, values: None) -> None: ...

    @overload
    def values(self, values: Mapping[str, Any]) -> dict[str, Any]: ...

    def values(self, values: Mapping[str, Any] | None) -> dict[str, Any] | None:
        """Return a fresh explicit marker and bounded typed shape; never raw keys."""
        if values is None:
            return None
        if type(values) is not dict:
            _refuse()
        return {"redacted": True, "shape": _shape(values)}

    @overload
    def error(self, error: None) -> None: ...

    @overload
    def error(self, error: BaseException | str) -> str: ...

    def error(self, error: BaseException | str | None) -> str | None:
        """Exceptions never have str/repr/args inspected, even for known classes."""
        if error is None:
            return None
        if type(error) is str and error in _ERROR_KINDS:
            return error
        if type(error) is str or isinstance(error, BaseException):
            return "native_execution_error"
        _refuse()
        raise AssertionError("unreachable")

    def graph(self, graph: Mapping[str, Any]) -> dict[str, Any]:
        """Project only the pinned graph; expose topology, never node configuration."""
        _shape(graph)
        if canonical_json(graph) != self._graph_json:
            _refuse()
        return {
            "nodes": [
                {
                    "id": node_id,
                    "data": {
                        "type": kind,
                        "version": version,
                        "title": kind,
                        "redacted": True,
                    },
                }
                for node_id, (kind, version) in self._nodes.items()
            ],
            "edges": [
                {
                    **({"id": edge_id} if edge_id is not None else {}),
                    "source": source,
                    "target": target,
                }
                for edge_id, source, target in self._edges
            ],
            "redacted": True,
        }

    def require_layers(self, layers: Sequence[GraphEngineLayer]) -> None:
        """Only exact native operational limits are qualified in this pure phase.

        Dify persistence/control/retirement adapters need their own later joint
        qualification. A subclass, Debug/OTel layer or caller claim is insufficient.
        """
        if type(layers) not in (list, tuple) or any(
            type(layer) is not ExecutionLimitsLayer for layer in layers
        ):
            _refuse()

    def _metadata(
        self, metadata: Any, *, container_lengths: bool = False
    ) -> dict[str, Any]:
        """Keep only native correlation/counters in every diagnostic metadata copy.

        String keys from persisted retry attempts share the existing enum-key
        contract. Only container event metadata has the official length fields.
        """
        if type(metadata) is not dict or any(
            type(key) not in (str, Metadata) for key in metadata
        ):
            _refuse()
        _shape(
            {
                key.value if type(key) is Metadata else key: value
                for key, value in metadata.items()
            }
        )
        result: dict[str, Any] = {}
        for key, value in metadata.items():
            if key in (
                Metadata.TOTAL_TOKENS,
                Metadata.ITERATION_INDEX,
                Metadata.LOOP_INDEX,
            ):
                result[key] = _count(value)
            elif key in (
                Metadata.ITERATION_ID,
                Metadata.LOOP_ID,
                Metadata.PARALLEL_ID,
                Metadata.PARENT_PARALLEL_ID,
                Metadata.PARALLEL_MODE_RUN_ID,
            ):
                result[key] = _identity(value)
            elif container_lengths and key in ("iteration_length", "loop_length"):
                result[key] = _count(value)
        return result

    def _process_data(self, data: Any) -> dict[str, Any]:
        projected = self.values(data)
        if projected is None:
            _refuse()
        if _HISTORY in data:
            history = data[_HISTORY]
            if type(history) is not list:
                _refuse()
            projected[_HISTORY] = []
            for attempt in history:
                fields = {
                    "retry_index",
                    "inputs",
                    "process_data",
                    "outputs",
                    "error",
                    "elapsed_time",
                    "execution_metadata",
                    "created_at",
                    "finished_at",
                }
                if type(attempt) is not dict or set(attempt) != fields:
                    _refuse()
                elapsed = attempt["elapsed_time"]
                if (
                    type(elapsed) not in (float, int)
                    or not math.isfinite(elapsed)
                    or elapsed < 0
                    or _count(attempt["retry_index"]) == 0
                ):
                    _refuse()
                projected[_HISTORY].append(
                    {
                        "retry_index": attempt["retry_index"],
                        "elapsed_time": elapsed,
                        "created_at": _count(attempt["created_at"]),
                        "finished_at": _count(attempt["finished_at"]),
                        "inputs": self.values(attempt["inputs"]),
                        "process_data": self.values(attempt["process_data"]),
                        "outputs": self.values(attempt["outputs"]),
                        "error": self.error(attempt["error"]),
                        "execution_metadata": self._metadata(
                            attempt["execution_metadata"]
                        ),
                    }
                )
        return projected

    def _result(self, result: Any) -> NodeRunResult:
        if type(result) is not NodeRunResult or result.model_extra:
            _refuse()
        if (
            type(result.status) is not WorkflowNodeExecutionStatus
            or type(result.llm_usage) is not LLMUsage
            or result.llm_usage != LLMUsage.empty_usage()
            or any(
                type(item) is not dict
                for item in (result.inputs, result.outputs, result.process_data)
            )
            or any(
                type(item) is not str
                for item in (result.error, result.error_type, result.edge_source_handle)
            )
        ):
            _refuse()
        return NodeRunResult(
            status=result.status,
            inputs=self.values(result.inputs),
            outputs=self.values(result.outputs),
            process_data=self._process_data(result.process_data),
            metadata={
                Metadata(key): value
                for key, value in self._metadata(result.metadata).items()
            },
            error=self.error(result.error) if result.error else "",
            error_type=self.error(result.error_type) if result.error_type else "",
            retry_index=_count(result.retry_index),
            edge_source_handle=result.edge_source_handle
            if result.edge_source_handle in ("source", "fail-branch", "success-branch")
            else _REDACTED,
        )

    def event(self, event: GraphEngineEvent) -> GraphEngineEvent:
        """Construct an independent real native event from explicit safe fields.

        Adapters must call this after operational handling and separately for each
        observer. This method neither emits events nor grants native wait/dispatch.
        """
        cls = type(event)
        if cls not in _GRAPH_EVENTS | _NODE_EVENTS or event.model_extra:
            _refuse()
        if isinstance(event, GraphNodeEventBase):
            node_id = _identity(event.node_id)
            if type(event.node_type) is not str or type(event.node_version) is not str:
                _refuse()
            if node_id not in self._nodes or self._nodes[node_id] != (
                event.node_type,
                event.node_version,
            ):
                _refuse()
            if (
                cls.__name__.startswith("NodeRunIteration")
                and event.node_type != "iteration"
            ):
                _refuse()
            if cls.__name__.startswith("NodeRunLoop") and event.node_type != "loop":
                _refuse()
        if isinstance(event, GraphEdgeTakenEvent | GraphEdgeSkippedEvent):
            _identity(event.edge_id)
            source, target = (
                _identity(event.source_node_id),
                _identity(event.target_node_id),
            )
            if not any(
                (source, target) == (tail, head) for _, tail, head in self._edges
            ):
                _refuse()
        fields: dict[str, Any] = {}
        for name in cls.model_fields:
            value = getattr(event, name)
            if name in _ID_FIELDS:
                fields[name] = _identity(
                    value,
                    optional=name
                    in {"in_iteration_id", "in_loop_id", "predecessor_node_id"},
                )
                if (
                    name == "predecessor_node_id"
                    and value is not None
                    and value not in self._nodes
                ):
                    _refuse()
            elif name in {"node_type", "node_version"}:
                fields[name] = value
            elif name == "node_run_result":
                fields[name] = self._result(value)
            elif name in _COUNT_FIELDS:
                fields[name] = _count(value)
            elif name == "metadata":
                fields[name] = self._metadata(value, container_lengths=True)
            elif name in _CONTENT_FIELDS:
                fields[name] = self.values(value)
            elif name in {"start_at", "finished_at"}:
                if value is None:
                    if name == "start_at":
                        _refuse()
                elif type(value) is not datetime or (
                    value.tzinfo is not None and type(value.tzinfo) is not timezone
                ):
                    _refuse()
                fields[name] = value
            elif name == "node_title":
                if type(value) is not str:
                    _refuse()
                fields[name] = cast(GraphNodeEventBase, event).node_type
            elif name in {"provider_type", "provider_id"}:
                if type(value) is not str:
                    _refuse()
                fields[name] = ""
            elif name == "error":
                if type(value) is not str:
                    _refuse()
                fields[name] = self.error(value)
            elif name == "reason":
                if cls is GraphRunStartedEvent:
                    if type(value) is not WorkflowStartReason:
                        _refuse()
                    fields[name] = value
                elif cls is NodeRunPauseRequestedEvent:
                    fields[name] = _pause(value)
                else:
                    fields[name] = self.error(value)
            elif name == "reasons":
                if type(value) is not list:
                    _refuse()
                fields[name] = [_pause(reason) for reason in value]
            elif name in {"chunk", "pre_iteration_output", "pre_loop_output"}:
                if name == "chunk" and type(value) is not str:
                    _refuse()
                _shape(value)
                fields[name] = _REDACTED
            elif name == "selector":
                _shape(value)
                fields[name] = [cast(GraphNodeEventBase, event).node_id, _REDACTED]
            elif name == "source_handle":
                if value is not None and type(value) is not str:
                    _refuse()
                fields[name] = None if value is None else _REDACTED
            elif name == "is_final":
                if type(value) is not bool:
                    _refuse()
                fields[name] = value
            else:
                _refuse()
        return cls.model_validate(fields)
