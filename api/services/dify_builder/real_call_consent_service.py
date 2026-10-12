"""Durable one-shot human consent for one real Builder Tool call.

This owner persists decisions and spends only. It never decrypts, refreshes or
invokes a credential, calls a provider, enqueues work or fabricates native Run
proof; the native Tool boundary consumes it through ``ServiceConfirmedToolGuard``
and the reserved-command Run/sealing path (Task 6) through ``claim_tool`` and
``finish``.

Transactions
------------
External policy reads (enterprise permission, installed plugin metadata and
verification) run first, outside any transaction; SQL never waits on them and
any failure refuses. Each mutating transaction then locks rows in the feature
order: session → app → workflow → test input → selected credential → OAuth
tenant then system clients (ID order) → consent → execution request. Within it
the local owner chain, effective credential access and the full native-owner
``CredentialReference`` are re-read authoritatively and compared exactly.

The session row lock is taken before the atomic launch reservation, which
commits the stable command, the execution sidecar, the session commit and the
consent reference in one transaction. The Redis advance lock and the single
enqueue stay with the caller's existing dispatch owner: acquire that lock
before ``reserve_execution``, release it on refusal, and enqueue exactly once
only when the returned flag is ``True``. A replayed request never relaunches.

Launch linkage for that dispatch owner and the worker (in-process only):
``replay_execution`` answers a matching duplicate while the lease is held
(no lock or write), ``reserved_launch`` reloads the unlaunched reserved
command from its sidecar and lineage, ``settle_launch`` closes a grant from
the launch's own sealed proof and ``observe_stranded``/``reconcile_stranded``
close exactly the grants a stale-session sweep observed before its lease
check; none of them reserves, claims or resets a counter.

Lifecycle
---------
``prepared`` → ``confirmed`` | ``declined``; a confirmed grant is reserved once
(state stays ``confirmed`` with a command) and then ``claimed`` by the Tool
node. Before that claim, a changed scope becomes ``invalidated`` and expiry
``expired``. After it, a known pre-phase denial becomes ``failed`` while any
unresolved spent phase becomes ``unknown``, which is final. Expiry blocks new
phases, not recording an outcome. A successful or declared-failed outcome is a
candidate that stays ``claimed`` until native Run proof seals it (Task 6).

Receipts carry fixed reason codes only; credential revisions, ciphertext and
message content never leave this module.
"""

import hmac
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from itertools import starmap
from typing import Any, Literal, cast
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy import and_, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.app_config.workflow_ui_based_app.variables.manager import WorkflowVariablesConfigManager
from core.app.apps.base_app_generator import BaseAppGenerator
from core.dify_builder import gmail_read_policy
from core.dify_builder.errors import ConflictError, NotFoundError
from core.dify_builder.execution_policy import (
    AdmittedNodeBinding,
    BuilderExecutionPolicyError,
    ConfirmedToolExecutionContext,
    canonical_digest,
    canonical_json,
    context_digest,
    scalar_inputs_digest,
    validate_execution_context,
)
from core.dify_builder.input_schema import schema_hash, start_schema
from core.dify_builder.models import Actor, DifyBuilderContext
from core.dify_builder.real_call_consent import (
    ActionOutcome,
    ConfirmedToolBinding,
    ConsentBinding,
    ConsentDisclosure,
    ConsentReceipt,
    ConsentState,
    CredentialReference,
    GmailReadParameters,
    InstalledToolBinding,
    Phase,
    confirmed_dispatch_headers,
    scope_digest,
    validate_phase,
    validate_scope,
)
from core.dify_builder.state import PcState, is_working
from core.plugin.plugin_service import PluginService
from libs.uuid_utils import uuidv7
from models.dify_builder import (
    DifyBuilderConversationItem,
    DifyBuilderExecutionRequest,
    DifyBuilderRealCallConsent,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
    DifyBuilderTestInput,
)
from models.model import App
from models.provider_ids import ToolProviderID
from models.tools import BuiltinToolProvider, ToolOAuthSystemClient, ToolOAuthTenantClient
from models.workflow import Workflow
from services.dify_builder import real_call_metadata
from services.dify_builder.execution_policy_service import (
    check_execution_permission,
    load_execution_owners,
    restricted_admission_snapshot,
)
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.revision import executable_graph_revision, execution_revision
from services.dify_builder.serde import context_from_dict
from services.tools.builtin_tools_manage_service import BuiltinToolManageService

__all__ = ["CONSENT_LIFETIME", "BuilderRealCallConsentService", "ServiceConfirmedToolGuard", "StrandedObservation"]

CONSENT_LIFETIME = timedelta(minutes=10)
POLICY_VERSION: Literal["builder-confirmed-gmail-read-v1"] = "builder-confirmed-gmail-read-v1"
DISCLOSURE_VERSION = "builder-gmail-get-message-disclosure-v1"

# A confirmed test starts only from a waiting gate that already runs tests, and
# moves to that mode's existing working state; plan/repair gates are not skipped.
_WORKING_STATE_FOR: dict[PcState, PcState] = {
    PcState.BUILD_AWAIT_TESTDATA: PcState.BUILD_TEST_AND_REPAIR,
    PcState.BUILD_REVIEW: PcState.BUILD_TEST_AND_REPAIR,
    PcState.EDIT_AWAIT_TESTDATA: PcState.EDIT_TEST_AFFECTED_PATHS,
    PcState.EDIT_REVIEW: PcState.EDIT_TEST_AFFECTED_PATHS,
    PcState.FIX_AWAIT_TESTDATA: PcState.FIX_VERIFY,
    PcState.FIX_AWAIT_VERIFY: PcState.FIX_VERIFY,
    PcState.FIX_AWAIT_DECISION: PcState.FIX_VERIFY,
}
_STATES = frozenset(
    {"prepared", "confirmed", "claimed", "completed", "failed", "unknown", "declined", "expired", "invalidated"}
)
_RETRYABLE = frozenset({"declined", "expired", "invalidated"})
_FINAL_OUTCOMES = frozenset({"completed", "failed", "unknown"})
_DIGEST = re.compile(r"[0-9a-f]{64}\Z")
_REASON = re.compile(r"[a-z][a-z0-9_]{0,127}\Z")


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _naive(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None)


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC)


def _refuse(reason: str) -> BuilderExecutionPolicyError:
    return BuilderExecutionPolicyError(reason)


def _canonical_uuid(value: object) -> bool:
    if type(value) is not str or len(value) != 36:
        return False
    try:
        return str(UUID(value)) == value
    except ValueError:
        return False


def _uuid(value: object, reason: str) -> str:
    if not _canonical_uuid(value):
        raise _refuse(reason)
    return cast(str, value)


def _bounded(value: object, reason: str) -> str:
    if type(value) is not str or not 1 <= len(value) <= 128:
        raise _refuse(reason)
    return value


def _version(value: object) -> int:
    if type(value) is not int or value < 1:
        raise _refuse("invalid_version")
    return value


def _digest(value: object) -> str:
    if type(value) is not str or _DIGEST.fullmatch(value) is None:
        raise _refuse("invalid_scope_digest")
    return value


def _same(left: str | None, right: str | None) -> bool:
    # Bytes, not str: compare_digest raises TypeError for non-ASCII strings; this fails closed instead.
    if type(left) is not str or type(right) is not str:
        return False
    return hmac.compare_digest(left.encode("utf-8", "surrogatepass"), right.encode("utf-8", "surrogatepass"))


def _json(value: object) -> bytes:
    """Stored records are JSON; strict datetime fields accept ISO strings only in JSON mode."""
    try:
        return canonical_json(value)
    except BuilderExecutionPolicyError:
        raise _refuse("consent_record_invalid") from None


def _secret_key() -> bytes:
    key = dify_config.SECRET_KEY
    if not isinstance(key, str) or not key:
        raise _refuse("invalid_scope_key")
    return key.encode()


def _require_enabled() -> None:
    # Backend rollout control only; it never qualifies an artifact.
    if dify_config.DIFY_BUILDER_CONFIRMED_TOOL_ENABLED is not True:
        raise _refuse("unsupported_action")


@dataclass(frozen=True)
class _External:
    """Installed metadata and server-resolved verification, read outside SQL."""

    installed: InstalledToolBinding
    verified_plugin: bool


def _read_external(tenant_id: str) -> _External:
    try:
        installed = real_call_metadata.resolve_installed_get_message(
            tenant_id=tenant_id, provider_id=gmail_read_policy.GMAIL_PROVIDER_ID
        )
        verified = PluginService.is_plugin_verified(tenant_id, installed.unique_identifier) is True
    except BuilderExecutionPolicyError:
        raise
    except Exception:
        # Unknown external policy fails closed without echoing transport text.
        raise _refuse("installed_tool_unavailable") from None
    return _External(installed=installed, verified_plugin=verified)


@dataclass(frozen=True)
class _SessionPart:
    prepared_commit_id: str
    interaction_id: str
    plan_identity: str
    prepared_version: int


@dataclass(frozen=True)
class _Current:
    binding: ConsentBinding
    admitted_nodes: tuple[AdmittedNodeBinding, ...]


@dataclass(frozen=True)
class _Owned:
    """Detached identifiers of one consent, read before the locked transaction."""

    consent_id: str
    app_id: str
    workflow_id: str
    session_id: str
    test_input_id: str
    credential_id: str
    confirm_key: str | None
    execute_key: str | None


@dataclass(frozen=True)
class _StrandedGrant:
    """One reserved grant's identity and full spend/launch generation, detached from its rows."""

    consent_id: str
    command_id: str | None
    execution_request_id: str | None
    state: str
    reserved_version: int | None
    reserved_commit_id: str | None
    claimed_at: datetime | None
    refresh_claimed_at: datetime | None
    business_claimed_at: datetime | None
    refresh_count: int
    business_count: int
    derived_credential_revision: str | None
    consent_native_run_id: str | None
    native_node_execution_id: str | None
    outcome_state: str | None
    reason_code: str | None
    request_state: str | None
    native_run_id: str | None
    task_id: str | None
    completion_fingerprint: str | None
    sealed_at: datetime | None

    @classmethod
    def of(cls, row: DifyBuilderRealCallConsent, request: DifyBuilderExecutionRequest | None) -> "_StrandedGrant":
        return cls(
            consent_id=row.id,
            command_id=row.command_id,
            execution_request_id=row.execution_request_id,
            state=row.state,
            reserved_version=row.reserved_version,
            reserved_commit_id=row.reserved_commit_id,
            claimed_at=row.claimed_at,
            refresh_claimed_at=row.refresh_claimed_at,
            business_claimed_at=row.business_claimed_at,
            refresh_count=row.refresh_count,
            business_count=row.business_count,
            derived_credential_revision=row.derived_credential_revision,
            consent_native_run_id=row.native_run_id,
            native_node_execution_id=row.native_node_execution_id,
            outcome_state=row.outcome_state,
            reason_code=row.reason_code,
            request_state=request.state if request is not None else None,
            native_run_id=request.native_run_id if request is not None else None,
            task_id=request.task_id if request is not None else None,
            completion_fingerprint=request.completion_fingerprint if request is not None else None,
            sealed_at=request.sealed_at if request is not None else None,
        )


@dataclass(frozen=True)
class StrandedObservation:
    """A stale session's reserved grants as the sweeper saw them before its lease check."""

    session_id: str
    session_version: int
    grants: tuple[_StrandedGrant, ...]


def _state(row: DifyBuilderRealCallConsent) -> ConsentState:
    if row.state not in _STATES:
        raise _refuse("consent_record_invalid")
    return cast(ConsentState, row.state)


def _stored_binding(row: DifyBuilderRealCallConsent) -> ConsentBinding:
    try:
        return ConsentBinding.model_validate_json(_json(row.binding))
    except ValidationError:
        raise _refuse("consent_record_invalid") from None


def _owned(row: DifyBuilderRealCallConsent) -> _Owned:
    binding = _stored_binding(row)
    return _Owned(
        consent_id=row.id,
        app_id=row.app_id,
        workflow_id=row.workflow_id,
        session_id=row.session_id,
        test_input_id=row.test_input_id,
        credential_id=binding.credential.credential_id,
        confirm_key=row.confirm_key,
        execute_key=row.execute_key,
    )


def _receipt(row: DifyBuilderRealCallConsent, now: datetime) -> ConsentReceipt:
    """Current public receipt; an unclaimed grant past expiry reads as expired."""
    state = _state(row)
    reason = row.reason_code
    if state in ("prepared", "confirmed") and row.claimed_at is None and now >= _aware(row.expires_at):
        state, reason = "expired", reason or "consent_expired"
    refresh, business = row.refresh_claimed_at is not None, row.business_claimed_at is not None
    if canonical_digest(row.disclosure) != row.disclosure_digest:
        raise _refuse("consent_record_invalid")
    try:
        return ConsentReceipt(
            consent_id=row.id,
            scope_digest=row.scope_digest,
            state=state,
            at_version=row.reserved_version if row.reserved_version is not None else row.prepared_version,
            disclosure=ConsentDisclosure.model_validate_json(_json(row.disclosure)),
            command_id=row.command_id,
            execution_request_id=row.execution_request_id,
            native_run_id=row.native_run_id,
            native_node_execution_id=row.native_node_execution_id,
            reason_code=reason,
            refresh_claimed=refresh,
            business_claimed=business,
            can_retry=row.command_id is None and not (refresh or business) and state in _RETRYABLE,
        )
    except ValidationError:
        raise _refuse("consent_record_invalid") from None


def _saved(receipt: dict[str, Any] | None) -> ConsentReceipt:
    try:
        return ConsentReceipt.model_validate_json(_json(receipt))
    except ValidationError:
        raise _refuse("consent_record_invalid") from None


def _post_claim_failure(row: DifyBuilderRealCallConsent) -> str:
    """A spent phase whose effect is unresolved is unknown; otherwise the denial is known."""
    refresh_unresolved = row.refresh_claimed_at is not None and row.derived_credential_revision is None
    business_unresolved = row.business_claimed_at is not None and row.outcome_state is None
    return "unknown" if refresh_unresolved or business_unresolved else "failed"


def _effective_inputs(workflow: Workflow, inputs: dict[str, Any], tenant_id: str) -> dict[str, Any]:
    try:
        return dict(
            BaseAppGenerator()._prepare_user_inputs(
                user_inputs=inputs,
                variables=WorkflowVariablesConfigManager.convert(workflow),
                tenant_id=tenant_id,
            )
        )
    except (ValueError, TypeError):
        raise _refuse("unsupported_input_value") from None


def _lock_owner_rows(
    db: Session,
    *,
    tenant_id: str,
    session_id: str,
    app_id: str,
    workflow_id: str,
    test_input_id: str,
    credential_id: str,
) -> DifyBuilderSession:
    """Lock the owner rows in the feature order; the caller then locks consent → request."""
    session_row = db.scalar(select(DifyBuilderSession).where(DifyBuilderSession.id == session_id).with_for_update())
    if session_row is None:
        raise _refuse("execution_owner_mismatch")
    db.execute(select(App.id).where(App.id == app_id).with_for_update())
    db.execute(select(Workflow.id).where(Workflow.id == workflow_id).with_for_update())
    db.execute(select(DifyBuilderTestInput.id).where(DifyBuilderTestInput.id == test_input_id).with_for_update())
    db.execute(
        select(BuiltinToolProvider.id)
        .where(BuiltinToolProvider.id == credential_id, BuiltinToolProvider.tenant_id == tenant_id)
        .with_for_update()
    )
    provider = ToolProviderID(gmail_read_policy.GMAIL_PROVIDER_ID)
    db.execute(
        select(ToolOAuthTenantClient.id)
        .where(
            ToolOAuthTenantClient.tenant_id == tenant_id,
            ToolOAuthTenantClient.plugin_id == provider.plugin_id,
            ToolOAuthTenantClient.provider == provider.provider_name,
        )
        .order_by(ToolOAuthTenantClient.id)
        .with_for_update()
    )
    db.execute(
        select(ToolOAuthSystemClient.id)
        .where(
            ToolOAuthSystemClient.plugin_id == provider.plugin_id,
            ToolOAuthSystemClient.provider == provider.provider_name,
        )
        .order_by(ToolOAuthSystemClient.id)
        .with_for_update()
    )
    return session_row


def _lock_consent(db: Session, consent_id: str) -> DifyBuilderRealCallConsent:
    row = db.scalar(
        select(DifyBuilderRealCallConsent).where(DifyBuilderRealCallConsent.id == consent_id).with_for_update()
    )
    if row is None:
        raise _refuse("consent_not_found")
    return row


def _lock_request(db: Session, request_id: str | None) -> DifyBuilderExecutionRequest:
    if request_id is None:
        raise _refuse("execution_request_mismatch")
    row = db.scalar(
        select(DifyBuilderExecutionRequest).where(DifyBuilderExecutionRequest.id == request_id).with_for_update()
    )
    if row is None:
        raise _refuse("execution_request_mismatch")
    return row


def _latest_commit(db: Session, session_row: DifyBuilderSession) -> DifyBuilderSessionCommit:
    commit = db.scalar(
        select(DifyBuilderSessionCommit).where(
            DifyBuilderSessionCommit.session_id == session_row.id,
            DifyBuilderSessionCommit.version == session_row.version,
        )
    )
    if commit is None:
        raise _refuse("session_state_unavailable")
    return commit


def _context_of(commit: DifyBuilderSessionCommit) -> DifyBuilderContext:
    try:
        return context_from_dict(commit.context)
    except (TypeError, ValueError, KeyError):
        raise _refuse("session_state_unavailable") from None


def _session_part(db: Session, session_row: DifyBuilderSession) -> tuple[_SessionPart, DifyBuilderContext]:
    """Server-derived interaction identity of the current committed session version."""
    commit = _latest_commit(db, session_row)
    fc = _context_of(commit)
    latest_item = db.scalar(
        select(DifyBuilderConversationItem.id)
        .where(DifyBuilderConversationItem.session_id == session_row.id)
        .order_by(DifyBuilderConversationItem.seq.desc())
        .limit(1)
    )
    plan = canonical_digest(
        {
            "plan_version_tag": fc.plan_version_tag,
            "plan_items": fc.plan_items,
            "resource_selection": fc.resource_selection,
        }
    )
    part = _SessionPart(
        prepared_commit_id=commit.id,
        interaction_id=latest_item or commit.id,
        plan_identity=plan,
        prepared_version=session_row.version,
    )
    return part, fc


def _working_state(session_row: DifyBuilderSession, fc: DifyBuilderContext) -> PcState:
    try:
        state = PcState(session_row.current_state)
    except ValueError:
        raise _refuse("unsupported_session_state") from None
    working = _WORKING_STATE_FOR.get(state)
    if working is None or fc.paused or fc.recovery_class or fc.staged_repair:
        raise _refuse("unsupported_session_state")
    return working


def _stored_part(binding: ConsentBinding) -> _SessionPart:
    return _SessionPart(
        prepared_commit_id=binding.prepared_commit_id,
        interaction_id=binding.interaction_id,
        plan_identity=binding.plan_identity,
        prepared_version=binding.prepared_version,
    )


def _current(
    db: Session,
    *,
    actor: Actor,
    app_id: str,
    workflow_id: str,
    session_id: str,
    test_input_id: str,
    node_id: str,
    credential_id: str,
    external: _External,
    part: _SessionPart,
    expires_at: datetime,
    key: bytes,
) -> _Current:
    """Rebuild the complete binding from authoritative rows in the caller's locked transaction."""
    owner = load_execution_owners(
        db,
        app_id=app_id,
        actor=actor,
        workflow_id=workflow_id,
        session_id=session_id,
        test_input_id=test_input_id,
    )
    # Raw metadata refusal precedes any revision function that could resolve secrets.
    snapshot = restricted_admission_snapshot(owner.workflow, owner.app)
    admission = gmail_read_policy.admit_get_message_workflow(snapshot)
    if admission.tool_node_id != node_id:
        raise _refuse("unsupported_tool_node")
    if admission.credential_id != credential_id:
        raise _refuse("credential_binding_mismatch")
    if admission.plugin_unique_identifier not in (None, external.installed.unique_identifier):
        raise _refuse("installed_tool_unavailable")
    test_input = owner.test_input
    if (
        test_input is None
        or test_input.http_fixtures is not None
        or test_input.start_schema_hash != schema_hash(start_schema(snapshot.graph))
    ):
        raise _refuse("unsupported_test_input")
    submitted = scalar_inputs_digest(test_input.inputs)
    effective = scalar_inputs_digest(_effective_inputs(owner.workflow, test_input.inputs, actor.tenant_id))
    # Full native-owner reference: row primitive plus the actor's effective access.
    reference = BuiltinToolManageService.resolve_builder_reference(
        db=db,
        actor=actor,
        provider_id=admission.provider_id,
        credential_id=credential_id,
        verified_plugin=external.verified_plugin,
        revision_key=key,
    )
    gmail_read_policy.get_message_envelope(
        installed=external.installed, credential=reference, parameters=admission.parameters
    )
    tool = admission.nodes[1]
    try:
        binding = ConsentBinding(
            tenant_id=actor.tenant_id,
            app_id=owner.app.id,
            workflow_id=owner.workflow.id,
            actor_id=actor.account_id,
            session_id=session_id,
            prepared_commit_id=part.prepared_commit_id,
            interaction_id=part.interaction_id,
            plan_identity=part.plan_identity,
            test_input_id=test_input.id,
            execution_revision=execution_revision(owner.workflow),
            graph_revision=executable_graph_revision(snapshot.graph),
            submitted_inputs_digest=submitted,
            effective_inputs_digest=effective,
            node_id=node_id,
            node_implementation=tool.implementation,
            node_config_digest=tool.normalized_config_digest,
            policy_version=POLICY_VERSION,
            disclosure_version=DISCLOSURE_VERSION,
            prepared_version=part.prepared_version,
            installed=external.installed,
            credential=reference,
            parameters=admission.parameters,
            expires_at=expires_at,
        )
    except ValidationError:
        raise _refuse("consent_binding_invalid") from None
    return _Current(binding=binding, admitted_nodes=admission.nodes)


def _execute_body_digest(actor: Actor, session_id: str, consent_id: str, scope: str, at_version: int) -> str:
    return canonical_digest(
        {
            "operation": "execute",
            "tenant_id": actor.tenant_id,
            "actor_id": actor.account_id,
            "session_id": session_id,
            "consent_id": consent_id,
            "scope_digest": scope,
            "at_version": at_version,
        }
    )


def _settled_state(row: DifyBuilderRealCallConsent, request: DifyBuilderExecutionRequest, now: datetime) -> str | None:
    """Final state for a reserved grant whose launch ended or stranded; ``None`` leaves it as is.

    Before any claim nothing was spent: expiry or a launch that never claimed is
    a known failure. After a claim, completion needs the sidecar's sealed
    confirmed-completed summary for this exact Run; a recorded declared failure
    stays failed; anything else (unresolved phase, stranded pre-retention claim,
    unknown outcome) is unknown. Counters are never touched.
    """
    state = _state(row)
    if state not in ("confirmed", "claimed") or row.command_id is None:
        return None
    if row.claimed_at is None:
        return "expired" if now >= _aware(row.expires_at) else "failed"
    summary = request.completion_summary if request.state == "sealed" else None
    sealed_completed = (
        isinstance(summary, dict)
        and summary.get("safety_outcome") == "confirmed_tool_completed"
        and summary.get("sealed") is True
        and summary.get("consent_id") == row.id
        and summary.get("native_run_id") is not None
        and summary.get("native_run_id") == row.native_run_id == request.native_run_id
    )
    if row.outcome_state == "completed" and sealed_completed:
        return "completed"
    refresh_unresolved = row.refresh_claimed_at is not None and row.derived_credential_revision is None
    if row.outcome_state == "failed" and not refresh_unresolved:
        return "failed"
    return "unknown"


def _verify_context(context: object) -> ConfirmedToolExecutionContext:
    if not isinstance(context, ConfirmedToolExecutionContext):
        raise _refuse("invalid_execution_context")
    # Revalidate even a model_copy/model_construct crossing the in-process boundary.
    checked = validate_execution_context(context.model_dump(mode="json"))
    if not isinstance(checked, ConfirmedToolExecutionContext) or checked != context:
        raise _refuse("invalid_execution_context")
    return checked


def _verify_binding(binding: object) -> ConfirmedToolBinding:
    if not isinstance(binding, ConfirmedToolBinding):
        raise _refuse("invalid_tool_binding")
    try:
        checked = ConfirmedToolBinding.model_validate(binding.model_dump(mode="json"))
    except ValidationError:
        raise _refuse("invalid_tool_binding") from None
    if checked != binding:
        raise _refuse("invalid_tool_binding")
    _verify_context(binding.context)
    return checked


def _verify_launch(
    row: DifyBuilderRealCallConsent,
    request: DifyBuilderExecutionRequest,
    context: ConfirmedToolExecutionContext,
    *,
    node_id: str,
    native_run_id: str,
) -> ConsentBinding:
    """The reserved sidecar, its launched native Run and this consent must agree exactly."""
    if (
        request.context != context.model_dump(mode="json")
        or not _same(request.context_digest, context.context_digest)
        or (request.tenant_id, request.app_id, request.workflow_id, request.actor_id, request.session_id)
        != (context.tenant_id, context.app_id, context.workflow_id, context.actor_id, context.session_id)
        or request.test_input_id != context.test_input_id
    ):
        raise _refuse("execution_request_mismatch")
    if (
        row.id != context.consent_id
        or row.command_id != context.command_id
        or row.execution_request_id != context.request_id
        or not _same(row.scope_digest, context.scope_digest)
        or (row.tenant_id, row.app_id, row.workflow_id, row.actor_id, row.session_id, row.test_input_id)
        != (
            context.tenant_id,
            context.app_id,
            context.workflow_id,
            context.actor_id,
            context.session_id,
            context.test_input_id,
        )
    ):
        raise _refuse("execution_request_mismatch")
    # Only the launched native Run of this reserved command may claim it.
    if request.state != "running" or request.native_run_id is None or request.native_run_id != native_run_id:
        raise _refuse("execution_launch_mismatch")
    stored = _stored_binding(row)
    if stored.node_id != node_id:
        raise _refuse("unsupported_tool_node")
    return stored


def _verify_claimed(row: DifyBuilderRealCallConsent, binding: ConfirmedToolBinding) -> None:
    if (
        row.claimed_at is None
        or row.native_run_id != binding.native_run_id
        or row.native_node_execution_id != binding.native_node_execution_id
    ):
        raise _refuse("execution_launch_mismatch")


def _require_command_lineage(db: Session, row: DifyBuilderRealCallConsent, session_row: DifyBuilderSession) -> None:
    """Only commits of the reserved command itself may follow the reservation."""
    if row.reserved_version is None or session_row.version < row.reserved_version:
        raise _refuse("command_lineage_changed")
    reserved = db.scalar(
        select(DifyBuilderSessionCommit.id).where(
            DifyBuilderSessionCommit.session_id == session_row.id,
            DifyBuilderSessionCommit.version == row.reserved_version,
        )
    )
    if reserved is None or reserved != row.reserved_commit_id:
        raise _refuse("command_lineage_changed")
    latest = _context_of(_latest_commit(db, session_row))
    # The latest commit must still belong to this command and carry its exact consent reference.
    if (latest.last_command_id, latest.confirmed_command_id, latest.confirmed_consent_id) != (
        row.command_id,
        row.command_id,
        row.id,
    ):
        raise _refuse("command_lineage_changed")


class BuilderRealCallConsentService:
    """Prepare, decide, reserve and spend one consented real Tool call."""

    def __init__(self, session_factory: sessionmaker[Session]):
        self._session_factory = session_factory

    # -- public decisions ----------------------------------------------------

    def prepare(
        self,
        *,
        actor: Actor,
        session_id: str,
        node_id: str,
        test_input_id: str,
        credential_id: str,
        at_version: int,
        base_app_revision: str,
        idempotency_key: str,
    ) -> ConsentReceipt:
        """Freeze the exact binding and disclosure. Metadata reads only; nothing runs."""
        _require_enabled()
        key = _secret_key()
        idempotency_key = _bounded(idempotency_key, "invalid_idempotency_key")
        at_version = _version(at_version)
        session_id = _uuid(session_id, "execution_owner_mismatch")
        test_input_id = _uuid(test_input_id, "execution_owner_mismatch")
        credential_id = _uuid(credential_id, "credential_reference_unavailable")
        node_id = _bounded(node_id, "unsupported_tool_node")
        # Native execution revisions are lowercase SHA-256 hex; anything else is stale, refused before SQL.
        if type(base_app_revision) is not str or _DIGEST.fullmatch(base_app_revision) is None:
            raise _refuse("stale_app_revision")
        body_digest = canonical_digest(
            {
                "operation": "prepare",
                "tenant_id": actor.tenant_id,
                "actor_id": actor.account_id,
                "session_id": session_id,
                "node_id": node_id,
                "test_input_id": test_input_id,
                "credential_id": credential_id,
                "at_version": at_version,
                "base_app_revision": base_app_revision,
            }
        )
        app_id, workflow_id = self._owned_session(actor, session_id)
        check_execution_permission(actor, app_id, self._session_factory)
        replay = self._prepare_replay(actor, session_id, idempotency_key, body_digest)
        if replay is not None:
            return replay
        external = _read_external(actor.tenant_id)
        now = _utcnow()
        expires_at = now + CONSENT_LIFETIME
        try:
            with self._session_factory.begin() as db:
                session_row = _lock_owner_rows(
                    db,
                    tenant_id=actor.tenant_id,
                    session_id=session_id,
                    app_id=app_id,
                    workflow_id=workflow_id,
                    test_input_id=test_input_id,
                    credential_id=credential_id,
                )
                if session_row.version != at_version:
                    raise _refuse("stale_session_version")
                part, fc = _session_part(db, session_row)
                _working_state(session_row, fc)
                current = _current(
                    db,
                    actor=actor,
                    app_id=app_id,
                    workflow_id=workflow_id,
                    session_id=session_id,
                    test_input_id=test_input_id,
                    node_id=node_id,
                    credential_id=credential_id,
                    external=external,
                    part=part,
                    expires_at=expires_at,
                    key=key,
                )
                if not _same(base_app_revision, current.binding.execution_revision):
                    raise _refuse("stale_app_revision")
                binding = current.binding
                disclosure = gmail_read_policy.get_message_disclosure(
                    credential=binding.credential,
                    parameters=binding.parameters,
                    expires_at=expires_at,
                    prior_uncertain_consent_id=self._prior_uncertain(db, actor, session_id),
                )
                disclosure_json = disclosure.model_dump(mode="json")
                row = DifyBuilderRealCallConsent(
                    id=str(uuidv7()),
                    tenant_id=actor.tenant_id,
                    app_id=binding.app_id,
                    workflow_id=binding.workflow_id,
                    actor_id=actor.account_id,
                    session_id=session_id,
                    prepared_commit_id=part.prepared_commit_id,
                    test_input_id=test_input_id,
                    prepared_version=part.prepared_version,
                    binding=binding.model_dump(mode="json"),
                    scope_digest=scope_digest(binding, key=key),
                    disclosure=disclosure_json,
                    disclosure_digest=canonical_digest(disclosure_json),
                    expires_at=_naive(expires_at),
                    state="prepared",
                    prepare_key=idempotency_key,
                    prepare_body_digest=body_digest,
                    prepare_receipt={},
                    refresh_count=0,
                    business_count=0,
                    initial_credential_revision=binding.credential.revision,
                    oauth_client_revision=binding.credential.oauth_client_revision,
                )
                receipt = _receipt(row, now)
                row.prepare_receipt = receipt.model_dump(mode="json")
                db.add(row)
                db.flush()
        except IntegrityError:
            # A concurrent identical preparation won the unique key: replay it.
            replay = self._prepare_replay(actor, session_id, idempotency_key, body_digest)
            if replay is None:
                raise _refuse("idempotency_conflict") from None
            return replay
        return receipt

    def confirm(
        self,
        *,
        actor: Actor,
        session_id: str,
        consent_id: str,
        decision: Literal["confirm", "decline"],
        scope_digest: str,
        at_version: int,
        idempotency_key: str,
    ) -> ConsentReceipt:
        """Record one human decision. No provider call; an identical replay returns the saved receipt."""
        if decision not in ("confirm", "decline"):
            raise _refuse("invalid_decision")
        idempotency_key = _bounded(idempotency_key, "invalid_idempotency_key")
        at_version = _version(at_version)
        supplied_scope = _digest(scope_digest)
        if decision == "confirm":
            _require_enabled()
        body_digest = canonical_digest(
            {
                "operation": "confirm",
                "tenant_id": actor.tenant_id,
                "actor_id": actor.account_id,
                "session_id": session_id,
                "consent_id": consent_id,
                "decision": decision,
                "scope_digest": supplied_scope,
                "at_version": at_version,
            }
        )
        owned = self._owned_consent(actor, session_id, consent_id)
        check_execution_permission(actor, owned.app_id, self._session_factory)
        if owned.confirm_key is not None:
            return self._decision_replay(owned.consent_id, idempotency_key, body_digest)
        key = _secret_key() if decision == "confirm" else b""
        external = _read_external(actor.tenant_id) if decision == "confirm" else None
        pending: BuilderExecutionPolicyError | None = None
        receipt: ConsentReceipt | None = None
        with self._session_factory.begin() as db:
            session_row = _lock_owner_rows(
                db,
                tenant_id=actor.tenant_id,
                session_id=owned.session_id,
                app_id=owned.app_id,
                workflow_id=owned.workflow_id,
                test_input_id=owned.test_input_id,
                credential_id=owned.credential_id,
            )
            row = _lock_consent(db, owned.consent_id)
            # Fresh server time after every blocking lock: a lock wait cannot carry a decision past expiry.
            now = _utcnow()
            if row.confirm_key is not None:
                return self._replay_from(
                    row.confirm_key,
                    row.confirm_body_digest,
                    row.confirm_receipt,
                    idempotency_key,
                    body_digest,
                    other_key="consent_decision_conflict",
                )
            if not _same(supplied_scope, row.scope_digest):
                raise _refuse("consent_scope_mismatch")
            if at_version != row.prepared_version:
                raise _refuse("stale_consent_version")
            if _state(row) != "prepared":
                raise _refuse("consent_not_prepared")
            stored = _stored_binding(row)
            if now >= _aware(row.expires_at):
                row.state, row.reason_code = "expired", "consent_expired"
                pending = _refuse("consent_expired")
            elif session_row.version != row.prepared_version:
                row.state, row.reason_code = "invalidated", "session_advanced"
                pending = _refuse("consent_invalidated")
            elif decision == "confirm":
                assert external is not None
                try:
                    part, _fc = _session_part(db, session_row)
                    current = _current(
                        db,
                        actor=actor,
                        app_id=owned.app_id,
                        workflow_id=owned.workflow_id,
                        session_id=owned.session_id,
                        test_input_id=owned.test_input_id,
                        node_id=stored.node_id,
                        credential_id=owned.credential_id,
                        external=external,
                        part=part,
                        expires_at=stored.expires_at,
                        key=key,
                    )
                    validate_scope(stored, current.binding)
                    if not _same(_scope_of(stored, key), row.scope_digest):
                        raise _refuse("consent_scope_changed")
                except BuilderExecutionPolicyError as error:
                    row.state, row.reason_code = "invalidated", error.reason_code
                    pending = _refuse("consent_scope_changed")
            if pending is None:
                row.state = "confirmed" if decision == "confirm" else "declined"
                row.decision = decision
                receipt = _receipt(row, now)
                row.confirm_key, row.confirm_body_digest = idempotency_key, body_digest
                row.confirm_receipt = receipt.model_dump(mode="json")
        if pending is not None:
            raise pending
        assert receipt is not None
        return receipt

    def reserve_execution(
        self,
        *,
        actor: Actor,
        session_id: str,
        consent_id: str,
        scope_digest: str,
        at_version: int,
        idempotency_key: str,
    ) -> tuple[ConsentReceipt, bool]:
        """Commit the only launch reservation atomically; ``True`` only for the committing caller.

        The caller holds the session's advance lock and enqueues the returned
        command exactly once when the flag is ``True``. An identical replay,
        including after a lost enqueue acknowledgement, returns ``False`` with
        the CURRENT receipt of that same command/request (claimed, unknown, ...),
        not the stale reservation receipt; nothing here ever allocates a second
        command or request.

        The caller's bracket is the existing dispatch owner's duty, not this
        method's: acquire the session's Redis advance lock before calling,
        release it on refusal or ``False``, and enqueue exactly once only on
        ``True`` without re-acquiring the lock or re-running action preparation.
        A same-body replay arriving while the original lease is still held must
        be answered from this method's replay (no lock, reservation or enqueue).
        """
        _require_enabled()
        key = _secret_key()
        idempotency_key = _bounded(idempotency_key, "invalid_idempotency_key")
        at_version = _version(at_version)
        supplied_scope = _digest(scope_digest)
        body_digest = _execute_body_digest(actor, session_id, consent_id, supplied_scope, at_version)
        owned = self._owned_consent(actor, session_id, consent_id)
        check_execution_permission(actor, owned.app_id, self._session_factory)
        if owned.execute_key is not None:
            return self._execute_replay(owned.consent_id, idempotency_key, body_digest, _utcnow()), False
        external = _read_external(actor.tenant_id)
        pending: BuilderExecutionPolicyError | None = None
        receipt: ConsentReceipt | None = None
        with self._session_factory.begin() as db:
            # The existing session row lock precedes the atomic reservation.
            session_row = _lock_owner_rows(
                db,
                tenant_id=actor.tenant_id,
                session_id=owned.session_id,
                app_id=owned.app_id,
                workflow_id=owned.workflow_id,
                test_input_id=owned.test_input_id,
                credential_id=owned.credential_id,
            )
            row = _lock_consent(db, owned.consent_id)
            # Fresh server time after every blocking lock: a lock wait cannot carry a reservation past expiry.
            now = _utcnow()
            if row.execute_key is not None:
                return self._current_execute(row, idempotency_key, body_digest, now), False
            if not _same(supplied_scope, row.scope_digest):
                raise _refuse("consent_scope_mismatch")
            if at_version != row.prepared_version:
                raise _refuse("stale_consent_version")
            if _state(row) != "confirmed" or row.command_id is not None:
                raise _refuse("consent_not_confirmed")
            stored = _stored_binding(row)
            if now >= _aware(row.expires_at):
                row.state, row.reason_code = "expired", "consent_expired"
                pending = _refuse("consent_expired")
            elif session_row.version != row.prepared_version:
                row.state, row.reason_code = "invalidated", "session_advanced"
                pending = _refuse("consent_invalidated")
            if pending is None:
                part, fc = _session_part(db, session_row)
                working = _working_state(session_row, fc)
                try:
                    current = _current(
                        db,
                        actor=actor,
                        app_id=owned.app_id,
                        workflow_id=owned.workflow_id,
                        session_id=owned.session_id,
                        test_input_id=owned.test_input_id,
                        node_id=stored.node_id,
                        credential_id=owned.credential_id,
                        external=external,
                        part=part,
                        expires_at=stored.expires_at,
                        key=key,
                    )
                    validate_scope(stored, current.binding)
                    if not _same(_scope_of(stored, key), row.scope_digest):
                        raise _refuse("consent_scope_changed")
                except BuilderExecutionPolicyError as error:
                    row.state, row.reason_code = "invalidated", error.reason_code
                    pending = _refuse("consent_scope_changed")
                else:
                    receipt = self._reserve(db, row, stored, current, fc, working, now)
                    row.execute_key, row.execute_body_digest = idempotency_key, body_digest
                    row.execute_receipt = receipt.model_dump(mode="json")
        if pending is not None:
            raise pending
        assert receipt is not None
        return receipt, True

    def get(self, *, actor: Actor, session_id: str, consent_id: str) -> ConsentReceipt:
        """Current authorized receipt. Never executes anything."""
        owned = self._owned_consent(actor, session_id, consent_id)
        check_execution_permission(actor, owned.app_id, self._session_factory)
        with self._session_factory() as db:
            load_execution_owners(db, app_id=owned.app_id, actor=actor, session_id=owned.session_id)
            row = db.get(DifyBuilderRealCallConsent, owned.consent_id)
            if row is None or (row.tenant_id, row.actor_id, row.session_id) != (
                actor.tenant_id,
                actor.account_id,
                session_id,
            ):
                raise _refuse("consent_not_found")
            return _receipt(row, _utcnow())

    # -- launch linkage for the existing dispatch owner and worker (in-process) --

    def replay_execution(
        self,
        *,
        actor: Actor,
        session_id: str,
        consent_id: str,
        scope_digest: str,
        at_version: int,
        idempotency_key: str,
    ) -> ConsentReceipt | None:
        """Replay-only execute: the CURRENT receipt of an already saved identical execute, else ``None``.

        No lock, reservation or write. The dispatch owner calls this when the
        session's advance lease is held, so a matching duplicate is answered
        without reserving or enqueuing; a different key or body refuses.
        """
        idempotency_key = _bounded(idempotency_key, "invalid_idempotency_key")
        at_version = _version(at_version)
        supplied_scope = _digest(scope_digest)
        body_digest = _execute_body_digest(actor, session_id, consent_id, supplied_scope, at_version)
        owned = self._owned_consent(actor, session_id, consent_id)
        check_execution_permission(actor, owned.app_id, self._session_factory)
        if owned.execute_key is None:
            return None
        return self._execute_replay(owned.consent_id, idempotency_key, body_digest, _utcnow())

    def reserved_launch(
        self, *, actor: Actor, session_id: str, consent_id: str, command_id: str
    ) -> ConfirmedToolExecutionContext:
        """Reload the server-reserved, not yet launched command for this actor/session.

        The only source of a launchable context: the stored sidecar, verified
        against the consent row, the reserved command and the session's current
        commit lineage. A serialized payload, a duplicate delivery after the
        launch identity was claimed or any other command refuses. Read only;
        expiry and scope are decided again at ``claim_tool``.
        """
        _require_enabled()
        command_id = _uuid(command_id, "execution_launch_mismatch")
        owned = self._owned_consent(actor, session_id, consent_id)
        with self._session_factory() as db:
            row = db.get(DifyBuilderRealCallConsent, owned.consent_id)
            session_row = db.get(DifyBuilderSession, owned.session_id)
            if row is None or session_row is None or row.command_id is None:
                raise _refuse("execution_launch_mismatch")
            if not _same(row.command_id, command_id) or row.execution_request_id is None:
                raise _refuse("execution_launch_mismatch")
            if session_row.owner_account_id != actor.account_id or session_row.tenant_id != actor.tenant_id:
                raise _refuse("execution_owner_mismatch")
            request = db.get(DifyBuilderExecutionRequest, row.execution_request_id)
            if request is None:
                raise _refuse("execution_request_mismatch")
            if request.state != "prepared" or request.native_run_id is not None or row.claimed_at is not None:
                raise _refuse("execution_already_launched")
            if _state(row) != "confirmed":
                raise _refuse("consent_not_confirmed")
            context = validate_execution_context(request.context)
            if not isinstance(context, ConfirmedToolExecutionContext) or not _same(
                request.context_digest, context.context_digest
            ):
                raise _refuse("execution_request_mismatch")
            if (
                context.consent_id != row.id
                or context.command_id != row.command_id
                or context.request_id != row.execution_request_id
                or not _same(context.scope_digest, row.scope_digest)
                or (context.tenant_id, context.actor_id, context.session_id)
                != (actor.tenant_id, actor.account_id, session_id)
            ):
                raise _refuse("execution_request_mismatch")
            _require_command_lineage(db, row, session_row)
            return context

    def settle_launch(self, *, context: ConfirmedToolExecutionContext) -> ConsentReceipt:
        """Close this launch's grant from its own durable facts after the native Run ended.

        Consent → request lock order. Completed only from the sidecar's sealed
        confirmed-completed summary for the same Run; never downgrades an
        unknown, never resets counters and never re-enables the grant.
        """
        context = _verify_context(context)
        actor = Actor(account_id=context.actor_id, tenant_id=context.tenant_id)
        owned = self._owned_consent(actor, context.session_id, context.consent_id)
        with self._session_factory.begin() as db:
            row = _lock_consent(db, owned.consent_id)
            request = _lock_request(db, row.execution_request_id)
            if row.command_id != context.command_id or request.id != context.request_id:
                raise _refuse("execution_request_mismatch")
            now = _utcnow()
            self._settle(row, request, now, reason=None)
            return _receipt(row, now)

    def observe_stranded(self, *, session_id: str, session_version: int) -> "StrandedObservation | None":
        """Materialize a stale session's reserved grants exactly as they stand now.

        The sweeper calls this BEFORE its Redis lease check. Only grants
        reserved at or before ``session_version`` (the version the sweeper
        found stale) are candidates, each with its full spend/launch
        generation; ``None`` when the session moved past that version. One
        short read session; nothing is locked or written.
        """
        with self._session_factory() as db:
            session_row = db.get(DifyBuilderSession, session_id)
            if session_row is None or session_row.version != session_version:
                return None
            rows = db.execute(
                select(DifyBuilderRealCallConsent, DifyBuilderExecutionRequest)
                .outerjoin(
                    DifyBuilderExecutionRequest,
                    DifyBuilderExecutionRequest.id == DifyBuilderRealCallConsent.execution_request_id,
                )
                .where(
                    DifyBuilderRealCallConsent.session_id == session_id,
                    DifyBuilderRealCallConsent.command_id.is_not(None),
                    DifyBuilderRealCallConsent.state.in_(("confirmed", "claimed")),
                    DifyBuilderRealCallConsent.reserved_version <= session_version,
                )
                .order_by(DifyBuilderRealCallConsent.id)
            ).tuples()
            grants = tuple(starmap(_StrandedGrant.of, rows))
            return StrandedObservation(session_id=session_id, session_version=session_version, grants=grants)

    def reconcile_stranded(self, *, observation: "StrandedObservation") -> int:
        """Settle exactly the grants a stale-working sweep observed before its lease check.

        Each observed identity settles only if, under its consent → request
        row locks, it is still the same grant at the same generation (state,
        claim, phase counters/times, outcome, native IDs and request launch/seal).
        Anything that progressed after the observation belongs to a live
        worker and is left alone; a grant
        reserved after it was never a candidate. A later session head does not
        prevent settling the unchanged old grant, so explicit recovery can keep
        its new command. Never redispatches, rewrites the session head or touches
        counters. Returns the number settled.
        """
        settled = 0
        for grant in observation.grants:
            with self._session_factory.begin() as db:
                row = _lock_consent(db, grant.consent_id)
                request = _lock_request(db, row.execution_request_id)
                if row.session_id != observation.session_id or _StrandedGrant.of(row, request) != grant:
                    continue
                if self._settle(row, request, _utcnow(), reason="launch_stranded"):
                    settled += 1
        return settled

    def reconcile_terminal_grants(self, *, limit: int, lease_held: Callable[[str], bool]) -> int:
        """Settle reserved grants whose command already ended (review, FAILED or abandoned).

        Repairs a settlement write that failed after the command's terminal
        commit. Only reserved, unfinished grants are candidates (``command_id``
        set, ``confirmed``/``claimed``); an unexecuted user confirmation has no
        command and is never selected. A grant is skipped while its session
        holds a live advance lease (an active worker) or while the session
        still references it as the pending command of a working state (the
        stale-working sweep owns that case). Bounded by ``limit`` per call;
        never redispatches, rewrites a session head or touches counters.
        """
        if limit <= 0:
            return 0
        with self._session_factory() as db:
            candidates = list(
                db.execute(
                    select(DifyBuilderRealCallConsent.id, DifyBuilderRealCallConsent.session_id)
                    .where(
                        DifyBuilderRealCallConsent.command_id.is_not(None),
                        DifyBuilderRealCallConsent.state.in_(("confirmed", "claimed")),
                    )
                    .order_by(DifyBuilderRealCallConsent.created_at, DifyBuilderRealCallConsent.id)
                    .limit(limit)
                ).tuples()
            )
        settled = 0
        for consent_id, session_id in candidates:
            if lease_held(session_id) or self._still_pending(consent_id, session_id):
                continue
            with self._session_factory.begin() as db:
                row = _lock_consent(db, consent_id)
                request = _lock_request(db, row.execution_request_id)
                if self._settle(row, request, _utcnow(), reason="launch_stranded"):
                    settled += 1
        return settled

    def _still_pending(self, consent_id: str, session_id: str) -> bool:
        """Whether the session's committed head still holds this grant as its pending working command."""
        with self._session_factory() as db:
            session_row = db.get(DifyBuilderSession, session_id)
            row = db.get(DifyBuilderRealCallConsent, consent_id)
            if session_row is None or row is None:
                return False
            try:
                state = PcState(session_row.current_state)
            except ValueError:
                return False
            if not is_working(state):
                return False
            try:
                latest = _context_of(_latest_commit(db, session_row))
            except BuilderExecutionPolicyError:
                return True  # unreadable head: conservatively leave it to the stale-working sweep
            return (latest.confirmed_consent_id, latest.confirmed_command_id) == (row.id, row.command_id)

    @staticmethod
    def _settle(
        row: DifyBuilderRealCallConsent, request: DifyBuilderExecutionRequest, now: datetime, *, reason: str | None
    ) -> bool:
        """Apply ``_settled_state``; a recorded outcome keeps its own reason code."""
        final = _settled_state(row, request, now)
        if final is None:
            return False
        if final == "expired":
            fallback = "consent_expired"
        elif row.claimed_at is None:
            fallback = reason or "launch_not_claimed"
        else:
            fallback = reason or "execution_evidence_unknown"
        row.state = final
        if row.reason_code is None or (row.claimed_at is None and final != "expired"):
            row.reason_code = fallback
        return True

    # -- internal spends (in-process only) -----------------------------------

    def claim_tool(
        self,
        *,
        context: ConfirmedToolExecutionContext,
        node_id: str,
        native_run_id: str,
        native_node_execution_id: str,
    ) -> ConfirmedToolBinding:
        """Permanently consume the grant for the launched native Tool node; never twice."""
        context = _verify_context(context)
        native_run_id = _uuid(native_run_id, "execution_launch_mismatch")
        native_node_execution_id = _bounded(native_node_execution_id, "execution_launch_mismatch")
        node_id = _bounded(node_id, "unsupported_tool_node")
        _require_enabled()
        key = _secret_key()
        actor = Actor(account_id=context.actor_id, tenant_id=context.tenant_id)
        owned = self._owned_consent(actor, context.session_id, context.consent_id)
        check_execution_permission(actor, owned.app_id, self._session_factory)
        external = _read_external(actor.tenant_id)
        pending: BuilderExecutionPolicyError | None = None
        with self._session_factory.begin() as db:
            session_row = _lock_owner_rows(
                db,
                tenant_id=actor.tenant_id,
                session_id=owned.session_id,
                app_id=owned.app_id,
                workflow_id=owned.workflow_id,
                test_input_id=owned.test_input_id,
                credential_id=owned.credential_id,
            )
            row = _lock_consent(db, owned.consent_id)
            request = _lock_request(db, row.execution_request_id)
            # Fresh server time after every blocking lock decides expiry and becomes the claim timestamp.
            now = _utcnow()
            stored = _verify_launch(row, request, context, node_id=node_id, native_run_id=native_run_id)
            if row.claimed_at is not None:
                raise _refuse("consent_already_claimed")
            if _state(row) != "confirmed":
                raise _refuse("consent_not_confirmed")
            if now >= _aware(row.expires_at):
                row.state, row.reason_code = "expired", "consent_expired"
                pending = _refuse("consent_expired")
            else:
                try:
                    _require_command_lineage(db, row, session_row)
                    current = _current(
                        db,
                        actor=actor,
                        app_id=owned.app_id,
                        workflow_id=owned.workflow_id,
                        session_id=owned.session_id,
                        test_input_id=owned.test_input_id,
                        node_id=stored.node_id,
                        credential_id=owned.credential_id,
                        external=external,
                        part=_stored_part(stored),
                        expires_at=stored.expires_at,
                        key=key,
                    )
                    validate_scope(stored, current.binding)
                    if not _same(_scope_of(stored, key), row.scope_digest):
                        raise _refuse("consent_scope_changed")
                except BuilderExecutionPolicyError as error:
                    row.state, row.reason_code = "invalidated", error.reason_code
                    pending = _refuse("consent_scope_changed")
                else:
                    row.state = "claimed"
                    row.claimed_at = _naive(now)
                    row.native_run_id, row.native_node_execution_id = native_run_id, native_node_execution_id
        if pending is not None:
            raise pending
        return ConfirmedToolBinding(
            context=context,
            node_id=node_id,
            native_run_id=native_run_id,
            native_node_execution_id=native_node_execution_id,
        )

    def claim_phase(
        self, *, binding: ConfirmedToolBinding, phase: Phase, final_parameters: GmailReadParameters | None
    ) -> None:
        """Spend one phase permanently, committed before the caller performs its external effect."""
        binding = _verify_binding(binding)
        if phase == "refresh":
            if final_parameters is not None:
                raise _refuse("invalid_phase_input")
        elif phase == "business":
            if not isinstance(final_parameters, GmailReadParameters):
                raise _refuse("invalid_phase_input")
            try:
                final_parameters = GmailReadParameters.model_validate(final_parameters.model_dump())
            except ValidationError:
                raise _refuse("invalid_phase_input") from None
        else:
            raise _refuse("unsupported_phase")
        context = binding.context
        actor = Actor(account_id=context.actor_id, tenant_id=context.tenant_id)
        owned = self._owned_consent(actor, context.session_id, context.consent_id)
        try:
            _require_enabled()
            key = _secret_key()
            check_execution_permission(actor, owned.app_id, self._session_factory)
            external = _read_external(actor.tenant_id)
        except BuilderExecutionPolicyError as error:
            self._deny_after_claim(binding, phase, error.reason_code)
            raise
        pending: BuilderExecutionPolicyError | None = None
        with self._session_factory.begin() as db:
            session_row = _lock_owner_rows(
                db,
                tenant_id=actor.tenant_id,
                session_id=owned.session_id,
                app_id=owned.app_id,
                workflow_id=owned.workflow_id,
                test_input_id=owned.test_input_id,
                credential_id=owned.credential_id,
            )
            row = _lock_consent(db, owned.consent_id)
            request = _lock_request(db, row.execution_request_id)
            # Fresh server time after every blocking lock decides expiry and becomes the phase timestamp.
            now = _utcnow()
            stored = _verify_launch(row, request, context, node_id=binding.node_id, native_run_id=binding.native_run_id)
            _verify_claimed(row, binding)
            if (phase == "refresh" and row.refresh_claimed_at is not None) or (
                phase == "business" and row.business_claimed_at is not None
            ):
                raise _refuse("consent_already_claimed")
            if phase == "refresh" and row.business_claimed_at is not None:
                raise _refuse("phase_order_invalid")
            refresh_uncertain = row.refresh_claimed_at is not None and row.derived_credential_revision is None
            state = _state(row)
            try:
                validate_phase(
                    state=state,
                    phase=phase,
                    claimed=False,
                    expires_at=_aware(row.expires_at),
                    now=now,
                    refresh_uncertain=refresh_uncertain,
                )
            except BuilderExecutionPolicyError as error:
                if state != "claimed":
                    raise
                row.state, row.reason_code = _post_claim_failure(row), error.reason_code
                pending = error
            if pending is None:
                try:
                    _require_command_lineage(db, row, session_row)
                    current = _current(
                        db,
                        actor=actor,
                        app_id=owned.app_id,
                        workflow_id=owned.workflow_id,
                        session_id=owned.session_id,
                        test_input_id=owned.test_input_id,
                        node_id=stored.node_id,
                        credential_id=owned.credential_id,
                        external=external,
                        part=_stored_part(stored),
                        expires_at=stored.expires_at,
                        key=key,
                    )
                    expected = stored
                    if phase == "business" and row.derived_credential_revision is not None:
                        # The derived revision binds the refreshed expiry exactly.
                        expected = stored.model_copy(
                            update={
                                "credential": stored.credential.model_copy(
                                    update={
                                        "revision": row.derived_credential_revision,
                                        "expires_at": current.binding.credential.expires_at,
                                    }
                                )
                            }
                        )
                    validate_scope(expected, current.binding)
                    if not _same(_scope_of(stored, key), row.scope_digest):
                        raise _refuse("consent_scope_changed")
                    if phase == "business" and final_parameters != stored.parameters:
                        raise _refuse("consent_scope_changed")
                except BuilderExecutionPolicyError as error:
                    row.state, row.reason_code = _post_claim_failure(row), error.reason_code
                    pending = _refuse("consent_scope_changed")
            if pending is None:
                if phase == "refresh":
                    row.refresh_claimed_at, row.refresh_count = _naive(now), 1
                else:
                    row.business_claimed_at, row.business_count = _naive(now), 1
        if pending is not None:
            raise pending

    def finish_refresh(
        self, *, binding: ConfirmedToolBinding, old_revision: str, encrypted_credentials: str, expires_at: int
    ) -> str:
        """Persist the native owner's refreshed ciphertext by full-reference CAS; return the new revision.

        Internal and secret-bearing: the ciphertext is written only to the
        credential row and never returned, logged or stored here. Any conflict
        (rotation, access or client change, even at the same timestamp) leaves
        the newer row untouched and makes the auth effect unknown.

        After this commits successfully, the calling native refresh owner must
        invalidate the ordinary ``ToolProviderCredentialsCache`` outside SQL,
        exactly as native refresh does; no cache or network I/O happens here.
        """
        binding = _verify_binding(binding)
        context = binding.context
        actor = Actor(account_id=context.actor_id, tenant_id=context.tenant_id)
        owned = self._owned_consent(actor, context.session_id, context.consent_id)
        pending: BuilderExecutionPolicyError | None = None
        derived = ""
        try:
            with self._session_factory.begin() as db:
                _lock_owner_rows(
                    db,
                    tenant_id=actor.tenant_id,
                    session_id=owned.session_id,
                    app_id=owned.app_id,
                    workflow_id=owned.workflow_id,
                    test_input_id=owned.test_input_id,
                    credential_id=owned.credential_id,
                )
                row = _lock_consent(db, owned.consent_id)
                request = _lock_request(db, row.execution_request_id)
                stored = _verify_launch(
                    row, request, context, node_id=binding.node_id, native_run_id=binding.native_run_id
                )
                _verify_claimed(row, binding)
                if row.refresh_claimed_at is None:
                    raise _refuse("phase_not_claimed")
                if row.derived_credential_revision is not None:
                    raise _refuse("refresh_already_recorded")
                if _state(row) != "claimed":
                    raise _refuse("consent_not_claimed")
                try:
                    if type(old_revision) is not str or not _same(old_revision, row.initial_credential_revision):
                        raise _refuse("refresh_conflict")
                    if (
                        type(encrypted_credentials) is not str
                        or not encrypted_credentials
                        or type(expires_at) is not int
                        or expires_at < -1
                    ):
                        raise _refuse("invalid_refresh_result")
                    key = _secret_key()
                    current = self._bound_reference(db, actor, stored, row, key)
                    if not _same(current.revision, row.initial_credential_revision):
                        raise _refuse("refresh_conflict")
                except BuilderExecutionPolicyError as error:
                    reason = (
                        "invalid_refresh_result"
                        if error.reason_code == "invalid_refresh_result"
                        else "refresh_conflict"
                    )
                    row.state, row.reason_code = "unknown", reason
                    pending = _refuse(reason)
                else:
                    credential = db.get(BuiltinToolProvider, owned.credential_id)
                    if credential is None:
                        raise _refuse("refresh_conflict")
                    original, original_expiry = credential.encrypted_credentials, credential.expires_at
                    # Compare-and-set on the exact snapshot the revision bound under the row lock.
                    result = cast(
                        CursorResult,
                        db.execute(
                            update(BuiltinToolProvider)
                            .where(
                                BuiltinToolProvider.id == owned.credential_id,
                                BuiltinToolProvider.tenant_id == actor.tenant_id,
                                BuiltinToolProvider.encrypted_credentials.is_(None)
                                if original is None
                                else BuiltinToolProvider.encrypted_credentials == original,
                                BuiltinToolProvider.expires_at == original_expiry,
                            )
                            .values(encrypted_credentials=encrypted_credentials, expires_at=expires_at)
                            .execution_options(synchronize_session=False)
                        ),
                    )
                    if result.rowcount != 1:
                        raise _refuse("refresh_conflict")
                    db.expire(credential)
                    derived = self._bound_reference(db, actor, stored, row, key).revision
                    row.derived_credential_revision = derived
        except BuilderExecutionPolicyError as error:
            if error.reason_code != "refresh_conflict":
                raise
            # The write rolled back with its transaction; record the unresolved effect durably.
            self._mark_refresh_unknown(binding)
            raise
        if pending is not None:
            raise pending
        return derived

    def finish(self, *, binding: ConfirmedToolBinding, outcome: ActionOutcome) -> None:
        """Record the sanitized action outcome; allowed after expiry, never upgradeable from unknown."""
        binding = _verify_binding(binding)
        if not isinstance(outcome, ActionOutcome):
            raise _refuse("invalid_outcome")
        try:
            outcome = ActionOutcome.model_validate(outcome.model_dump())
        except ValidationError:
            raise _refuse("invalid_outcome") from None
        context = binding.context
        actor = Actor(account_id=context.actor_id, tenant_id=context.tenant_id)
        owned = self._owned_consent(actor, context.session_id, context.consent_id)
        with self._session_factory.begin() as db:
            row = _lock_consent(db, owned.consent_id)
            request = _lock_request(db, row.execution_request_id)
            _verify_launch(row, request, context, node_id=binding.node_id, native_run_id=binding.native_run_id)
            _verify_claimed(row, binding)
            state = _state(row)
            recorded = (row.outcome_state, row.reason_code)
            if state in _FINAL_OUTCOMES:
                # Repeating uncertainty is not an upgrade; anything else on a final grant is.
                if recorded == (outcome.state, outcome.reason_code) or (state == outcome.state == "unknown"):
                    return
                raise _refuse("consent_outcome_final")
            if state != "claimed":
                raise _refuse("consent_not_claimed")
            if outcome.state != "unknown" and row.business_claimed_at is None:
                raise _refuse("phase_not_claimed")
            if outcome.state == "unknown":
                row.state, row.outcome_state, row.reason_code = "unknown", "unknown", outcome.reason_code
                return
            if row.outcome_state is not None:
                if recorded == (outcome.state, outcome.reason_code):
                    return
                raise _refuse("consent_outcome_conflict")
            # Candidate only: Task 6 seals it against actual native Run/node proof.
            row.outcome_state, row.reason_code = outcome.state, outcome.reason_code

    # -- helpers ---------------------------------------------------------------

    def _owned_session(self, actor: Actor, session_id: str) -> tuple[str, str]:
        with self._session_factory() as db:
            session_row = db.get(DifyBuilderSession, session_id)
            if (
                session_row is None
                or session_row.tenant_id != actor.tenant_id
                or session_row.owner_account_id != actor.account_id
            ):
                raise _refuse("execution_owner_mismatch")
            workflow_id = db.scalar(
                select(Workflow.id).where(
                    Workflow.app_id == session_row.app_id,
                    Workflow.tenant_id == actor.tenant_id,
                    Workflow.version == "draft",
                    Workflow.type == "workflow",
                )
            )
            if workflow_id is None:
                raise _refuse("execution_owner_mismatch")
            return session_row.app_id, workflow_id

    def _owned_consent(self, actor: Actor, session_id: str, consent_id: str) -> _Owned:
        if not _canonical_uuid(session_id) or not _canonical_uuid(consent_id):
            raise _refuse("consent_not_found")
        with self._session_factory() as db:
            row = db.get(DifyBuilderRealCallConsent, consent_id)
            if row is None or (row.tenant_id, row.actor_id, row.session_id) != (
                actor.tenant_id,
                actor.account_id,
                session_id,
            ):
                raise _refuse("consent_not_found")
            return _owned(row)

    def _prepare_replay(self, actor: Actor, session_id: str, key: str, body_digest: str) -> ConsentReceipt | None:
        with self._session_factory() as db:
            row = db.scalar(
                select(DifyBuilderRealCallConsent).where(
                    DifyBuilderRealCallConsent.tenant_id == actor.tenant_id,
                    DifyBuilderRealCallConsent.actor_id == actor.account_id,
                    DifyBuilderRealCallConsent.session_id == session_id,
                    DifyBuilderRealCallConsent.prepare_key == key,
                )
            )
            if row is None:
                return None
            if not _same(row.prepare_body_digest, body_digest):
                raise _refuse("idempotency_conflict")
            return _saved(row.prepare_receipt)

    def _decision_replay(self, consent_id: str, key: str, body_digest: str) -> ConsentReceipt:
        with self._session_factory() as db:
            row = db.get(DifyBuilderRealCallConsent, consent_id)
            if row is None:
                raise _refuse("consent_not_found")
            return self._replay_from(
                row.confirm_key,
                row.confirm_body_digest,
                row.confirm_receipt,
                key,
                body_digest,
                other_key="consent_decision_conflict",
            )

    def _execute_replay(self, consent_id: str, key: str, body_digest: str, now: datetime) -> ConsentReceipt:
        with self._session_factory() as db:
            row = db.get(DifyBuilderRealCallConsent, consent_id)
            if row is None:
                raise _refuse("consent_not_found")
            return self._current_execute(row, key, body_digest, now)

    @staticmethod
    def _current_execute(row: DifyBuilderRealCallConsent, key: str, body_digest: str, now: datetime) -> ConsentReceipt:
        """An identical execute replay reports the reserved command's current state.

        Key/body idempotency is checked against the saved execute metadata,
        which (with the original reservation receipt) is kept for audit.
        """
        if row.execute_key is None or row.command_id is None or row.execution_request_id is None:
            raise _refuse("consent_record_invalid")
        if row.execute_key != key or not _same(row.execute_body_digest, body_digest):
            raise _refuse("idempotency_conflict")
        return _receipt(row, now)

    @staticmethod
    def _replay_from(
        saved_key: str | None,
        saved_digest: str | None,
        saved_receipt: dict[str, Any] | None,
        key: str,
        body_digest: str,
        *,
        other_key: str,
    ) -> ConsentReceipt:
        """Same key and body return the saved receipt even after later advancement."""
        if saved_key is None:
            raise _refuse("consent_record_invalid")
        if saved_key != key:
            raise _refuse(other_key)
        if not _same(saved_digest, body_digest):
            raise _refuse("idempotency_conflict")
        return _saved(saved_receipt)

    @staticmethod
    def _prior_uncertain(db: Session, actor: Actor, session_id: str) -> str | None:
        """Most recent earlier grant of this actor/session whose real effect is unresolved."""
        consent = DifyBuilderRealCallConsent
        return db.scalar(
            select(consent.id)
            .where(
                consent.tenant_id == actor.tenant_id,
                consent.actor_id == actor.account_id,
                consent.session_id == session_id,
                or_(
                    consent.state == "unknown",
                    and_(
                        consent.state == "claimed",
                        consent.outcome_state.is_(None),
                        or_(consent.refresh_claimed_at.is_not(None), consent.business_claimed_at.is_not(None)),
                    ),
                ),
            )
            .order_by(consent.created_at.desc(), consent.id.desc())
            .limit(1)
        )

    def _reserve(
        self,
        db: Session,
        row: DifyBuilderRealCallConsent,
        stored: ConsentBinding,
        current: _Current,
        fc: DifyBuilderContext,
        working: PcState,
        now: datetime,
    ) -> ConsentReceipt:
        """Sidecar, stable command and the session commit in the caller's locked transaction."""
        command_id = str(uuid4())
        values: dict[str, Any] = {
            "policy_version": POLICY_VERSION,
            "request_id": str(uuid4()),
            "tenant_id": stored.tenant_id,
            "app_id": stored.app_id,
            "workflow_id": stored.workflow_id,
            "actor_id": stored.actor_id,
            "session_id": stored.session_id,
            "test_input_id": stored.test_input_id,
            "execution_revision": stored.execution_revision,
            "graph_revision": stored.graph_revision,
            "submitted_inputs_digest": stored.submitted_inputs_digest,
            "effective_inputs_digest": stored.effective_inputs_digest,
            "mode": "confirmed_tool",
            "sandbox_profile": "disabled",
            "admitted_nodes": current.admitted_nodes,
            "consent_id": row.id,
            "scope_digest": row.scope_digest,
            "command_id": command_id,
        }
        initial = ConfirmedToolExecutionContext.model_validate({**values, "context_digest": "0" * 64})
        context = ConfirmedToolExecutionContext.model_validate({**values, "context_digest": context_digest(initial)})
        db.add(
            DifyBuilderExecutionRequest(
                id=context.request_id,
                tenant_id=context.tenant_id,
                app_id=context.app_id,
                workflow_id=context.workflow_id,
                actor_id=context.actor_id,
                session_id=context.session_id,
                test_input_id=context.test_input_id,
                context=context.model_dump(mode="json"),
                context_digest=context.context_digest,
                state="prepared",
                observations=[],
            )
        )
        fc.last_command_id = command_id
        fc.test_input_ref = stored.test_input_id
        fc.confirmed_consent_id, fc.confirmed_command_id = row.id, command_id
        try:
            version = SqlDifyBuilderRepository(self._session_factory)._compare_and_advance_in_session(
                db, stored.session_id, row.prepared_version, working, fc, []
            )
        except (ConflictError, NotFoundError):
            raise _refuse("stale_session_version") from None
        commit_id = db.scalar(
            select(DifyBuilderSessionCommit.id).where(
                DifyBuilderSessionCommit.session_id == stored.session_id, DifyBuilderSessionCommit.version == version
            )
        )
        if commit_id is None:
            raise _refuse("stale_session_version")
        row.command_id, row.execution_request_id = command_id, context.request_id
        row.reserved_version, row.reserved_commit_id = version, commit_id
        return _receipt(row, now)

    @staticmethod
    def _bound_reference(
        db: Session, actor: Actor, stored: ConsentBinding, row: DifyBuilderRealCallConsent, key: bytes
    ) -> CredentialReference:
        """The current full reference through the exact OAuth client this grant bound, or a conflict.

        Pure SQL: the client already authorized at the refresh claim is matched
        by its revision instead of re-reading external verification.
        """
        for verified_plugin in (False, True):
            try:
                reference = BuiltinToolManageService.resolve_builder_reference(
                    db=db,
                    actor=actor,
                    provider_id=stored.credential.provider_id,
                    credential_id=stored.credential.credential_id,
                    verified_plugin=verified_plugin,
                    revision_key=key,
                )
            except BuilderExecutionPolicyError:
                continue
            if _same(reference.oauth_client_revision, row.oauth_client_revision):
                return reference
        raise _refuse("refresh_conflict")

    def _deny_after_claim(self, binding: ConfirmedToolBinding, phase: Phase, reason: str) -> None:
        """Record a refusal found before a phase's transaction (policy/metadata) on the claimed grant."""
        context = binding.context
        with self._session_factory.begin() as db:
            row = db.scalar(
                select(DifyBuilderRealCallConsent)
                .where(DifyBuilderRealCallConsent.id == context.consent_id)
                .with_for_update()
            )
            if (
                row is None
                or row.state != "claimed"
                or row.tenant_id != context.tenant_id
                or row.actor_id != context.actor_id
                or row.command_id != context.command_id
                or not _same(row.scope_digest, context.scope_digest)
                or row.native_run_id != binding.native_run_id
                or row.native_node_execution_id != binding.native_node_execution_id
            ):
                return
            # A duplicate call must not reclassify the phase it duplicates.
            if (phase == "refresh" and row.refresh_claimed_at is not None) or (
                phase == "business" and row.business_claimed_at is not None
            ):
                return
            row.state, row.reason_code = _post_claim_failure(row), reason

    # -- native Tool boundary (in-process only) ---------------------------------

    def claimed_runtime(self, *, binding: ConfirmedToolBinding) -> "_ClaimedRuntime":
        """Stored installation and initial credential revision of a grant claimed by this exact node.

        Short read, no lock or write. Both values stay in process: the
        installation pins the confirmed dispatch headers and the revision is the
        CAS origin of a refresh; neither is public.
        """
        binding = _verify_binding(binding)
        context = binding.context
        with self._session_factory() as db:
            row = db.get(DifyBuilderRealCallConsent, context.consent_id)
            if row is None:
                raise _refuse("consent_not_found")
            request = (
                db.get(DifyBuilderExecutionRequest, row.execution_request_id) if row.execution_request_id else None
            )
            if request is None:
                raise _refuse("execution_request_mismatch")
            stored = _verify_launch(row, request, context, node_id=binding.node_id, native_run_id=binding.native_run_id)
            _verify_claimed(row, binding)
            if type(row.initial_credential_revision) is not str:
                raise _refuse("consent_record_invalid")
            return _ClaimedRuntime(installed=stored.installed, initial_revision=row.initial_credential_revision)

    def validate_runtime_snapshot(self, *, binding: ConfirmedToolBinding, reference: CredentialReference) -> None:
        """Admit the native owner's selected detached snapshot only if it is exactly the approved one.

        Called after native selection and before any compliance, decryption,
        refresh or dispatch. Compares the supplied full reference (row
        primitive, acting member's effective access and selected OAuth client)
        with the reference this grant stored at preparation, and requires both
        to be the approved OAuth credential type; phase claims later
        recheck current state, but only this check binds the bytes the native
        owner will actually use. SQL-local: no external read, reselection,
        decryption or transport. A proven mismatch on an unspent claimed grant is
        a known pre-phase denial (counters untouched); a final, spent or
        uncertain grant refuses without being rewritten. Fixed reasons only.
        """
        binding = _verify_binding(binding)
        if not isinstance(reference, CredentialReference):
            raise _refuse("credential_snapshot_mismatch")
        try:
            reference = CredentialReference.model_validate(reference.model_dump())
        except ValidationError:
            raise _refuse("credential_snapshot_mismatch") from None
        context = binding.context
        actor = Actor(account_id=context.actor_id, tenant_id=context.tenant_id)
        owned = self._owned_consent(actor, context.session_id, context.consent_id)
        pending: BuilderExecutionPolicyError | None = None
        with self._session_factory.begin() as db:
            row = _lock_consent(db, owned.consent_id)
            request = _lock_request(db, row.execution_request_id)
            stored = _verify_launch(row, request, context, node_id=binding.node_id, native_run_id=binding.native_run_id)
            _verify_claimed(row, binding)
            if _state(row) != "claimed":
                raise _refuse("consent_not_claimed")
            if (
                row.refresh_claimed_at is not None
                or row.business_claimed_at is not None
                or row.outcome_state is not None
            ):
                raise _refuse("phase_already_claimed")
            if not _same(stored.credential.revision, row.initial_credential_revision) or not _same(
                stored.credential.oauth_client_revision, row.oauth_client_revision
            ):
                raise _refuse("consent_record_invalid")
            try:
                # OAuth-only admission also binds the native selection, including a grant stored before it.
                gmail_read_policy.require_oauth_credential(stored.credential)
                gmail_read_policy.require_oauth_credential(reference)
            except BuilderExecutionPolicyError as error:
                row.state, row.reason_code = _post_claim_failure(row), error.reason_code
                pending = _refuse(error.reason_code)
            else:
                if reference.model_dump(mode="json") != stored.credential.model_dump(mode="json"):
                    row.state, row.reason_code = _post_claim_failure(row), "credential_snapshot_mismatch"
                    pending = _refuse("credential_snapshot_mismatch")
        if pending is not None:
            raise pending

    def refuse_phase(self, *, binding: ConfirmedToolBinding, phase: Phase, reason_code: str) -> None:
        """Record a refusal the native boundary found before spending ``phase`` (e.g. a widened envelope)."""
        binding = _verify_binding(binding)
        if phase not in ("refresh", "business"):
            raise _refuse("unsupported_phase")
        if type(reason_code) is not str or _REASON.fullmatch(reason_code) is None:
            reason_code = "consent_scope_changed"
        self._deny_after_claim(binding, phase, reason_code)

    def _mark_refresh_unknown(self, binding: ConfirmedToolBinding) -> None:
        context = binding.context
        with self._session_factory.begin() as db:
            row = db.scalar(
                select(DifyBuilderRealCallConsent)
                .where(DifyBuilderRealCallConsent.id == context.consent_id)
                .with_for_update()
            )
            if (
                row is not None
                and row.state == "claimed"
                and row.native_run_id == binding.native_run_id
                and row.refresh_claimed_at is not None
                and row.derived_credential_revision is None
            ):
                row.state, row.reason_code = "unknown", "refresh_conflict"


def _scope_of(binding: ConsentBinding, key: bytes) -> str:
    """Keyed scope digest; a rotated key yields a different digest and invalidates the grant."""
    return scope_digest(binding, key=key)


@dataclass(frozen=True)
class _ClaimedRuntime:
    installed: InstalledToolBinding
    initial_revision: str = field(repr=False)


class ServiceConfirmedToolGuard:
    """``ConfirmedToolGuard`` for one claimed native Tool node, backed by this service.

    Constructed in process from a ``ConfirmedToolBinding`` the service itself
    returned from ``claim_tool``; it is never deserialized from HTTP or queue
    JSON. Phases spend through ``claim_phase`` and refreshed ciphertext lands
    only through ``finish_refresh``'s CAS. Each phase starts at most once
    locally as well as durably. Business JSON results are kept in memory, at
    most two, solely for Task 2 classification and dropped when the stream
    finishes; credentials and ciphertext never enter this object's state.
    """

    def __init__(self, service: BuilderRealCallConsentService, binding: ConfirmedToolBinding) -> None:
        if not isinstance(service, BuilderRealCallConsentService):
            raise _refuse("invalid_tool_binding")
        self.binding = _verify_binding(binding)
        self._service = service
        self._runtime: _ClaimedRuntime | None = None
        self._refresh: Literal["unspent", "claimed", "recorded"] = "unspent"
        self._parameters: GmailReadParameters | None = None
        self._results: list[dict[str, object]] = []
        self._finished = False

    def _claimed(self) -> _ClaimedRuntime:
        if self._runtime is None:
            self._runtime = self._service.claimed_runtime(binding=self.binding)
        return self._runtime

    def dispatch_headers(self) -> dict[str, str]:
        return confirmed_dispatch_headers(self._claimed().installed)

    def before_refresh(self) -> None:
        if self._parameters is not None:
            raise _refuse("phase_order_invalid")
        if self._refresh != "unspent":
            raise _refuse("phase_already_claimed")
        self._service.claim_phase(binding=self.binding, phase="refresh", final_parameters=None)
        self._refresh = "claimed"

    def persist_refresh(self, encrypted_credentials: str, expires_at: int) -> str:
        if self._refresh != "claimed":
            raise _refuse("phase_not_claimed")
        derived = self._service.finish_refresh(
            binding=self.binding,
            old_revision=self._claimed().initial_revision,
            encrypted_credentials=encrypted_credentials,
            expires_at=expires_at,
        )
        self._refresh = "recorded"
        return derived

    def before_invoke(self, parameters: Mapping[str, object]) -> None:
        if self._parameters is not None or self._finished:
            raise _refuse("phase_already_claimed")
        try:
            final = gmail_read_policy.normalize_get_message_parameters(parameters)
        except BuilderExecutionPolicyError as error:
            # A widened or malformed final envelope is a known denial; nothing was sent.
            self._service.refuse_phase(binding=self.binding, phase="business", reason_code=error.reason_code)
            raise
        self._service.claim_phase(binding=self.binding, phase="business", final_parameters=final)
        self._parameters = final

    def observe_json(self, message: Mapping[str, object]) -> None:
        if self._parameters is None or self._finished:
            raise _refuse("phase_not_claimed")
        # Two results already classify as duplicate; keep no more.
        if len(self._results) < 2:
            self._results.append(dict(message))

    def finish_stream(self, *, complete: bool, declared_failure: bool) -> None:
        if self._finished:
            return
        self._finished = True
        results, self._results = self._results, []
        if self._parameters is not None:
            try:
                outcome = gmail_read_policy.classify_get_message_result(
                    expected_message_id=self._parameters.message_id,
                    json_messages=results,
                    stream_completed=complete,
                    declared_failure=declared_failure,
                )
            except BuilderExecutionPolicyError:
                outcome = ActionOutcome(state="unknown", reason_code="invalid_outcome_input")
        elif self._refresh == "claimed":
            # A spent refresh never recorded may have rotated tokens remotely.
            outcome = ActionOutcome(state="unknown", reason_code="refresh_uncertain")
        elif self._refresh == "recorded":
            # A recorded refresh whose business phase was never dispatched (e.g. the
            # ordinary cache could not be invalidated): close conservatively so no
            # fresh guard can continue this grant.
            outcome = ActionOutcome(state="unknown", reason_code="business_not_dispatched")
        else:
            return
        self._service.finish(binding=self.binding, outcome=outcome)
