"""Typed records for real PostgreSQL native-owner test compositions."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from dify_agent.protocol.execution_binding import (
        CreateExecutionBindingRequest,
        CreateExecutionBindingResponse,
        DestroyExecutionBindingRequest,
    )
    from flask import Flask
    from httpx import Request
    from shellctl.shared.schemas import NativeScopeSpec
    from sqlalchemy.orm import Session, sessionmaker

    from core.dify_builder.models import Actor
    from runtime_contracts.builder.native.agent_contracts import AgentParentNodeRef, AgentTestWorkspaceRef
    from runtime_contracts.builder.native.contracts import NativeTestContextRef
    from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext
    from services.dify_builder.native_testing.agent_workspace import AgentTestWorkspaceService
    from services.dify_builder.native_testing.api_service import NativeTestApiService
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService
    from services.dify_builder.native_testing.http_adapter import PreparedHttpBinding
    from services.dify_builder.native_testing.http_binding import NativeHttpBindingProducer
    from services.dify_builder.native_testing.lifecycle import NativePendingResolutionPort, NativeTestLifecycleService
    from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
    from services.dify_builder.native_testing.pending_intents import PendingDecisionGuard
    from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
    from services.dify_builder.native_testing.runtime import DifyNativeRuntimeOwner
    from services.dify_builder.native_testing.runtime_bridge import NativeNodePreparation
    from services.dify_builder.native_testing.sandbox.repository import NativeCodePhysicalRepository
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
    from tests.test_containers_integration_tests.core.workflow.test_builder_native_code_physical_state import (
        CurrentAcquisition,
    )
    from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import LedgerCase


@dataclass
class PhysicalCodeCase:
    case: LedgerCase
    repo: NativeCodePhysicalRepository
    current: CurrentAcquisition
    args: dict[str, object]


@dataclass(frozen=True)
class CodeDispatchIdentity:
    """Identity consumed by the physical repository's CodeIdentity protocol."""

    operation_ref: str
    scope_id: str
    generation: int


@dataclass
class ObservationHistoryCase:
    factory: sessionmaker[Session]
    actor: Actor
    store: NativeExecutionStateStore
    ref: NativeTestContextRef
    shape: str


@dataclass
class HttpBindingCase:
    ref: NativeTestContextRef
    loader: OwnedNativeTestLoader
    store: NativeExecutionStateStore
    context: ResolvedNativeTestContext
    factory: sessionmaker[Session]
    actor: Actor
    auth: EffectAuthorizationService
    descriptor: dict[str, object]


@dataclass
class PreparedHttpCase:
    producer: NativeHttpBindingProducer
    binding: PreparedHttpBinding
    journal: NodeOperationJournal
    association: NativeNodePreparation


@dataclass
class HttpConsentCase:
    pending_id: str
    scope: str
    guard: PendingDecisionGuard
    command: dict[str, object]
    grant_id: str


@dataclass
class CapacityOwnerCase:
    factory: sessionmaker[Session]
    ledger: LedgerCase
    ref: NativeTestContextRef
    store: NativeExecutionStateStore
    context: ResolvedNativeTestContext
    resolution: NativePendingResolutionPort
    lifecycle: NativeTestLifecycleService


@dataclass
class ChildApprovalCase:
    ref: NativeTestContextRef
    store: NativeExecutionStateStore
    factory: sessionmaker[Session]
    context: ResolvedNativeTestContext
    lifecycle: NativeTestLifecycleService
    ledger: LedgerCase


@dataclass
class RuntimeDeliveryCase:
    factory: sessionmaker[Session]
    actor: Actor
    app: Flask
    session_id: str
    api: NativeTestApiService
    owner: DifyNativeRuntimeOwner
    published: list[dict[str, object]]
    sends: list[Request]
    request_id: str
    kind: str


@dataclass(frozen=True)
class ApprovalLedgerSnapshot:
    quota: tuple[int, int, int]
    budget: dict[str, int]
    grants: list[tuple[int, int, int, int]]
    attempts: int
    claims: int


@dataclass
class AgentAssociationCase:
    factory: sessionmaker[Session]
    loader: OwnedNativeTestLoader
    store: NativeExecutionStateStore
    ref: NativeTestContextRef
    context: ResolvedNativeTestContext
    workspace: AgentTestWorkspaceRef
    parent: AgentParentNodeRef
    allocation_calls: list[str]


@dataclass
class NormalAgentParent:
    ref: NativeTestContextRef
    context: ResolvedNativeTestContext
    parent: AgentParentNodeRef


class WorkspaceBackendWitness(Protocol):
    lose_ack: bool
    fail_before_create: bool
    cleanup_failure: bool
    after_create: Callable[[], None] | None

    def create_execution_binding_sync(
        self, request: CreateExecutionBindingRequest
    ) -> CreateExecutionBindingResponse: ...

    def destroy_execution_binding_sync(self, request: DestroyExecutionBindingRequest) -> None: ...


@dataclass
class AgentWorkspaceCase:
    ledger: LedgerCase
    service: AgentTestWorkspaceService
    ref: NativeTestContextRef
    snapshot_id: str
    backend: WorkspaceBackendWitness
    requests: list[CreateExecutionBindingRequest]
    scripts: list[str]
    scopes: dict[str, NativeScopeSpec]
    cleanups: list[DestroyExecutionBindingRequest]
    context: ResolvedNativeTestContext
