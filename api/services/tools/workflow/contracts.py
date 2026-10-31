"""Structural capabilities used by tool invocation and provider adapters."""

from typing import Protocol, runtime_checkable


@runtime_checkable
class NestedWorkflowTool(Protocol):
    workflow_call_depth: int


@runtime_checkable
class StoredToolProvider(Protocol):
    provider_id: str
