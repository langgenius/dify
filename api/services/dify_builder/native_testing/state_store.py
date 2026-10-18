"""Protected native snapshots with a storage-readback + SQL acknowledgement barrier.

The native adapter owns serialization. This owner stores immutable bytes, never
runs Graphon, and never treats a caller's object reference as authorization.
All key-provider and object-storage work happens outside SQL transactions.
"""

import json
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Literal
from uuid import UUID, uuid4

from pydantic import TypeAdapter
from sqlalchemy import select

from core.helper import encrypter
from extensions.ext_storage import storage
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeEffectOperation,
    NativeInvocationState,
    NativePayloadObject,
    NativeTestInvocation,
)
from models.workflow import Workflow
from services.dify_builder.execution_contracts import (
    BuilderExecutionPolicyError,
    canonical_digest,
)
from services.dify_builder.native_testing.agent_contracts import (
    AgentCreateClaim,
    AgentCreateExisting,
    AgentCreateInserted,
    AgentDefinitionReceipt,
    AgentNodeAssociation,
    AgentParentNodeRef,
    AgentPreparedConfig,
    AgentProtectedState,
    AgentTestWorkspaceRef,
    AgentWaitAssociation,
)
from services.dify_builder.native_testing.contracts import (
    ID,
    CheckpointRef,
    Counter,
    FiniteJSON,
    JsonValue,
    NativeTestContextRef,
    OperationKey,
    operation_digest,
)
from services.dify_builder.native_testing.private_reads import (
    PrivateReadOwner,
    validate_invocation_workflow,
    validate_private_read,
)
from services.dify_builder.native_testing.repository import (
    OwnedNativeTestLoader,
    native_workflow_revision,
    utc_now,
)
from services.dify_builder.native_testing.runtime_contracts import (
    NativeCheckpointPayload,
    ResolvedNativeTestContext,
)
from services.dify_builder.native_testing.transitions import require_ancestor_authority

_JSON = TypeAdapter(FiniteJSON)
PayloadKind = Literal["context", "checkpoint", "result"]


def encode_payload(
    *, tenant_id: str, request_id: str, invocation_id: str, kind: str, payload: JsonValue
) -> tuple[str, str]:
    value = _JSON.validate_python(payload)
    envelope = {
        "schema": "1",
        "tenant_id": tenant_id,
        "request_id": request_id,
        "invocation_id": invocation_id,
        "kind": kind,
        "payload": value,
    }
    return json.dumps(
        envelope, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ), canonical_digest(envelope)


def decode_payload(
    raw: str, *, tenant_id: str, request_id: str, invocation_id: str, kind: str, digest: str
) -> JsonValue:
    try:
        envelope = _JSON.validate_python(json.loads(raw))
        if not isinstance(envelope, dict) or set(envelope) != {
            "schema",
            "tenant_id",
            "request_id",
            "invocation_id",
            "kind",
            "payload",
        }:
            raise ValueError("envelope")
        expected = {
            "schema": "1",
            "tenant_id": tenant_id,
            "request_id": request_id,
            "invocation_id": invocation_id,
            "kind": kind,
        }
        if any(envelope.get(k) != v for k, v in expected.items()) or canonical_digest(envelope) != digest:
            raise ValueError("ownership or integrity")
        return envelope["payload"]
    except (ValueError, TypeError, UnicodeError):
        raise BuilderExecutionPolicyError("native_payload_invalid") from None


def owner_query(model, ref: NativeTestContextRef, tenant_id: str):
    return select(model).where(
        model.tenant_id == tenant_id, model.request_id == ref.request_id, model.invocation_id == ref.invocation_id
    )


def invocation_state(session, ref: NativeTestContextRef, tenant_id: str) -> NativeInvocationState:
    state = session.scalar(owner_query(NativeInvocationState, ref, tenant_id))
    if state is None:
        raise BuilderExecutionPolicyError("native_state_unavailable")
    return state


@dataclass(frozen=True)
class ObjectReceipt:
    id: str
    tenant_id: str
    request_id: str
    invocation_id: str
    kind: str
    logical_key: str
    storage_key: str
    payload_digest: str
    value_digest: str


@dataclass
class _AgentPreparation:
    parent: AgentParentNodeRef
    context: ResolvedNativeTestContext
    authority: PrivateReadOwner
    workspace: AgentTestWorkspaceRef
    resource_digest: str
    objects: list[ObjectReceipt]


@contextmanager
def _agent_boundary():
    try:
        yield
    except BuilderExecutionPolicyError:
        raise
    except Exception:
        raise BuilderExecutionPolicyError("native_agent_state_unavailable") from None


class NativeExecutionStateStore:
    def __init__(self, loader: OwnedNativeTestLoader):
        self.loader = loader

    def prepare_object(
        self,
        *,
        ref: NativeTestContextRef,
        tenant_id: str,
        kind: PayloadKind,
        logical_key: str,
        payload: JsonValue,
        max_bytes: int | None = None,
    ) -> ObjectReceipt:
        """Internal producer port: caller must subsequently acknowledge under the root lock."""
        raw, digest = encode_payload(
            tenant_id=tenant_id,
            request_id=ref.request_id,
            invocation_id=ref.invocation_id,
            kind=kind,
            payload=payload,
        )
        identity = str(uuid4())
        key = f"builder-native/{identity}"
        encrypted = encrypter.encrypt_token(tenant_id, raw).encode("ascii")
        if max_bytes is not None and len(encrypted) > max_bytes:
            raise BuilderExecutionPolicyError("native_agent_config_unavailable")
        storage.save(key, encrypted)
        readback = storage.load(key)
        if max_bytes is not None and len(readback) > max_bytes:
            raise BuilderExecutionPolicyError("native_agent_config_unavailable")
        roundtrip = encrypter.decrypt_token(tenant_id, readback.decode("ascii"))
        if max_bytes is not None and len(roundtrip.encode("utf-8")) > max_bytes:
            raise BuilderExecutionPolicyError("native_agent_config_unavailable")
        value = decode_payload(
            roundtrip,
            tenant_id=tenant_id,
            request_id=ref.request_id,
            invocation_id=ref.invocation_id,
            kind=kind,
            digest=digest,
        )
        return ObjectReceipt(
            identity,
            tenant_id,
            ref.request_id,
            ref.invocation_id,
            kind,
            logical_key,
            key,
            digest,
            canonical_digest(value),
        )

    @staticmethod
    def acknowledge_object(session, receipt: ObjectReceipt) -> NativePayloadObject:
        existing = session.scalar(
            select(NativePayloadObject).where(
                NativePayloadObject.tenant_id == receipt.tenant_id,
                NativePayloadObject.request_id == receipt.request_id,
                NativePayloadObject.invocation_id == receipt.invocation_id,
                NativePayloadObject.kind == receipt.kind,
                NativePayloadObject.logical_key == receipt.logical_key,
            )
        )
        if existing is not None:
            if (existing.payload_digest, existing.value_digest) != (receipt.payload_digest, receipt.value_digest):
                raise BuilderExecutionPolicyError("native_payload_conflict")
            return existing
        row = NativePayloadObject(**vars(receipt))
        session.add(row)
        session.flush()
        return row

    @staticmethod
    def _read_object(row: NativePayloadObject | ObjectReceipt, *, max_bytes: int | None = None) -> JsonValue:
        try:
            stored = storage.load(row.storage_key)
            if max_bytes is not None and len(stored) > max_bytes:
                raise BuilderExecutionPolicyError("native_agent_config_unavailable")
            raw = encrypter.decrypt_token(row.tenant_id, stored.decode("ascii"))
            if max_bytes is not None and len(raw.encode("utf-8")) > max_bytes:
                raise BuilderExecutionPolicyError("native_agent_config_unavailable")
            value = decode_payload(
                raw,
                tenant_id=row.tenant_id,
                request_id=row.request_id,
                invocation_id=row.invocation_id,
                kind=row.kind,
                digest=row.payload_digest,
            )
            if canonical_digest(value) != row.value_digest:
                raise BuilderExecutionPolicyError("native_payload_invalid")
            return value
        except BuilderExecutionPolicyError:
            raise
        except Exception:
            raise BuilderExecutionPolicyError("native_payload_unavailable") from None

    def initialize_context(self, *, context: ResolvedNativeTestContext) -> None:
        """Trusted admission only, after C02 request/scope creation; child creation has its own port."""
        context = ResolvedNativeTestContext.model_validate(context.model_dump(mode="json"))
        owned = self.loader.load(ref=context.ref)
        if (
            context.tenant_id,
            context.actor_id,
            context.app_id,
            context.workflow_id,
            context.parent_invocation_id,
            context.generation,
            context.call_depth,
            context.budget_ref,
            context.cancellation_ref,
        ) != (
            owned.tenant_id,
            owned.actor_id,
            owned.app_id,
            owned.workflow_id,
            None,
            owned.generation,
            0,
            owned.ref.request_id,
            owned.ref.request_id,
        ):
            raise BuilderExecutionPolicyError("native_context_mismatch")
        with self.loader.session_factory() as session:
            workflow = session.get(Workflow, owned.workflow_id)
            test_input = session.get(DifyBuilderTestInput, owned.test_input_id)
            if (
                workflow is None
                or test_input is None
                or context.graph != json.loads(workflow.graph)
                or context.graph_revision != native_workflow_revision(workflow)
                or canonical_digest(context.inputs) != canonical_digest(test_input.inputs)
                or context.input_revision != canonical_digest(context.inputs)
            ):
                raise BuilderExecutionPolicyError("native_snapshot_mismatch")
        receipt = self.prepare_object(
            ref=context.ref,
            tenant_id=owned.tenant_id,
            kind="context",
            logical_key="context",
            payload=context.model_dump(mode="json"),
        )
        with self.loader.locked(ref=context.ref) as (session, current, _):
            if current.generation != context.generation:
                raise BuilderExecutionPolicyError("native_generation_conflict")
            row = self.acknowledge_object(session, receipt)
            existing = session.scalar(owner_query(NativeInvocationState, context.ref, owned.tenant_id))
            if existing is None:
                session.add(
                    NativeInvocationState(
                        tenant_id=owned.tenant_id,
                        request_id=context.ref.request_id,
                        invocation_id=context.ref.invocation_id,
                        context_object_id=row.id,
                        app_id=context.app_id,
                        workflow_id=context.workflow_id,
                        parent_invocation_id=None,
                        parent_operation_digest=None,
                        child_identity_digest=None,
                        generation=context.generation,
                        state="running",
                        checkpoint_id=None,
                        pending_ids=[],
                        wait_reason=None,
                        outcome=None,
                        resolution=[],
                        cancellation_key=None,
                    )
                )
            elif existing.context_object_id != row.id:
                raise BuilderExecutionPolicyError("native_snapshot_mismatch")

    def load_context(self, *, ref: NativeTestContextRef) -> ResolvedNativeTestContext:
        return self._load_context(ref=ref, recovery=False)

    def load_recovery_context(self, *, ref: NativeTestContextRef) -> ResolvedNativeTestContext:
        """Read-only recovery material; an inactive invocation gains no authority."""
        return self._load_context(ref=ref, recovery=True)

    def _load_context(self, *, ref: NativeTestContextRef, recovery: bool) -> ResolvedNativeTestContext:
        owned = validate_private_read(self.loader, ref)
        if owned.cancelled:
            raise BuilderExecutionPolicyError("native_cancelled")
        if not recovery and (not owned.active or owned.request_state not in {"running", "waiting"}):
            raise BuilderExecutionPolicyError("native_invocation_mismatch")
        if owned.expires_at <= utc_now():
            raise BuilderExecutionPolicyError("native_expired")
        with self.loader.session_factory() as session:
            row = session.scalar(
                owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                    NativePayloadObject.id == owned.context_object_id, NativePayloadObject.kind == "context"
                )
            )
        if row is None:
            raise BuilderExecutionPolicyError("native_state_unavailable")
        context = ResolvedNativeTestContext.model_validate(self._read_object(row))
        if (
            context.ref,
            context.tenant_id,
            context.actor_id,
            context.app_id,
            context.workflow_id,
            context.parent_invocation_id,
        ) != (ref, owned.tenant_id, owned.actor_id, owned.app_id, owned.workflow_id, owned.parent_invocation_id):
            raise BuilderExecutionPolicyError("native_context_mismatch")
        if not owned.root_revision_matches or context.graph_revision != owned.graph_revision:
            raise BuilderExecutionPolicyError("native_revision_drift")
        if owned.input_revision is not None and owned.input_revision != context.input_revision:
            raise BuilderExecutionPolicyError("native_input_drift")
        return context.model_copy(update={"generation": owned.generation})

    def commit_checkpoint(
        self, *, ref: NativeTestContextRef, generation: int, payload: NativeCheckpointPayload
    ) -> CheckpointRef:
        try:
            payload = NativeCheckpointPayload.model_validate(payload.model_dump(mode="json"))
            context = self.load_context(ref=ref)
            if type(generation) is not int or generation != context.generation or payload.generation != generation:
                raise BuilderExecutionPolicyError("native_generation_conflict")
            if context.native_run_id != payload.native_run_id:
                raise BuilderExecutionPolicyError("native_run_mismatch")
            agent_preparations = self._agent_checkpoint_preparations(ref, payload)
            # Validate every referenced private input/result and child owner before storing.
            for result_ref in (
                *payload.input_result_refs,
                *(r for j in payload.node_journals for r in (j.input_result_ref, *j.result_refs)),
            ):
                self.load_result(ref=ref, result_ref=result_ref)
            for journal in payload.node_journals:
                if journal.invocation_id != ref.invocation_id or any(
                    k.invocation_id != ref.invocation_id for k in journal.operation_keys
                ):
                    raise BuilderExecutionPolicyError("native_journal_owner_mismatch")
                if (
                    canonical_digest(self.load_result(ref=ref, result_ref=journal.input_result_ref))
                    != journal.input_digest
                ):
                    raise BuilderExecutionPolicyError("native_journal_input_mismatch")
            with self.loader.session_factory() as session:
                for child in payload.child_refs:
                    state = invocation_state(session, child, context.tenant_id)
                    if (
                        child.request_id != ref.request_id
                        or child.context_digest != ref.context_digest
                        or state.parent_invocation_id != ref.invocation_id
                    ):
                        raise BuilderExecutionPolicyError("native_child_owner_mismatch")
            receipt = self.prepare_object(
                ref=ref,
                tenant_id=context.tenant_id,
                kind="checkpoint",
                logical_key=str(generation),
                payload=payload.model_dump(
                    mode="json", exclude={"agent_associations"} if not payload.agent_associations else set()
                ),
            )
            with self.loader.locked(ref=ref) as (session, owned, scope):
                state = invocation_state(session, ref, owned.tenant_id)
                if state.generation != generation or state.state not in {"running", "waiting"}:
                    raise BuilderExecutionPolicyError("native_generation_conflict")
                for prepared in agent_preparations:
                    self._agent_recheck(session, owned, scope, prepared, writing=False)
                obj = self.acknowledge_object(session, receipt)
                prior = session.scalar(
                    owner_query(NativeContinuation, ref, owned.tenant_id).where(
                        NativeContinuation.generation == generation
                    )
                )
                if prior is None:
                    prior = NativeContinuation(
                        tenant_id=owned.tenant_id,
                        request_id=ref.request_id,
                        invocation_id=ref.invocation_id,
                        generation=generation,
                        checkpoint_id=obj.id,
                        payload_digest=obj.payload_digest,
                        payload_ref=obj.storage_key,
                    )
                    session.add(prior)
                result = CheckpointRef(checkpoint_id=prior.checkpoint_id, payload_digest=prior.payload_digest)
            return result
        except BuilderExecutionPolicyError:
            raise
        except Exception:
            raise BuilderExecutionPolicyError("checkpoint_unavailable") from None

    def read_checkpoint(self, *, ref: NativeTestContextRef, checkpoint: CheckpointRef) -> NativeCheckpointPayload:
        owned = validate_private_read(self.loader, ref)
        with self.loader.session_factory() as session:
            continuation = session.scalar(
                owner_query(NativeContinuation, ref, owned.tenant_id).where(
                    NativeContinuation.checkpoint_id == checkpoint.checkpoint_id,
                    NativeContinuation.payload_digest == checkpoint.payload_digest,
                )
            )
            row = session.scalar(
                owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                    NativePayloadObject.id == checkpoint.checkpoint_id, NativePayloadObject.kind == "checkpoint"
                )
            )
            if (
                continuation is None
                or row is None
                or row.payload_digest != checkpoint.payload_digest
                or row.storage_key != continuation.payload_ref
            ):
                raise BuilderExecutionPolicyError("checkpoint_unavailable")
        payload = NativeCheckpointPayload.model_validate(self._read_object(row))
        if payload.agent_associations:
            with _agent_boundary():
                if payload.generation != continuation.generation:
                    raise BuilderExecutionPolicyError("native_generation_conflict")
                prepared = self._agent_checkpoint_preparations(ref, payload)
                outer = ObjectReceipt(**{name: getattr(row, name) for name in ObjectReceipt.__dataclass_fields__})
                with self.loader.locked(ref=ref) as (session, current, scope):
                    selected_continuation = session.scalar(
                        owner_query(NativeContinuation, ref, current.tenant_id).where(
                            NativeContinuation.checkpoint_id == checkpoint.checkpoint_id,
                            NativeContinuation.payload_digest == checkpoint.payload_digest,
                        )
                    )
                    selected_object = session.scalar(
                        owner_query(NativePayloadObject, ref, current.tenant_id).where(
                            NativePayloadObject.id == checkpoint.checkpoint_id, NativePayloadObject.kind == "checkpoint"
                        )
                    )
                    if selected_continuation is None or selected_continuation.generation != payload.generation:
                        raise BuilderExecutionPolicyError("native_generation_conflict")
                    if (
                        selected_object is None
                        or selected_continuation.payload_ref != outer.storage_key
                        or any(
                            getattr(selected_object, name) != getattr(outer, name)
                            for name in ObjectReceipt.__dataclass_fields__
                        )
                    ):
                        raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
                    for selected in prepared:
                        self._agent_recheck(session, current, scope, selected, writing=False)
        return payload

    def store_result(self, *, ref: NativeTestContextRef, key: OperationKey, result: JsonValue) -> str:
        if key.invocation_id != ref.invocation_id:
            raise BuilderExecutionPolicyError("native_result_owner_mismatch")
        logical_key = operation_digest(key)
        # A cancelled/revoked invocation may still save the result of an already
        # spent operation, matching C02's settlement path. This creates no I/O.
        with self.loader.session_factory() as session:
            owned, _ = self.loader._load(session, ref=ref, lock=False, settlement=True)
            spent = (
                session.scalar(
                    owner_query(NativeEffectOperation, ref, owned.tenant_id).where(
                        NativeEffectOperation.operation_digest == logical_key,
                        NativeEffectOperation.state.in_(("claimed", "completed")),
                    )
                )
                is not None
            )
        if not spent:
            self.loader.load(ref=ref)
            validate_private_read(self.loader, ref)
        receipt = self.prepare_object(
            ref=ref, tenant_id=owned.tenant_id, kind="result", logical_key=logical_key, payload=result
        )
        with self.loader.locked(ref=ref, settlement=spent) as (session, _, _):
            row = self.acknowledge_object(session, receipt)
            result_ref = row.id
        return result_ref

    def store_node_inputs(
        self, *, ref: NativeTestContextRef, generation: int, native_execution_id: str, inputs: JsonValue
    ) -> str:
        """Persist typed inputs independently of effect result slots, without issuing authority.

        The trusted producer must obtain the UUID from its attached, bound native
        node. UUID syntax alone establishes no native execution provenance.
        """
        try:
            ref = NativeTestContextRef.model_validate(ref.model_dump(warnings=False), strict=True)
            if type(native_execution_id) is not str or str(UUID(native_execution_id)) != native_execution_id:
                raise BuilderExecutionPolicyError("native_run_mismatch")
            logical_key = "node-input:" + native_execution_id
            if len(logical_key) > 128:
                raise BuilderExecutionPolicyError("native_payload_invalid")
            inputs = _JSON.validate_python(inputs)
            self.loader.load(ref=ref)
            authority = validate_private_read(self.loader, ref)
            context = self.load_context(ref=ref)
            if type(generation) is not int or generation != context.generation:
                raise BuilderExecutionPolicyError("native_generation_conflict")
            with self.loader.session_factory() as session:
                owned, scope = self.loader._load(session, ref=ref, lock=False)
                self._validate_node_inputs_owner(session, owned, scope, context, authority, generation)
            receipt = self.prepare_object(
                ref=ref, tenant_id=context.tenant_id, kind="result", logical_key=logical_key, payload=inputs
            )
            with self.loader.locked(ref=ref) as (session, owned, scope):
                self._validate_node_inputs_owner(session, owned, scope, context, authority, generation)
                result_ref = self.acknowledge_object(session, receipt).id
            return result_ref
        except BuilderExecutionPolicyError:
            raise
        except Exception:
            raise BuilderExecutionPolicyError("native_payload_unavailable") from None

    @staticmethod
    def _validate_node_inputs_owner(
        session,
        owned,
        scope,
        context: ResolvedNativeTestContext,
        authority: PrivateReadOwner,
        generation: int,
        *,
        allowed_states: tuple[str, ...] = ("running",),
    ) -> None:
        """SQL-only preflight/recheck; caller owns the transaction and any root lock."""
        state = invocation_state(session, context.ref, owned.tenant_id)
        # The scope counter advances on resume; unrelated running branches keep
        # their own invocation generation and remain eligible to persist inputs.
        if (context.generation, state.generation, authority.generation) != (generation,) * 3:
            raise BuilderExecutionPolicyError("native_generation_conflict")
        if scope.expires_at <= utc_now():
            raise BuilderExecutionPolicyError("native_expired")
        if state.state not in allowed_states:
            raise BuilderExecutionPolicyError("native_invocation_mismatch")
        if (
            context.ref,
            context.tenant_id,
            context.actor_id,
            context.app_id,
            context.workflow_id,
            context.parent_invocation_id,
            authority.context_object_id,
        ) != (
            owned.ref,
            owned.tenant_id,
            owned.actor_id,
            state.app_id,
            state.workflow_id,
            state.parent_invocation_id,
            state.context_object_id,
        ):
            raise BuilderExecutionPolicyError("native_context_mismatch")
        require_ancestor_authority(session, context.ref, owned.tenant_id)
        request = session.get(DifyBuilderExecutionRequest, context.ref.request_id)
        if (
            context.execution_mode != "native"
            or not context.native_run_id
            or not context.root_native_run_id
            or request is None
            or request.context.get("mode") != "native"
            or request.context.get("native_run_id") != context.root_native_run_id
            or (context.parent_invocation_id is None and context.native_run_id != context.root_native_run_id)
        ):
            raise BuilderExecutionPolicyError("native_run_mismatch")
        workflow = validate_invocation_workflow(
            session, tenant_id=owned.tenant_id, app_id=context.app_id, workflow_id=context.workflow_id
        )
        if native_workflow_revision(workflow) != context.graph_revision or json.loads(workflow.graph) != context.graph:
            raise BuilderExecutionPolicyError("native_revision_drift")

    def load_result(self, *, ref: NativeTestContextRef, result_ref: str) -> JsonValue:
        owned = validate_private_read(self.loader, ref)
        with self.loader.session_factory() as session:
            row = session.scalar(
                owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                    NativePayloadObject.id == result_ref, NativePayloadObject.kind == "result"
                )
            )
        if row is None:
            raise BuilderExecutionPolicyError("native_result_owner_mismatch")
        return self._read_object(row)

    @staticmethod
    def _agent_key(namespace: str, parent: AgentParentNodeRef, generation: int | None = None) -> str:
        key = namespace + ":" + canonical_digest(parent.model_dump(mode="json"))
        if generation is not None:
            key += ":" + str(TypeAdapter(Counter).validate_python(generation))
        if len(key) > 128:
            raise BuilderExecutionPolicyError("native_agent_state_unavailable")
        return key

    @staticmethod
    def _agent_resources(
        session,
        owned,
        context: ResolvedNativeTestContext,
        *,
        definition_receipt: AgentDefinitionReceipt | None = None,
    ) -> tuple[AgentTestWorkspaceRef, str]:
        """Current SQL allocation/pin/workspace chain only; no physical/backend IO."""
        invocation = session.scalar(owner_query(NativeTestInvocation, context.ref, owned.tenant_id))
        if (
            invocation is None
            or not invocation.active
            or (invocation.tenant_id, invocation.request_id, invocation.invocation_id)
            != (context.tenant_id, context.ref.request_id, context.ref.invocation_id)
        ):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        confirmed = invocation.bindings.get("_agent_confirmed_workspace_v1")
        if confirmed is not None:
            from services.dify_builder.native_testing.agent_confirmed_workspace import current_confirmed_workspace

            return current_confirmed_workspace(
                session=session,
                owned=owned,
                context=context,
                allocation=confirmed,
                definition_receipt=definition_receipt,
            )
        allocation = invocation.bindings.get("_agent_workspace_v1")
        if not isinstance(allocation, dict):
            raise BuilderExecutionPolicyError("native_workspace_unavailable")
        # Local import avoids the existing workspace service -> state owner dependency.
        # This is its pure parser/ref conversion, not workspace/backend IO.
        from services.dify_builder.native_testing.agent_workspace import (
            AgentWorkspaceAllocation,
            _ref,
        )

        parsed_allocation = AgentWorkspaceAllocation.model_validate(allocation)
        if any(
            allocation.get(key) != value
            for key, value in {
                "tenant_id": context.tenant_id,
                "app_id": context.app_id,
                "request_id": context.ref.request_id,
                "invocation_id": context.ref.invocation_id,
                "owner_run_id": context.native_run_id,
                "phase": "ready",
            }.items()
        ):
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
        scope = allocation.get("native_scope")
        if not isinstance(scope, dict):
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
        binding_id = TypeAdapter(ID).validate_python(allocation.get("binding_id"))
        TypeAdapter(Counter).validate_python(scope.get("generation"))
        if scope.get("scope_id") != binding_id or scope.get("binding_ref") != binding_id:
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
        if parsed_allocation.native_scope.deadline <= utc_now():
            raise BuilderExecutionPolicyError("native_workspace_unavailable")
        workspace_ref = _ref(parsed_allocation)
        snapshot = session.get(AgentConfigSnapshot, workspace_ref.pinned_snapshot_id)
        home = session.get(AgentHomeSnapshot, workspace_ref.home_snapshot_id)
        workspace = session.get(AgentWorkspace, workspace_ref.workspace_id)
        binding = session.get(AgentWorkspaceBinding, workspace_ref.binding_id)
        if snapshot is None or home is None or workspace is None or binding is None:
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
        agent_id = TypeAdapter(ID).validate_python(allocation.get("agent_id"))
        from services.agent import access_service

        access_service.require_builder_agent_access(
            session=session,
            tenant_id=context.tenant_id,
            actor_id=context.actor_id,
            app_id=context.app_id,
        )
        agent = session.get(Agent, agent_id)
        if agent is None or agent.tenant_id != context.tenant_id or agent.active_config_snapshot_id != snapshot.id:
            raise BuilderExecutionPolicyError("native_agent_pin_mismatch")

        if (
            (snapshot.tenant_id, snapshot.agent_id, snapshot.home_snapshot_id) != (context.tenant_id, agent_id, home.id)
            or (home.tenant_id, home.agent_id, home.status, home.snapshot_ref)
            != (
                context.tenant_id,
                agent_id,
                AgentWorkingResourceStatus.ACTIVE,
                scope.get("base_snapshot_ref"),
            )
            or (
                workspace.tenant_id,
                workspace.app_id,
                workspace.owner_type,
                workspace.owner_id,
                workspace.owner_scope_key,
                workspace.status,
                workspace.backend_workspace_ref,
            )
            != (
                context.tenant_id,
                context.app_id,
                AgentWorkspaceOwnerType.WORKFLOW_RUN,
                context.native_run_id,
                "native:" + context.ref.invocation_id,
                AgentWorkingResourceStatus.ACTIVE,
                workspace_ref.backend_workspace_ref,
            )
            or (
                binding.tenant_id,
                binding.app_id,
                binding.workspace_id,
                binding.agent_id,
                binding.base_home_snapshot_id,
                binding.agent_config_version_id,
                binding.agent_config_version_kind,
                binding.backend_binding_ref,
                binding.status,
            )
            != (
                context.tenant_id,
                context.app_id,
                workspace.id,
                agent_id,
                home.id,
                snapshot.id,
                AgentConfigVersionKind.SNAPSHOT,
                workspace_ref.backend_binding_ref,
                AgentWorkingResourceStatus.ACTIVE,
            )
        ):
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
        nodes = context.graph.get("nodes", [])
        if not isinstance(nodes, list) or not any(
            isinstance(node, dict)
            and isinstance(node.get("data"), dict)
            and isinstance(node["data"].get("agent_binding"), dict)
            and node["data"]["agent_binding"].get("current_snapshot_id") == snapshot.id
            and node["data"]["agent_binding"].get("agent_id") == agent_id
            for node in nodes
        ):
            raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
        from core.agent.publish_visibility import (
            workflow_callable_active_snapshot_filter,
        )
        from services.agent.roster_service import AgentRosterService

        eligible = session.scalar(
            AgentRosterService._build_roster_agents_stmt(tenant_id=context.tenant_id, keyword=None).where(
                Agent.id == agent_id,
                Agent.active_config_has_model.is_(True),
                workflow_callable_active_snapshot_filter(),
            )
        )
        if eligible is None:
            raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
        workflow = validate_invocation_workflow(
            session,
            tenant_id=context.tenant_id,
            app_id=context.app_id,
            workflow_id=context.workflow_id,
        )
        definitions = []
        matched_definition = False
        for node in nodes:
            if not isinstance(node, dict) or not isinstance(node.get("data"), dict):
                continue
            selected = node["data"].get("agent_binding")
            if not isinstance(selected, dict) or (
                selected.get("agent_id"),
                selected.get("current_snapshot_id"),
            ) != (
                agent_id,
                snapshot.id,
            ):
                continue
            published_binding = session.scalar(
                select(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.tenant_id == context.tenant_id,
                    WorkflowAgentNodeBinding.app_id == context.app_id,
                    WorkflowAgentNodeBinding.workflow_id == context.workflow_id,
                    WorkflowAgentNodeBinding.workflow_version == workflow.version,
                    WorkflowAgentNodeBinding.node_id == node.get("id"),
                    WorkflowAgentNodeBinding.agent_id == agent_id,
                    WorkflowAgentNodeBinding.current_snapshot_id == snapshot.id,
                    WorkflowAgentNodeBinding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT,
                )
            )
            if published_binding is None:
                raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
            definitions.append({"node": node, "node_job": published_binding.node_job_config_dict})
            if definition_receipt is not None and node.get("id") == definition_receipt.node_id:
                # Compare the producing definition, not a fresh stamp assigned to
                # already-composed bytes after the claim's initial async reads.
                stamp = canonical_digest(
                    {
                        "node": node,
                        "soul": AgentSoulConfig.model_validate(snapshot.config_snapshot_dict).model_dump(mode="json"),
                        "job": WorkflowNodeJobConfig.model_validate(published_binding.node_job_config_dict).model_dump(
                            mode="json"
                        ),
                    }
                )
                if stamp != definition_receipt.stamp:
                    raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
                matched_definition = True
        if definition_receipt is not None and not matched_definition:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        if not definitions:
            raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
        return workspace_ref, canonical_digest(
            {
                "allocation": allocation,
                "workspace": workspace_ref.model_dump(mode="json"),
                "snapshot": snapshot.config_snapshot_dict,
                "definitions": definitions,
            }
        )

    def _agent_object(
        self,
        preparation: _AgentPreparation,
        *,
        logical_key: str,
        object_ref: str | None = None,
        required: bool = True,
    ) -> tuple[ObjectReceipt, JsonValue] | None:
        with self.loader.session_factory() as session:
            query = owner_query(
                NativePayloadObject,
                preparation.parent.ref,
                preparation.context.tenant_id,
            ).where(
                NativePayloadObject.kind == "result",
                NativePayloadObject.logical_key == logical_key,
            )
            if object_ref is not None:
                query = query.where(NativePayloadObject.id == TypeAdapter(ID).validate_python(object_ref))
            row = session.scalar(query)
            if row is None:
                if required:
                    raise BuilderExecutionPolicyError("native_agent_object_unavailable")
                return None
            receipt = ObjectReceipt(**{name: getattr(row, name) for name in ObjectReceipt.__dataclass_fields__})
        if (
            receipt.tenant_id,
            receipt.request_id,
            receipt.invocation_id,
            receipt.kind,
            receipt.logical_key,
        ) != (
            preparation.context.tenant_id,
            preparation.parent.ref.request_id,
            preparation.parent.ref.invocation_id,
            "result",
            logical_key,
        ) or (object_ref is not None and receipt.id != object_ref):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        value = self._read_object(
            receipt,
            max_bytes=1024 * 1024 if logical_key.startswith("agent-config:") else None,
        )
        preparation.objects.append(receipt)
        return receipt, value

    def _agent_prepare(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        writing: bool,
        expected_generation: int | None = None,
    ) -> _AgentPreparation:
        parent = AgentParentNodeRef.model_validate(parent_node.model_dump(mode="json"))
        if ref != parent.ref:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        self.loader.load(ref=ref)
        authority = validate_private_read(self.loader, ref)
        context = self.load_context(ref=ref)
        if (
            expected_generation is not None
            and TypeAdapter(Counter).validate_python(expected_generation) != context.generation
        ):
            raise BuilderExecutionPolicyError("native_generation_conflict")
        with self.loader.session_factory() as session:
            owned, scope = self.loader._load(session, ref=ref, lock=False)
            self._validate_node_inputs_owner(
                session,
                owned,
                scope,
                context,
                authority,
                context.generation,
                allowed_states=("running",) if writing else ("running", "waiting", "queued"),
            )
            self._agent_single_parent(session, context, parent)
            workspace, stamp = self._agent_resources(session, owned, context)
        prepared = _AgentPreparation(parent, context, authority, workspace, stamp, [])
        selected = self._agent_object(
            prepared, logical_key="node-input:" + parent.execution_id, object_ref=parent.input_result_ref
        )
        assert selected is not None
        if canonical_digest(selected[1]) != parent.input_digest:
            raise BuilderExecutionPolicyError("native_journal_input_mismatch")
        return prepared

    def _agent_recheck(
        self,
        session,
        owned,
        scope,
        prepared: _AgentPreparation,
        *,
        writing: bool,
        definition_receipt: AgentDefinitionReceipt | None = None,
    ) -> None:
        self._validate_node_inputs_owner(
            session,
            owned,
            scope,
            prepared.context,
            prepared.authority,
            prepared.context.generation,
            allowed_states=("running",) if writing else ("running", "waiting", "queued"),
        )
        self._agent_single_parent(session, prepared.context, prepared.parent)
        workspace, stamp = self._agent_resources(
            session, owned, prepared.context, definition_receipt=definition_receipt
        )
        if workspace != prepared.workspace or stamp != prepared.resource_digest:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        for receipt in prepared.objects:
            row = session.scalar(
                owner_query(NativePayloadObject, prepared.parent.ref, owned.tenant_id).where(
                    NativePayloadObject.id == receipt.id,
                    NativePayloadObject.kind == "result",
                )
            )
            if row is None or any(
                getattr(row, name) != getattr(receipt, name) for name in ObjectReceipt.__dataclass_fields__
            ):
                raise BuilderExecutionPolicyError("native_agent_owner_mismatch")

    def _agent_ack(self, prepared: _AgentPreparation, *, logical_key: str, value: JsonValue) -> str:
        existing = self._agent_object(prepared, logical_key=logical_key, required=False)
        receipt = None
        if existing is not None:
            if canonical_digest(existing[1]) != canonical_digest(value):
                raise BuilderExecutionPolicyError("native_payload_conflict")
        else:
            receipt = self.prepare_object(
                ref=prepared.parent.ref,
                tenant_id=prepared.context.tenant_id,
                kind="result",
                logical_key=logical_key,
                payload=value,
            )
        self._agent_refresh_access(prepared)
        with self.loader.locked(ref=prepared.parent.ref) as (session, owned, scope):
            self._agent_recheck(session, owned, scope, prepared, writing=True)
            if receipt is not None:
                return self.acknowledge_object(session, receipt).id
            assert existing is not None
            return existing[0].id

    def _agent_refresh_access(self, prepared: _AgentPreparation) -> None:
        """Current RBAC outside SQL writer, followed by complete local recheck under lock."""
        from services.dify_builder.native_testing.agent_binding import (
            AgentBindingService,
        )

        if validate_private_read(self.loader, prepared.parent.ref) != prepared.authority:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        with self.loader.session_factory() as session:
            snapshot = session.get(AgentConfigSnapshot, prepared.workspace.pinned_snapshot_id)
            if snapshot is None or snapshot.tenant_id != prepared.context.tenant_id:
                raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
            agent_id = snapshot.agent_id
        AgentBindingService.authorize(
            actor=self.loader.actor,
            app_id=prepared.context.app_id,
            agent_ids=frozenset({agent_id}),
        )

    @staticmethod
    def _agent_executable_config(config: JsonValue, parent: AgentParentNodeRef) -> JsonValue:
        """No metadata, secrets, assigned config ref, or caller ownership fields persist."""
        from dify_agent.protocol.schemas import CreateRunRequest

        if not isinstance(config, dict) or set(config) != {
            "composition",
            "session_snapshot",
        }:
            raise BuilderExecutionPolicyError("native_agent_config_mismatch")
        request = CreateRunRequest.model_validate(
            {
                **config,
                "execution_mode": "builder_test",
                "native_test_ref": parent.ref.model_dump(mode="json"),
                "native_test_protocol_version": 1,
                "native_parent_node": parent.model_dump(mode="json"),
            }
        )

        # Layer transport fields can contain only opaque references. Empty credential
        # maps are required by existing DTOs; populated maps are never durable config.
        def credential_free(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if (
                        key
                        in {
                            "credentials",
                            "api_key",
                            "access_token",
                            "refresh_token",
                            "inner_api_key",
                            "authorization",
                        }
                        and item
                    ):
                        raise BuilderExecutionPolicyError("native_agent_config_credentials")
                    credential_free(item)
            elif isinstance(value, list):
                for item in value:
                    credential_free(item)

        normalized = request.model_dump(mode="json", include={"composition", "session_snapshot"})
        credential_free(normalized)
        if len(json.dumps(normalized, ensure_ascii=False).encode()) > 1024 * 1024 - 4096:
            raise BuilderExecutionPolicyError("native_agent_config_unavailable")
        return _JSON.validate_python(normalized)

    def claim_agent_create(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        expected_invocation_generation: int,
        config: JsonValue,
        definition_receipt: AgentDefinitionReceipt,
    ) -> AgentCreateClaim:
        """First local SQL insertion only; lost ACK and identical rows own no POST branch."""
        with _agent_boundary():
            prepared = self._agent_prepare(
                ref=ref,
                parent_node=parent_node,
                writing=True,
                expected_generation=expected_invocation_generation,
            )
            config = self._agent_executable_config(config, prepared.parent)
            value = {
                "schema": "agent-config-v2",
                "parent_node": prepared.parent.model_dump(mode="json"),
                "workflow_native_run_id": prepared.context.native_run_id,
                "workspace": prepared.workspace.model_dump(mode="json"),
                "resource_digest": prepared.resource_digest,
                "config": config,
            }
            key = self._agent_key("agent-config", prepared.parent)
            # Object crypto/readback is deliberately outside the writer, even if another
            # caller wins while it is in progress. That caller's ACK cannot grant us POST.
            receipt = self.prepare_object(
                ref=ref,
                tenant_id=prepared.context.tenant_id,
                kind="result",
                logical_key=key,
                payload=value,
                max_bytes=1024 * 1024,
            )
            self._agent_refresh_access(prepared)
            with self.loader.locked(ref=ref) as (session, owned, scope):
                self._agent_recheck(
                    session,
                    owned,
                    scope,
                    prepared,
                    writing=True,
                    definition_receipt=definition_receipt,
                )
                existing = session.scalar(
                    owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                        NativePayloadObject.kind == "result",
                        NativePayloadObject.logical_key == key,
                    )
                )
                if existing is not None:
                    if (existing.payload_digest, existing.value_digest) != (
                        receipt.payload_digest,
                        receipt.value_digest,
                    ):
                        raise BuilderExecutionPolicyError("native_payload_conflict")
                    return AgentCreateExisting(existing.id, canonical_digest(config))
                selected = self.acknowledge_object(session, receipt)
                return AgentCreateInserted(selected.id, canonical_digest(config))

    def _agent_prepared_config(self, prepared: _AgentPreparation, config_ref: str | None) -> AgentPreparedConfig:
        selected = self._agent_object(
            prepared,
            logical_key=self._agent_key("agent-config", prepared.parent),
            object_ref=config_ref,
        )
        assert selected is not None
        receipt, value = selected
        if (
            not isinstance(value, dict)
            or set(value)
            != {
                "schema",
                "parent_node",
                "workflow_native_run_id",
                "workspace",
                "resource_digest",
                "config",
            }
            or value
            != {
                "schema": "agent-config-v2",
                "parent_node": prepared.parent.model_dump(mode="json"),
                "workflow_native_run_id": prepared.context.native_run_id,
                "workspace": prepared.workspace.model_dump(mode="json"),
                "resource_digest": prepared.resource_digest,
                "config": value.get("config"),
            }
        ):
            raise BuilderExecutionPolicyError("native_agent_config_mismatch")
        config = self._agent_executable_config(value["config"], prepared.parent)
        if prepared.context.native_run_id is None:
            raise BuilderExecutionPolicyError("native_run_mismatch")
        return AgentPreparedConfig(
            parent_node=prepared.parent,
            workflow_native_run_id=prepared.context.native_run_id,
            workspace=prepared.workspace,
            config_ref=receipt.id,
            config_digest=canonical_digest(config),
            config=config,
        )

    def load_prepared_config(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        config_ref: str | None,
    ) -> AgentPreparedConfig:
        """Private current-config read with owner/resource recheck after decryption."""
        with _agent_boundary():
            prepared = self._agent_prepare(ref=ref, parent_node=parent_node, writing=False)
            result = self._agent_prepared_config(prepared, config_ref)
            self._agent_refresh_access(prepared)
            with self.loader.locked(ref=ref) as (session, owned, scope):
                self._agent_recheck(session, owned, scope, prepared, writing=False)
            return result

    def discover_agent_run(
        self, *, ref: NativeTestContextRef, parent_node: AgentParentNodeRef
    ) -> AgentNodeAssociation | None:
        """Observed unbound namespace is unknown, never authority to create/retry."""
        with _agent_boundary():
            prepared = self._agent_prepare(ref=ref, parent_node=parent_node, writing=False)
            # A binding discovery always proves its config, including an unbound reservation.
            self._agent_prepared_config(prepared, None)
            selected = self._agent_object(
                prepared,
                logical_key=self._agent_key("agent-bind", prepared.parent),
                required=False,
            )
            association = None if selected is None else AgentNodeAssociation.model_validate(selected[1])
            if association is not None:
                self._agent_config_relation(prepared, association)
            self._agent_refresh_access(prepared)
            with self.loader.locked(ref=ref) as (session, owned, scope):
                self._agent_recheck(session, owned, scope, prepared, writing=False)
                if (
                    selected is None
                    and session.scalar(
                        owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                            NativePayloadObject.kind == "result",
                            NativePayloadObject.logical_key == self._agent_key("agent-bind", prepared.parent),
                        )
                    )
                    is not None
                ):
                    raise BuilderExecutionPolicyError("native_agent_discovery_unknown")
            return association

    def store_agent_config(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        expected_invocation_generation: int,
        config: JsonValue,
    ) -> str:
        """Internal immutable config bytes, not backend authorization or preparation proof."""
        with _agent_boundary():
            prepared = self._agent_prepare(
                ref=ref, parent_node=parent_node, writing=True, expected_generation=expected_invocation_generation
            )
            value = {
                "schema": "agent-config-v1",
                "parent_node": prepared.parent.model_dump(mode="json"),
                "workflow_native_run_id": prepared.context.native_run_id,
                "workspace": prepared.workspace.model_dump(mode="json"),
                "config": _JSON.validate_python(config),
            }
            return self._agent_ack(prepared, logical_key=self._agent_key("agent-config", prepared.parent), value=value)

    def _agent_binding(self, prepared: _AgentPreparation, association_object_ref: str) -> AgentNodeAssociation:
        selected = self._agent_object(
            prepared, logical_key=self._agent_key("agent-bind", prepared.parent), object_ref=association_object_ref
        )
        assert selected is not None
        association = AgentNodeAssociation.model_validate(selected[1])
        self._agent_config_relation(prepared, association)
        return association

    def _agent_config_relation(self, prepared: _AgentPreparation, association: AgentNodeAssociation) -> None:
        if (
            association.parent_node,
            association.workflow_native_run_id,
            association.workspace,
        ) != (
            prepared.parent,
            prepared.context.native_run_id,
            prepared.workspace,
        ):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        selected = self._agent_object(
            prepared,
            logical_key=self._agent_key("agent-config", prepared.parent),
            object_ref=association.config_ref,
        )
        assert selected is not None
        value = selected[1]
        if isinstance(value, dict) and value.get("schema") == "agent-config-v2":
            selected_config = self._agent_prepared_config(prepared, association.config_ref)
            if selected_config.config_digest != association.config_digest:
                raise BuilderExecutionPolicyError("native_agent_config_mismatch")
            return
        if (
            not isinstance(value, dict)
            or set(value)
            != {
                "schema",
                "parent_node",
                "workflow_native_run_id",
                "workspace",
                "config",
            }
            or value
            != {
                "schema": "agent-config-v1",
                "parent_node": prepared.parent.model_dump(mode="json"),
                "workflow_native_run_id": prepared.context.native_run_id,
                "workspace": prepared.workspace.model_dump(mode="json"),
                "config": value.get("config"),
            }
            or canonical_digest(value["config"]) != association.config_digest
        ):
            raise BuilderExecutionPolicyError("native_agent_config_mismatch")

    def bind_agent_run(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        expected_invocation_generation: int,
        association: AgentNodeAssociation,
    ) -> str:
        """Internal protected binding; only the actual later backend producer may supply its Run."""
        with _agent_boundary():
            association = AgentNodeAssociation.model_validate(association.model_dump(mode="json"))
            prepared = self._agent_prepare(
                ref=ref, parent_node=parent_node, writing=True, expected_generation=expected_invocation_generation
            )
            self._agent_config_relation(prepared, association)
            return self._agent_ack(
                prepared,
                logical_key=self._agent_key("agent-bind", prepared.parent),
                value=association.model_dump(mode="json"),
            )

    @staticmethod
    def _agent_checkpoint_metadata(checkpoint: JsonValue, association: AgentNodeAssociation, generation: int) -> None:
        # The actual backend adapter still owns full AgentCheckpoint/event validation.
        if (
            not isinstance(checkpoint, dict)
            or (
                checkpoint.get("run_id"),
                checkpoint.get("ref"),
                checkpoint.get("config_ref"),
                checkpoint.get("config_digest"),
            )
            != (
                association.agent_run_id,
                association.parent_node.ref.model_dump(mode="json"),
                association.config_ref,
                association.config_digest,
            )
            or TypeAdapter(Counter).validate_python(checkpoint.get("generation")) != generation
        ):
            raise BuilderExecutionPolicyError("native_agent_checkpoint_mismatch")

    def store_agent_wait(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        association_object_ref: str,
        agent_generation: int,
        checkpoint: JsonValue,
        backend_wait_event_id: str,
    ) -> AgentWaitAssociation:
        """Store selected bytes/event reference, NEVER certify an actual Redis ACK.

        The uninstalled later trusted backend producer must first read/validate
        the actual checkpoint and event. No caller proof flag can replace it.
        """
        with _agent_boundary():
            generation = TypeAdapter(Counter).validate_python(agent_generation)
            event_id = TypeAdapter(ID).validate_python(backend_wait_event_id)
            prepared = self._agent_prepare(ref=ref, parent_node=parent_node, writing=True)
            association = self._agent_binding(prepared, association_object_ref)
            checkpoint = _JSON.validate_python(checkpoint)
            self._agent_checkpoint_metadata(checkpoint, association, generation)
            value = {
                "schema": "agent-checkpoint-v1",
                "parent_node": prepared.parent.model_dump(mode="json"),
                "association_object_ref": association_object_ref,
                "agent_generation": generation,
                "backend_wait_event_id": event_id,
                "checkpoint": checkpoint,
            }
            object_ref = self._agent_ack(
                prepared, logical_key=self._agent_key("agent-cp", prepared.parent, generation), value=value
            )
            return AgentWaitAssociation(
                parent_node=prepared.parent,
                association_object_ref=association_object_ref,
                agent_generation=generation,
                checkpoint_object_ref=object_ref,
                checkpoint_digest=canonical_digest(checkpoint),
                backend_wait_event_id=event_id,
            )

    def _agent_wait_relation(
        self, prepared: _AgentPreparation, association: AgentNodeAssociation, wait: AgentWaitAssociation
    ) -> JsonValue:
        if wait.parent_node != prepared.parent:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        selected = self._agent_object(
            prepared,
            logical_key=self._agent_key("agent-cp", prepared.parent, wait.agent_generation),
            object_ref=wait.checkpoint_object_ref,
        )
        assert selected is not None
        value = selected[1]
        if (
            not isinstance(value, dict)
            or set(value)
            != {
                "schema",
                "parent_node",
                "association_object_ref",
                "agent_generation",
                "backend_wait_event_id",
                "checkpoint",
            }
            or value
            != {
                "schema": "agent-checkpoint-v1",
                "parent_node": prepared.parent.model_dump(mode="json"),
                "association_object_ref": wait.association_object_ref,
                "agent_generation": wait.agent_generation,
                "backend_wait_event_id": wait.backend_wait_event_id,
                "checkpoint": value.get("checkpoint"),
            }
            or canonical_digest(value["checkpoint"]) != wait.checkpoint_digest
        ):
            raise BuilderExecutionPolicyError("native_agent_checkpoint_mismatch")
        self._agent_checkpoint_metadata(value["checkpoint"], association, wait.agent_generation)
        return value["checkpoint"]

    def load_agent_association(
        self, *, ref: NativeTestContextRef, parent_node: AgentParentNodeRef, wait: AgentWaitAssociation | None = None
    ) -> AgentProtectedState:
        """Read owned material only; absence refuses and never implies resume/terminal proof."""
        with _agent_boundary():
            prepared = self._agent_prepare(ref=ref, parent_node=parent_node, writing=False)
            if wait is None:
                selected = self._agent_object(prepared, logical_key=self._agent_key("agent-bind", prepared.parent))
                assert selected is not None
                association_ref = selected[0].id
            else:
                wait = AgentWaitAssociation.model_validate(wait.model_dump(mode="json"))
                association_ref = wait.association_object_ref
            association = self._agent_binding(prepared, association_ref)
            checkpoint = None if wait is None else self._agent_wait_relation(prepared, association, wait)
            final = self._agent_object(
                prepared, logical_key=self._agent_key("agent-final", prepared.parent), required=False
            )
            terminal_ref, terminal = None, None
            if final is not None:
                final_value = final[1]
                if (
                    not isinstance(final_value, dict)
                    or set(final_value)
                    != {
                        "schema",
                        "parent_node",
                        "association_object_ref",
                        "agent_generation",
                        "backend_terminal_event_id",
                        "terminal_result",
                    }
                    or final_value.get("schema") != "agent-final-v1"
                    or final_value.get("parent_node") != prepared.parent.model_dump(mode="json")
                    or final_value.get("association_object_ref") != association_ref
                ):
                    raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
                TypeAdapter(Counter).validate_python(final_value["agent_generation"])
                TypeAdapter(ID).validate_python(final_value["backend_terminal_event_id"])
                terminal_ref, terminal = final[0].id, final_value["terminal_result"]
            with self.loader.locked(ref=ref) as (session, owned, scope):
                self._agent_recheck(session, owned, scope, prepared, writing=False)
            return AgentProtectedState(
                association_object_ref=association_ref,
                association=association,
                wait=wait,
                checkpoint=checkpoint,
                terminal_result_ref=terminal_ref,
                terminal_result=terminal,
            )

    def store_agent_final(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        association_object_ref: str,
        agent_generation: int,
        terminal_result: JsonValue,
        backend_terminal_event_id: str,
    ) -> str:
        """Private terminal bytes reference, not verified terminal/physical cleanup proof.

        The later actual backend producer must verify terminal state first. This
        record never settles C02 or releases capacity and has no installed caller.
        """
        with _agent_boundary():
            generation = TypeAdapter(Counter).validate_python(agent_generation)
            event_id = TypeAdapter(ID).validate_python(backend_terminal_event_id)
            prepared = self._agent_prepare(ref=ref, parent_node=parent_node, writing=True)
            self._agent_binding(prepared, association_object_ref)
            value = {
                "schema": "agent-final-v1",
                "parent_node": prepared.parent.model_dump(mode="json"),
                "association_object_ref": association_object_ref,
                "agent_generation": generation,
                "backend_terminal_event_id": event_id,
                "terminal_result": _JSON.validate_python(terminal_result),
            }
            return self._agent_ack(prepared, logical_key=self._agent_key("agent-final", prepared.parent), value=value)

    def _agent_checkpoint_preparations(
        self, ref: NativeTestContextRef, payload: NativeCheckpointPayload
    ) -> list[_AgentPreparation]:
        """Resolve all selected private references outside the later SQL-only recheck.

        This cannot certify backend ACK or authorize generic restoration. The
        existing claimed-C03/current-run handoff remains the actual resume gate.
        """
        preparations = []
        for wait in payload.agent_associations:
            prepared = self._agent_prepare(ref=ref, parent_node=wait.parent_node, writing=False)
            if (
                payload.native_run_id != prepared.context.native_run_id
                or payload.generation > prepared.context.generation
            ):
                raise BuilderExecutionPolicyError("native_generation_conflict")
            association = self._agent_binding(prepared, wait.association_object_ref)
            self._agent_wait_relation(prepared, association, wait)
            preparations.append(prepared)
        return preparations

    def _agent_single_parent(self, session, context: ResolvedNativeTestContext, parent: AgentParentNodeRef) -> None:
        """Temporary one-workspace limitation: never share it with a distinct occurrence."""
        expected = self._agent_key("agent-config", parent)
        keys = session.scalars(
            owner_query(NativePayloadObject, context.ref, context.tenant_id)
            .with_only_columns(NativePayloadObject.logical_key)
            .where(
                NativePayloadObject.kind == "result",
                NativePayloadObject.logical_key.like("agent-config:%"),
                NativePayloadObject.logical_key != expected,
            )
            .limit(1)
        )
        for key in keys:
            if type(key) is not str:
                raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
            if key.startswith("agent-config:") and key != expected:
                raise BuilderExecutionPolicyError("native_agent_single_workspace_limit")
