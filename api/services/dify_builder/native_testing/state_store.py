"""Protected native snapshots with a storage-readback + SQL acknowledgement barrier.

The native adapter owns serialization. This owner stores immutable bytes, never
runs Graphon, and never treats a caller's object reference as authorization.
All key-provider and object-storage work happens outside SQL transactions.
"""

import json
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

from pydantic import TypeAdapter
from sqlalchemy import select

from core.helper import encrypter
from extensions.ext_storage import storage
from models.dify_builder import DifyBuilderTestInput
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeEffectOperation,
    NativeInvocationState,
    NativePayloadObject,
)
from models.workflow import Workflow
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.contracts import (
    CheckpointRef,
    FiniteJSON,
    JsonValue,
    NativeTestContextRef,
    OperationKey,
    operation_digest,
)
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader, native_workflow_revision, utc_now
from services.dify_builder.native_testing.runtime_contracts import NativeCheckpointPayload, ResolvedNativeTestContext

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


class NativeExecutionStateStore:
    def __init__(self, loader: OwnedNativeTestLoader):
        self.loader = loader

    def prepare_object(
        self, *, ref: NativeTestContextRef, tenant_id: str, kind: PayloadKind, logical_key: str, payload: JsonValue
    ) -> ObjectReceipt:
        """Internal producer port: caller must subsequently acknowledge under the root lock."""
        raw, digest = encode_payload(
            tenant_id=tenant_id, request_id=ref.request_id, invocation_id=ref.invocation_id, kind=kind, payload=payload
        )
        identity = str(uuid4())
        key = f"builder-native/{identity}"
        encrypted = encrypter.encrypt_token(tenant_id, raw).encode("ascii")
        storage.save(key, encrypted)
        roundtrip = encrypter.decrypt_token(tenant_id, storage.load(key).decode("ascii"))
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
    def _read_object(row: NativePayloadObject) -> JsonValue:
        try:
            raw = encrypter.decrypt_token(row.tenant_id, storage.load(row.storage_key).decode("ascii"))
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
        if recovery:
            with self.loader.session_factory() as session:
                owned, scope = self.loader._load(session, ref=ref, lock=False, settlement=True)
                if scope.cancelled:
                    raise BuilderExecutionPolicyError("native_cancelled")
        else:
            owned = self.loader.load(ref=ref)
        if owned.expires_at <= utc_now():
            raise BuilderExecutionPolicyError("native_expired")
        with self.loader.session_factory() as session:
            state = invocation_state(session, ref, owned.tenant_id)
            row = session.scalar(
                owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                    NativePayloadObject.id == state.context_object_id, NativePayloadObject.kind == "context"
                )
            )
            generation = state.generation
        if row is None:
            raise BuilderExecutionPolicyError("native_state_unavailable")
        context = ResolvedNativeTestContext.model_validate(self._read_object(row))
        if context.ref != ref or (context.tenant_id, context.actor_id) != (owned.tenant_id, owned.actor_id):
            raise BuilderExecutionPolicyError("native_context_mismatch")
        # Child refs share the root request, but their own workflow/permission
        # metadata must still be current. No resolved variables or secrets.
        from services.dify_builder.execution_policy_service import check_execution_permission

        with self.loader.session_factory() as session:
            workflow = session.scalar(
                select(Workflow).where(
                    Workflow.id == context.workflow_id,
                    Workflow.tenant_id == owned.tenant_id,
                    Workflow.app_id == context.app_id,
                )
            )
            if workflow is None or native_workflow_revision(workflow) != context.graph_revision:
                raise BuilderExecutionPolicyError("native_revision_drift")
            if context.parent_invocation_id is None:
                inputs = session.get(DifyBuilderTestInput, owned.test_input_id)
                if inputs is None or canonical_digest(inputs.inputs) != context.input_revision:
                    raise BuilderExecutionPolicyError("native_input_drift")
        check_execution_permission(self.loader.actor, context.app_id, self.loader.session_factory)
        return context.model_copy(update={"generation": generation})

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
                payload=payload.model_dump(mode="json"),
            )
            with self.loader.locked(ref=ref) as (session, owned, _):
                state = invocation_state(session, ref, owned.tenant_id)
                if state.generation != generation or state.state not in {"running", "waiting"}:
                    raise BuilderExecutionPolicyError("native_generation_conflict")
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
        owned = self.loader.load(ref=ref)
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
        return NativeCheckpointPayload.model_validate(self._read_object(row))

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
        receipt = self.prepare_object(
            ref=ref, tenant_id=owned.tenant_id, kind="result", logical_key=logical_key, payload=result
        )
        with self.loader.locked(ref=ref, settlement=spent) as (session, _, _):
            row = self.acknowledge_object(session, receipt)
            result_ref = row.id
        return result_ref

    def load_result(self, *, ref: NativeTestContextRef, result_ref: str) -> JsonValue:
        # Completed children remain readable, but tenant/actor lineage and current
        # read permission are still checked. This path never grants new dispatch.
        from services.dify_builder.execution_policy_service import check_execution_permission

        with self.loader.session_factory() as session:
            owned, _ = self.loader._load(session, ref=ref, lock=False, settlement=True)
            row = session.scalar(
                owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                    NativePayloadObject.id == result_ref, NativePayloadObject.kind == "result"
                )
            )
        check_execution_permission(self.loader.actor, owned.app_id, self.loader.session_factory)
        if row is None:
            raise BuilderExecutionPolicyError("native_result_owner_mismatch")
        return self._read_object(row)
