"""Typed records for real PostgreSQL native-owner test compositions."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal, Protocol

from pydantic import JsonValue
from typing_extensions import TypedDict

if TYPE_CHECKING:
    from datetime import datetime

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
    from runtime_contracts.builder.native.contracts import (
        DispatchPermit,
        EffectIntent,
        NativeTestContextRef,
        OperationKey,
    )
    from runtime_contracts.builder.native.runtime_contracts import (
        NativeCheckpointPayload,
        NativeWorkflowOutcome,
        ResolvedNativeTestContext,
    )
    from services.dify_builder.native_testing.agent_workspace import AgentTestWorkspaceService
    from services.dify_builder.native_testing.api_service import NativeTestApiService
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService
    from services.dify_builder.native_testing.http_adapter import PreparedHttpBinding
    from services.dify_builder.native_testing.http_binding import NativeHttpBindingProducer
    from services.dify_builder.native_testing.lifecycle import (
        NativePendingResolution,
        NativePendingResolutionPort,
        NativeTestLifecycleService,
    )
    from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
    from services.dify_builder.native_testing.pending_intents import PendingDecisionGuard
    from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
    from services.dify_builder.native_testing.runtime import DifyNativeRuntimeOwner
    from services.dify_builder.native_testing.runtime_bridge import NativeNodePreparation
    from services.dify_builder.native_testing.sandbox.contracts import CodeAcquisitionRef, CodeScopeSpec
    from services.dify_builder.native_testing.sandbox.repository import NativeCodePhysicalRepository
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
    from tests.test_containers_integration_tests.core.workflow.test_builder_native_code_physical_state import (
        CurrentAcquisition,
    )
    from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import LedgerCase


from collections.abc import Callable
from dataclasses import dataclass


class NativeActorMessage(TypedDict, closed=True):
    account_id: str
    tenant_id: str


class NativeDeliveryMessage(TypedDict, closed=True):
    ref: dict[str, JsonValue]
    generation: int
    dispatch_id: str
    actor: NativeActorMessage


class PhysicalCodeArguments(TypedDict, closed=True):
    ref: NativeTestContextRef
    key: OperationKey
    intent: EffectIntent
    permit: DispatchPermit
    acquisition: CodeAcquisitionRef
    spec: CodeScopeSpec
    payload_digest: str
    profile_digest: str
    physical_deadline: datetime


@dataclass
class PhysicalCodeCase:
    case: LedgerCase
    repo: NativeCodePhysicalRepository
    current: CurrentAcquisition
    args: PhysicalCodeArguments


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
    command: PublicDecisionArguments
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
    published: list[NativeDeliveryMessage]
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


def require_present[T](value: T | None) -> T:
    """Require a persisted positive-fixture row or an explicitly expected result."""
    assert value is not None
    return value


def require_instance[T](value: object, expected: type[T]) -> T:
    """Assert the actual ORM/payload class at a positive test boundary."""
    assert isinstance(value, expected)
    return value


class NativeRuntimeWitness:
    """Explicit native runtime port; unexpected phase entry fails the test."""

    def run_initial(self, *, context: ResolvedNativeTestContext) -> NativeWorkflowOutcome:
        del context
        raise AssertionError("unexpected initial runtime entry")

    def resume(
        self,
        *,
        context: ResolvedNativeTestContext,
        checkpoint: NativeCheckpointPayload,
        resolutions: tuple[NativePendingResolution, ...],
    ) -> NativeWorkflowOutcome:
        del context, checkpoint, resolutions
        raise AssertionError("unexpected resumed runtime entry")

    def cancel(self, *, refs: tuple[NativeTestContextRef, ...]) -> tuple[str, ...]:
        del refs
        raise AssertionError("unexpected runtime cancellation")

    def recovery_evidence(
        self, *, context: ResolvedNativeTestContext, dispatch_id: str
    ) -> Literal["not_started", "stopped", "unknown"]:
        del context, dispatch_id
        raise AssertionError("unexpected runtime recovery")


class DecisionTerms(TypedDict, closed=True):
    max_calls: int
    max_dispatches: int
    max_cost_units: int
    expires_at: datetime


class InternalDecisionArguments(TypedDict, closed=True):
    ref: NativeTestContextRef
    intent: EffectIntent
    decision: Literal["approved", "denied"]
    max_calls: int
    max_dispatches: int
    max_cost_units: int
    expires_at: datetime


class PublicDecisionArguments(TypedDict, closed=True):
    ref: NativeTestContextRef
    intent: EffectIntent
    decision: Literal["approved", "denied"]
    max_calls: int
    max_dispatches: int
    max_cost_units: int
    expires_at: datetime
    pending_guard: PendingDecisionGuard
