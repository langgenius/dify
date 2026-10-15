"""Per-occurrence native collaborators, with no process-wide policy replacement.

NW3 supplies durable occurrence identity and NW4/5/6 supply qualified argument
adapters. The bridge never creates ordinary collaborators as substitutes.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from services.dify_builder.native_testing.context_binding import NativeContextUnavailable, resolve_native_context
from services.dify_builder.native_testing.contracts import NativeTestContextRef, OperationKey
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
    def __call__(
        self, *, context: ResolvedNativeTestContext, occurrence_path: tuple[str, ...], runtime_state: Any
    ) -> NativeCollaborators: ...


class NativeOccurrenceResolver(Protocol):
    def __call__(self, *, ref: NativeTestContextRef, node_id: str, runtime_state: Any) -> tuple[str, ...]: ...


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
        occurrences: NativeOccurrenceResolver,
        node_arguments: NativeNodeArguments,
        prepare_inputs: Callable[[ResolvedNativeTestContext], NativePreparedInputs] | None = None,
    ):
        self.state = state
        self._prepare_inputs = prepare_inputs
        self._collaborators = collaborators
        self._occurrences = occurrences
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

    def for_node(
        self, *, ref: NativeTestContextRef, occurrence_path: tuple[str, ...], runtime_state: Any
    ) -> NativeCollaborators:
        try:
            OperationKey(invocation_id=ref.invocation_id, occurrence_path=occurrence_path, cursor=0)
        except ValueError:
            raise NativeContextUnavailable("native_occurrence_missing") from None
        context = self.resolve(ref)
        bundle = self._collaborators(context=context, occurrence_path=occurrence_path, runtime_state=runtime_state)
        if not isinstance(bundle, NativeCollaborators) or any(
            getattr(bundle, field) is None for field in NativeCollaborators.__dataclass_fields__
        ):
            raise NativeContextUnavailable("native_collaborator_unavailable")
        return bundle

    def arguments(
        self, *, ref: NativeTestContextRef, node_id: str, node_data: Any, node_class: type, runtime_state: Any
    ) -> Mapping[str, Any]:
        occurrence = self._occurrences(ref=ref, node_id=node_id, runtime_state=runtime_state)
        bundle = self.for_node(ref=ref, occurrence_path=occurrence, runtime_state=runtime_state)
        return self._node_arguments(node_id=node_id, node_data=node_data, node_class=node_class, collaborators=bundle)


@dataclass(frozen=True, slots=True)
class NativePreparedInputs:
    """Native typed/file/environment values from guarded input preparation."""

    inputs: Mapping[str, Any]
    files: tuple[Any, ...]
    environment_variables: tuple[Any, ...]
