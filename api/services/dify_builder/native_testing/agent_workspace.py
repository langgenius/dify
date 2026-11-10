"""Disposable Agent workspaces rooted in the stored native invocation owner.

Reservation/finalization use bounded owner locks. The existing Agent client owns
physical allocation outside SQL. Ambiguous creation is reconciled by inspect of
exact reserved IDs; it never starts a replacement scope.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Literal

from dify_agent.protocol import CreateExecutionBindingRequest, DestroyExecutionBindingRequest
from dify_agent.protocol.execution_binding import CreateExecutionBindingResponse
from pydantic import BaseModel, ConfigDict
from shellctl.shared.schemas import NativeScopeLimits, NativeScopeSpec
from sqlalchemy import select

from libs.uuid_utils import uuidv7
from models.agent import (
    AgentConfigSnapshot,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.dify_builder_native_tests import NativeTestInvocation
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.agent_contracts import AgentTestWorkspaceRef
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.agent.workspace_service import AgentWorkspaceService
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

_ALLOCATION = "_agent_workspace_v1"
logger = logging.getLogger(__name__)


class AgentWorkspaceAllocation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    tenant_id: str
    app_id: str
    request_id: str
    invocation_id: str
    owner_run_id: str
    binding_id: str
    workspace_id: str
    agent_id: str
    pinned_snapshot_id: str
    home_snapshot_id: str
    native_scope: NativeScopeSpec
    phase: Literal["allocating", "ready", "retiring", "retired", "quarantined"]

    @property
    def backend_ref(self) -> str:
        return f"native:{self.native_scope.scope_id}:{self.native_scope.generation}"


def store_allocation(row, allocation: AgentWorkspaceAllocation) -> None:
    row.bindings = {**row.bindings, _ALLOCATION: allocation.model_dump(mode="json")}


def _row(session, owned):
    row = session.scalar(
        select(NativeTestInvocation).where(
            NativeTestInvocation.tenant_id == owned.tenant_id,
            NativeTestInvocation.request_id == owned.ref.request_id,
            NativeTestInvocation.invocation_id == owned.ref.invocation_id,
        )
    )
    if row is None:
        raise BuilderExecutionPolicyError("native_workspace_owner_missing")
    return row


def _ref(allocation: AgentWorkspaceAllocation) -> AgentTestWorkspaceRef:
    return AgentTestWorkspaceRef(
        binding_id=allocation.binding_id,
        workspace_id=allocation.workspace_id,
        backend_binding_ref=allocation.backend_ref,
        backend_workspace_ref=allocation.backend_ref,
        pinned_snapshot_id=allocation.pinned_snapshot_id,
        home_snapshot_id=allocation.home_snapshot_id,
        workspace_generation=allocation.native_scope.generation,
    )


class AgentTestWorkspaceService:
    def __init__(
        self, loader: OwnedNativeTestLoader, *, state_store: NativeExecutionStateStore, limits: NativeScopeLimits
    ):
        self.loader = loader
        self.state_store = state_store
        self.limits = NativeScopeLimits.model_validate(limits.model_dump(mode="json"))

    def validate_binding(self, *, ref: NativeTestContextRef, binding_ref: str) -> AgentTestWorkspaceRef:
        """Stored owner lookup for A3/A5's authenticated runtime lineage callback.

        Native ref syntax is classification only. The caller must supply its
        stored authenticated ref; this method never infers one from a token.
        """
        self.loader.load(ref=ref)
        with self.loader.locked(ref=ref) as (session, owned, _scope):
            row = _row(session, owned)
            allocation = AgentWorkspaceAllocation.model_validate(row.bindings.get(_ALLOCATION))
            self._validate_owner(allocation, owned)
            if allocation.phase != "ready" or allocation.backend_ref != binding_ref:
                raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
            binding = session.scalar(
                select(AgentWorkspaceBinding)
                .join(
                    AgentWorkspace,
                    (AgentWorkspace.id == AgentWorkspaceBinding.workspace_id)
                    & (AgentWorkspace.tenant_id == AgentWorkspaceBinding.tenant_id),
                )
                .where(
                    AgentWorkspaceBinding.id == allocation.binding_id,
                    AgentWorkspaceBinding.tenant_id == owned.tenant_id,
                    AgentWorkspaceBinding.app_id == owned.app_id,
                    AgentWorkspaceBinding.backend_binding_ref == binding_ref,
                    AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
                    AgentWorkspace.tenant_id == owned.tenant_id,
                    AgentWorkspace.app_id == owned.app_id,
                    AgentWorkspace.id == allocation.workspace_id,
                    AgentWorkspace.owner_type == AgentWorkspaceOwnerType.WORKFLOW_RUN,
                    AgentWorkspace.owner_id == allocation.owner_run_id,
                    AgentWorkspace.owner_scope_key == f"native:{ref.invocation_id}",
                    AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
                )
            )
            if binding is None:
                raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
            return _ref(allocation)

    def prepare(
        self, *, ref: NativeTestContextRef, pinned_snapshot_id: str, input_file_refs: tuple[str, ...]
    ) -> AgentTestWorkspaceRef:
        # Until the canonical file owner explicitly authorizes imports, refuse
        # before allocation; never inherit arbitrary paths or business keys.
        if input_file_refs:
            raise BuilderExecutionPolicyError("native_input_import_requires_capability")
        context = self.state_store.load_context(ref=ref)
        self.loader.load(ref=ref)
        with self.loader.locked(ref=ref) as (session, owned, _scope):
            if context.ref != ref or context.tenant_id != owned.tenant_id or context.app_id != owned.app_id:
                raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
            row = _row(session, owned)
            previous = row.bindings.get(_ALLOCATION)
            if previous is not None:
                allocation = AgentWorkspaceAllocation.model_validate(previous)
                self._validate_owner(allocation, owned)
                if allocation.pinned_snapshot_id != pinned_snapshot_id or allocation.native_scope.limits != self.limits:
                    raise BuilderExecutionPolicyError("native_workspace_generation_mismatch")
                if allocation.phase == "ready":
                    return _ref(allocation)
                if allocation.phase != "allocating":
                    raise BuilderExecutionPolicyError("native_workspace_unavailable")
                reconcile = True
            else:
                if not context.native_run_id:
                    raise BuilderExecutionPolicyError("native_run_identity_unavailable")
                snapshot = session.scalar(
                    select(AgentConfigSnapshot).where(
                        AgentConfigSnapshot.id == pinned_snapshot_id, AgentConfigSnapshot.tenant_id == owned.tenant_id
                    )
                )
                if snapshot is None or not snapshot.home_snapshot_id:
                    raise BuilderExecutionPolicyError("native_pinned_home_unavailable")
                nodes = context.graph.get("nodes", [])
                pinned = False
                if isinstance(nodes, list):
                    for node in nodes:
                        if not isinstance(node, dict):
                            continue
                        data = node.get("data")
                        if not isinstance(data, dict):
                            continue
                        selected = data.get("agent_binding")
                        if (
                            isinstance(selected, dict)
                            and selected.get("current_snapshot_id") == snapshot.id
                            and selected.get("agent_id") == snapshot.agent_id
                        ):
                            pinned = True
                            break
                if not pinned:
                    raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
                home = session.scalar(
                    select(AgentHomeSnapshot).where(
                        AgentHomeSnapshot.id == snapshot.home_snapshot_id,
                        AgentHomeSnapshot.agent_id == snapshot.agent_id,
                        AgentHomeSnapshot.tenant_id == owned.tenant_id,
                        AgentHomeSnapshot.status == AgentWorkingResourceStatus.ACTIVE,
                    )
                )
                if home is None:
                    raise BuilderExecutionPolicyError("native_pinned_home_unavailable")
                binding_id, workspace_id = str(uuidv7()), str(uuidv7())
                deadline = min(owned.expires_at, datetime.now(UTC) + timedelta(seconds=self.limits.wall_seconds))
                allocation = AgentWorkspaceAllocation(
                    tenant_id=owned.tenant_id,
                    app_id=owned.app_id,
                    request_id=ref.request_id,
                    invocation_id=ref.invocation_id,
                    owner_run_id=context.native_run_id,
                    binding_id=binding_id,
                    workspace_id=workspace_id,
                    agent_id=snapshot.agent_id,
                    pinned_snapshot_id=snapshot.id,
                    home_snapshot_id=home.id,
                    phase="allocating",
                    native_scope=NativeScopeSpec(
                        scope_id=binding_id,
                        binding_ref=binding_id,
                        generation=1,
                        base_snapshot_ref=home.snapshot_ref,
                        input_file_refs=(),
                        network_targets=(),
                        capability_digest=canonical_digest(
                            {
                                "ref": ref.model_dump(mode="json"),
                                "snapshot": snapshot.id,
                                "home": home.id,
                                "limits": self.limits.model_dump(mode="json"),
                            }
                        ),
                        deadline=deadline,
                        limits=self.limits,
                    ),
                )
                store_allocation(row, allocation)
                reconcile = False
        # No caller-owned session or SQL transaction survives this boundary.
        with AgentWorkspaceService._client() as client:
            result = client.create_execution_binding_sync(
                CreateExecutionBindingRequest(
                    tenant_id=allocation.tenant_id,
                    agent_id=allocation.agent_id,
                    binding_id=allocation.binding_id,
                    workspace_id=allocation.workspace_id,
                    home_snapshot_ref=allocation.native_scope.base_snapshot_ref,
                    native_test_scope=allocation.native_scope,
                    native_scope_reconcile=reconcile,
                )
            )
        result = CreateExecutionBindingResponse.model_validate(result.model_dump(mode="json"))
        if result.binding_ref != allocation.backend_ref or result.workspace_ref != allocation.backend_ref:
            raise BuilderExecutionPolicyError("native_workspace_backend_identity_mismatch")
        try:
            with self.loader.locked(ref=ref) as (session, owned, _scope):
                row = _row(session, owned)
                current = AgentWorkspaceAllocation.model_validate(row.bindings.get(_ALLOCATION))
                if current == allocation.model_copy(update={"phase": "ready"}):
                    return _ref(current)
                if current != allocation:
                    raise BuilderExecutionPolicyError("native_workspace_reservation_changed")
                AgentWorkspaceService.finalize_native_binding(session=session, allocation=allocation)
                store_allocation(row, allocation.model_copy(update={"phase": "ready"}))
        except Exception:
            try:
                self.retire(ref=ref, workspace_ref=_ref(allocation))
            except Exception:
                # A7's immutable deadline remains the physical upper bound;
                # durable quarantine is written by retire before re-raising.
                logger.warning(
                    "Native Agent allocation cleanup requires reconciliation",
                    extra={
                        "request_id": ref.request_id,
                        "invocation_id": ref.invocation_id,
                        "binding_id": allocation.binding_id,
                    },
                )
            raise
        return _ref(allocation)

    @staticmethod
    def _validate_owner(allocation, owned):
        if (allocation.tenant_id, allocation.app_id, allocation.request_id, allocation.invocation_id) != (
            owned.tenant_id,
            owned.app_id,
            owned.ref.request_id,
            owned.ref.invocation_id,
        ):
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")

    def retire(self, *, ref: NativeTestContextRef, workspace_ref: AgentTestWorkspaceRef) -> None:
        with self.loader.locked(ref=ref, settlement=True) as (session, owned, _scope):
            row = _row(session, owned)
            allocation = AgentWorkspaceAllocation.model_validate(row.bindings.get(_ALLOCATION))
            self._validate_owner(allocation, owned)
            if _ref(allocation) != workspace_ref:
                raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
            if allocation.phase == "retired":
                return
            store_allocation(row, allocation.model_copy(update={"phase": "retiring"}))
            AgentWorkspaceService.retire_binding(
                session=session, tenant_id=owned.tenant_id, binding_id=allocation.binding_id
            )
        try:
            with AgentWorkspaceService._client() as client:
                client.destroy_execution_binding_sync(
                    DestroyExecutionBindingRequest(
                        binding_ref=allocation.backend_ref, workspace_ref=allocation.backend_ref, destroy_workspace=True
                    )
                )
        except Exception:
            with self.loader.locked(ref=ref, settlement=True) as (session, owned, _scope):
                store_allocation(_row(session, owned), allocation.model_copy(update={"phase": "quarantined"}))
            raise
        with self.loader.locked(ref=ref, settlement=True) as (session, owned, _scope):
            store_allocation(_row(session, owned), allocation.model_copy(update={"phase": "retired"}))
