"""Per-occurrence native collaborators, with no process-wide policy replacement.

NW3 supplies durable occurrence identity and NW4/5/6 supply qualified argument
adapters. The bridge never creates ordinary collaborators as substitutes.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Protocol
from uuid import UUID

from graphon.nodes.base.node import Node
from services.dify_builder.native_testing.context_binding import NativeContextUnavailable, resolve_native_context
from services.dify_builder.native_testing.contracts import NativeTestContextRef
from services.dify_builder.native_testing.control import BoundaryOwnerState, NativeControlSink, marked_native_node_class
from services.dify_builder.native_testing.runtime_contracts import NativeStatePort, ResolvedNativeTestContext


@dataclass(frozen=True, slots=True)
class NativeCollaborators:
    """Explicit capability owners; all slots must be supplied by trusted composition."""

    http: object
    model: object
    tool: object
    retrieval: object
    file: object
    code: object
    jinja: object
    agent: object
    human_input: object
    data_source: object


class NativeCollaboratorFactory(Protocol):
    """Select deferred adapters only; do not resolve context or perform I/O here.

    Each adapter must enter through association.resolve() before protected
    preparation/effects and use its bound public execution_id/occurrence_path.
    An adapter must never retain an ordinary collaborator as a fallback.
    """

    def __call__(self, *, association: NativeNodePreparation) -> NativeCollaborators: ...


class NativeNodeArguments(Protocol):
    """Qualified adapters select constructor parameters for the actual native class.

    Must explicitly account for every effect owner of that class. Unsupported
    implementations raise a capability reason before constructing the node.
    """

    def __call__(
        self, *, node_id: str, node_data: Any, node_class: type, collaborators: NativeCollaborators
    ) -> Mapping[str, Any]: ...


class NativeRuntimeBridge:
    def __init__(
        self,
        *,
        state: NativeStatePort,
        collaborators: NativeCollaboratorFactory,
        boundary_owner: BoundaryOwnerState,
        control_sink: NativeControlSink,
        node_arguments: NativeNodeArguments,
        prepare_inputs: Callable[[ResolvedNativeTestContext], NativePreparedInputs] | None = None,
    ):
        if type(boundary_owner) is not BoundaryOwnerState or not callable(
            getattr(control_sink, "record_control", None)
        ):
            raise NativeContextUnavailable("native_control_unavailable")
        self._boundary_owner = boundary_owner
        self._control_sink = control_sink
        self.state = state
        self._prepare_inputs = prepare_inputs
        self._collaborators = collaborators
        self._node_arguments = node_arguments

    def prepare_inputs(self, context: ResolvedNativeTestContext) -> NativePreparedInputs:
        """Reconstruct guarded values after each boundary; the owner must be idempotent.

        This is called by the generator, worker and runner. Any external
        preparation must share its durable operation/result identity across
        those calls and must not materialize ordinary credentials as fallback.
        """
        if self._prepare_inputs is None:
            raise NativeContextUnavailable("native_input_adapter_unavailable")
        return self._prepare_inputs(context)

    def resolve(self, ref: NativeTestContextRef) -> ResolvedNativeTestContext:
        context = resolve_native_context(required=True, ref=ref, state=self.state)
        assert context is not None
        return context

    def prepare_node(
        self, *, ref: NativeTestContextRef, node_id: str, node_data: Any, node_class: type[Node], runtime_state: Any
    ) -> NativeNodePreparation:
        """Select explicit deferred collaborators before native public ID binding.

        This path reads no protected context, input, journal or binding state.
        Factory attaches the exact constructed instance once before returning it.
        Trusted adapters must defer every protected operation to effect entry.
        """
        if type(ref) is not NativeTestContextRef or ref != self._boundary_owner.ref:
            raise NativeContextUnavailable("native_context_mismatch")
        prepared = NativeNodePreparation(
            bridge=self,
            ref=ref,
            node_id=node_id,
            node_class=marked_native_node_class(node_class, marked=True),
            runtime_state=runtime_state,
        )
        bundle = self._collaborators(association=prepared)
        if not isinstance(bundle, NativeCollaborators) or any(
            getattr(bundle, field) is None for field in NativeCollaborators.__dataclass_fields__
        ):
            raise NativeContextUnavailable("native_collaborator_unavailable")
        arguments = dict(
            self._node_arguments(
                node_id=node_id,
                node_data=node_data,
                node_class=node_class,
                collaborators=bundle,
            )
        )
        if {
            "node_id",
            "data",
            "graph_init_params",
            "graph_runtime_state",
            "native_control_owner",
            "native_control_sink",
        }.intersection(arguments):
            raise NativeContextUnavailable("native_node_arguments_invalid")
        prepared._arguments = MappingProxyType(
            {
                **arguments,
                "native_control_owner": self._boundary_owner,
                "native_control_sink": self._control_sink,
            }
        )
        return prepared


class NativeNodePreparation:
    """Single native instance association; neither a binding nor dispatch authority.

    The public Graphon ID identifies this occurrence across native retry/restore.
    It is never minted from graph/config/input/counters. Invocation ownership
    remains the ref.invocation_id in each adapter's OperationKey. No nested
    lineage is inferred. A strong node reference avoids a shared current-node
    slot and keeps independent instances/child runtime clones separate.
    """

    def __init__(
        self,
        *,
        bridge: NativeRuntimeBridge,
        ref: NativeTestContextRef,
        node_id: str,
        node_class: type[Node],
        runtime_state: Any,
    ) -> None:
        self._bridge = bridge
        self._ref = ref
        self._node_id = node_id
        self._node_class = node_class
        self._arguments: Mapping[str, Any] = MappingProxyType({})
        self._runtime_state = runtime_state
        self._node: Node | None = None
        self._execution_id: str | None = None

    @property
    def ref(self) -> NativeTestContextRef:
        return self._ref

    @property
    def node_id(self) -> str:
        return self._node_id

    @property
    def node_class(self) -> type[Node]:
        return self._node_class

    @property
    def arguments(self) -> Mapping[str, Any]:
        return self._arguments

    def _validate_node(self, node: Node) -> None:
        if (
            type(node) is not self.node_class
            or node.id != self.node_id
            or node.graph_runtime_state is not self._runtime_state
            # These are Dify control-mixin fields, never Graphon worker/frame internals.
            or getattr(node, "_native_control_owner", None) is not self._bridge._boundary_owner
            or getattr(node, "_native_control_sink", None) is not self._bridge._control_sink
        ):
            raise NativeContextUnavailable("native_node_mismatch")
        if self.ref != self._bridge._boundary_owner.ref:
            raise NativeContextUnavailable("native_context_mismatch")

    def attach(self, node: Node) -> None:
        """Attach once after construction, while public execution_id is unbound."""
        if self._node is not None:
            raise NativeContextUnavailable("native_node_already_attached")
        self._validate_node(node)
        self._node = node

    @property
    def execution_id(self) -> str:
        node = self._node
        if node is None:
            raise NativeContextUnavailable("native_node_unattached")
        self._validate_node(node)
        try:
            execution_id = node.execution_id
        except RuntimeError:
            raise NativeContextUnavailable("native_execution_id_missing") from None
        try:
            if type(execution_id) is not str or str(UUID(execution_id)) != execution_id:
                raise ValueError
        except (ValueError, TypeError, AttributeError):
            raise NativeContextUnavailable("native_execution_id_invalid") from None
        if self._execution_id is not None and execution_id != self._execution_id:
            raise NativeContextUnavailable("native_execution_id_mismatch")
        self._execution_id = execution_id
        return execution_id

    @property
    def bound_node(self) -> Node:
        """Exact bound instance, without storage access or policy authority.

        Public node_data/runtime remain native mutable objects. Concrete effect
        owners must still compare their pinned config and prepared material.
        """
        _ = self.execution_id
        assert self._node is not None
        return self._node

    @property
    def occurrence_path(self) -> tuple[str, ...]:
        return (self.execution_id,)

    @property
    def runtime_state(self) -> Any:
        _ = self.execution_id
        return self._runtime_state

    def resolve(self) -> ResolvedNativeTestContext:
        """Revalidate the full private context at every actual effect boundary."""
        _ = self.execution_id
        context = self._bridge.resolve(self.ref)
        _ = self.execution_id
        return context


@dataclass(frozen=True, slots=True)
class NativePreparedInputs:
    """Native typed/file/environment values from guarded input preparation."""

    inputs: Mapping[str, Any]
    files: tuple[Any, ...]
    environment_variables: tuple[Any, ...]
