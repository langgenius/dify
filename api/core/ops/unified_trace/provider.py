"""Unified trace runtime and provider adapter contract."""

from collections.abc import Callable
from typing import Protocol, override

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.entities.trace_entity import BaseTraceInfo
from core.ops.unified_trace.entities import CanonicalTrace
from core.ops.unified_trace.parent_context import (
    ParentContextCoordinator,
    ParentResolution,
    ProviderParentContext,
)
from core.ops.unified_trace.trace_builder import CanonicalTraceBuilder

ParentContextPublisher = Callable[[str, ProviderParentContext], None]


class UnifiedTraceAdapter(Protocol):
    @property
    def provider_name(self) -> str:
        raise NotImplementedError

    @property
    def scope(self) -> str:
        raise NotImplementedError

    def emit(
        self,
        trace: CanonicalTrace,
        parent: ParentResolution | None,
        publish_parent_context: ParentContextPublisher,
    ) -> None:
        raise NotImplementedError


class UnifiedTraceInstance(BaseTraceInstance):
    """Build, coordinate, and emit a trace without a legacy fallback path."""

    def __init__(
        self,
        trace_config: BaseTracingConfig,
        *,
        builder: CanonicalTraceBuilder,
        adapter: UnifiedTraceAdapter,
        coordinator: ParentContextCoordinator,
    ) -> None:
        super().__init__(trace_config)
        self._builder = builder
        self._adapter = adapter
        self._coordinator = coordinator

    @override
    def trace(self, trace_info: BaseTraceInfo) -> None:
        canonical_trace = self._builder.build(trace_info)
        if canonical_trace is None:
            return

        parent_resolution = None
        if canonical_trace.external_parent is not None:
            parent_resolution = self._coordinator.resolve(
                canonical_trace.external_parent,
                expected_provider=self._adapter.provider_name,
                expected_scope=self._adapter.scope,
            )
        elif canonical_trace.required_parent_context_id is not None:
            parent_resolution = self._coordinator.resolve_required(
                canonical_trace.required_parent_context_id,
                expected_provider=self._adapter.provider_name,
                expected_scope=self._adapter.scope,
            )

        self._adapter.emit(canonical_trace, parent_resolution, self._coordinator.publish)
