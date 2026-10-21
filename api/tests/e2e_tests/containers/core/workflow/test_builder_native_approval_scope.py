"""Normal CI only: operation approval over real PostgreSQL and protected owners.

Never import, collect or run locally. Reuse the unchanged migration fixtures.
Occurrence UUIDs and metadata are synthetic fixture values; these cases make no
claim of actual public native-node provenance. The real encrypted state owner,
protected pending reader, decision guard, root lock and physical claim are used.
No network/provider transport or Graphon activation is involved.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from core.dify_builder.models import Actor
from models.dify_builder_native_tests import (
    NativeEffectAttempt,
    NativeEffectDispatchClaim,
    NativeEffectGrant,
    NativePendingAction,
    NativeTestInvocation,
    NativeTestScope,
)
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.approval_contracts import NativeApprovalProposal, NativeApprovalTerms
from runtime_contracts.builder.native.contracts import (
    ApprovalWait,
    DispatchPermit,
    PolicyStop,
    RecordedResult,
    operation_digest,
)
from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload, NodeJournalState
from services.dify_builder.native_testing.authorization import EffectAuthorizationService, _scope_digest
from services.dify_builder.native_testing.pending_intents import PendingDecisionGuard, ProtectedPendingIntentReader
from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt
from services.dify_builder.native_testing.repository import NativeBinding, OwnedNativeTestLoader
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import ApprovalLedgerSnapshot
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    continuation_case as continuation_case,  # noqa: PLC0414 - unchanged encrypted owner fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_dispatch_claims import (
    migrated_dispatch_claims as migrated_dispatch_claims,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import MetadataOwner
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    ledger_case as ledger_case,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    native_owner as native_owner,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    no_live as no_live,  # noqa: PLC0414
)


@pytest.fixture
def approval_case(continuation_case, migrated_continuation_tables, migrated_dispatch_claims):
    assert migrated_continuation_tables is None
    assert migrated_dispatch_claims is None
    c = continuation_case
    with c.factory.begin() as session:
        scope = session.get(NativeTestScope, c.ref.request_id)
        scope.max_calls = scope.max_dispatches = 2
        scope.max_cost_units = 4
        scope.budget_limits = {"cpu_ms": 20}
        row = session.scalar(select(NativeTestInvocation).where(NativeTestInvocation.request_id == c.ref.request_id))
        row.bindings = {
            identity: {**raw, "approval_scope": "operation", "execution_id": str(uuid4())}
            for identity, raw in row.bindings.items()
        }
    return c


def _effects(c, count=1):
    # These UUID occurrence keys are fixture identities, not native public IDs.
    return tuple(c.ledger.occurrence("fixture-" + str(uuid4())) for _ in range(count))


def _input_effect(c, effect):
    effect = effect.model_copy(update={"input_digest": canonical_digest({"limit": 1})})
    with c.factory.begin() as session:
        row = session.scalar(
            select(NativeTestInvocation).where(
                NativeTestInvocation.request_id == c.ref.request_id,
                NativeTestInvocation.invocation_id == c.ref.invocation_id,
            )
        )
        identity = operation_digest(effect.key)
        row.bindings = {
            **row.bindings,
            identity: {**row.bindings[identity], "intent_digest": canonical_digest(effect.model_dump(mode="json"))},
        }
    return effect


def _prepare_pending(c, effects):
    inputs = {"limit": 1}
    generation = c.store.load_context(ref=c.ref).generation
    prepared, journals, waits = [], [], []
    terms = NativeApprovalTerms(
        max_calls=1,
        max_dispatches=1,
        max_cost_units=2,
        expires_at=(datetime.now(UTC) + timedelta(minutes=3)).isoformat(),
    )
    for effect in effects:
        effect = _input_effect(c, effect)
        input_key = effect.key.model_copy(update={"occurrence_path": (*effect.key.occurrence_path, "input")})
        input_ref = c.store.store_result(ref=c.ref, key=input_key, result=inputs)
        wait = c.ledger.guard.before_call(ref=c.ref, intent=effect)
        assert isinstance(wait, ApprovalWait)
        waits.append(wait.pending_operation_id)
        prepared.append(effect)
        journals.append(
            NodeJournalState(
                invocation_id=effect.key.invocation_id,
                occurrence_path=effect.key.occurrence_path,
                input_result_ref=input_ref,
                input_digest=canonical_digest(inputs),
                cursor=effect.key.cursor,
                operation_keys=(effect.key,),
                result_refs=(),
                intents=(effect,),
            )
        )
    checkpoint = c.store.commit_checkpoint(
        ref=c.ref,
        generation=generation,
        payload=NativeCheckpointPayload(
            schema_version="1",
            native_run_id=c.context.native_run_id,
            generation=generation,
            generate_entity_json="{}",
            graph_runtime_state_json="{}",
            response_stream_filter_json="{}",
            node_journals=tuple(journals),
            child_refs=(),
            input_result_refs=(),
            approval_proposals=tuple(NativeApprovalProposal(key=effect.key, terms=terms) for effect in prepared),
        ),
    )
    c.lifecycle.pause(
        ref=c.ref, checkpoint=checkpoint, pending_operation_ids=tuple(waits), expected_generation=generation
    )
    reader = ProtectedPendingIntentReader(loader=c.ledger.guard.loader, state_store=c.store)
    receipt = NativeTestPublicReceipt(
        request_id=c.ref.request_id,
        generation=generation,
        version=generation + 1,
        status="waiting",
        wait_reason="approval",
        native_run_id=None,
        native_status=None,
        pending=(),
        outcome=None,
        evidence_refs=(),
    )
    guards = []
    for effect, pending_id in zip(prepared, waits, strict=True):
        resolved = reader.load(actor=c.ledger.actor, request_id=c.ref.request_id, pending_operation_id=pending_id)
        assert resolved.intent == effect
        assert reader.load_terms(resolved=resolved) == terms
        with c.factory() as session:
            digest = session.get(NativePendingAction, pending_id).owner_version
        guards.append(
            PendingDecisionGuard(
                resolved=resolved,
                pending_operation_id=pending_id,
                expected_version=generation + 1,
                scope_digest=digest,
                idempotency_digest=canonical_digest("decision-" + pending_id),
                body_digest=canonical_digest({"decision": "confirm", "pending": pending_id}),
                receipt=receipt,
                terms=terms,
                invocation_app_id=c.context.app_id,
                invocation_workflow_id=c.context.workflow_id,
                invocation_revision=c.context.graph_revision,
            )
        )
    return tuple(prepared), tuple(guards)


def _decide(c, guard, *, decision="approved", service=None):
    terms = guard.terms
    return (service or c.ledger.guard).decide(
        ref=c.ref,
        intent=guard.resolved.intent,
        decision=decision,
        max_calls=terms.max_calls,
        max_dispatches=terms.max_dispatches,
        max_cost_units=terms.max_cost_units,
        expires_at=datetime.fromisoformat(terms.expires_at),
        pending_guard=guard,
    )


def _resume(c):
    generation = c.store.load_context(ref=c.ref).generation
    receipt = c.lifecycle.resume(
        actor=c.ledger.actor,
        request_id=c.ref.request_id,
        expected_generation=generation,
        idempotency_key="approval-resume-" + str(uuid4()),
    )
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)


def _claim(c, effect, *, service=None):
    with c.factory() as session:
        from models.dify_builder_native_tests import NativeInvocationState

        current = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == c.ref.request_id)
        )
        waiting = current.state == "waiting"
    if waiting:
        _resume(c)
    auth = service or c.ledger.guard
    permit = auth.before_call(ref=c.ref, intent=effect)
    assert isinstance(permit, DispatchPermit)
    auth.claim_dispatch(ref=c.ref, intent=effect, permit=permit)
    with pytest.raises(BuilderExecutionPolicyError, match="dispatch_already_consumed"):
        auth.claim_dispatch(ref=c.ref, intent=effect, permit=permit)
    return permit


def _counts(c):
    with c.factory() as session:
        scope = session.get(NativeTestScope, c.ref.request_id)
        grants = session.scalars(
            select(NativeEffectGrant).where(NativeEffectGrant.request_id == c.ref.request_id)
        ).all()
        counts = {
            model.__name__: session.scalar(
                select(func.count()).select_from(model).where(model.request_id == c.ref.request_id)
            )
            for model in (NativeEffectAttempt, NativeEffectDispatchClaim)
        }
        return ApprovalLedgerSnapshot(
            quota=(scope.spent_calls, scope.spent_dispatches, scope.spent_cost_units),
            budget=dict(scope.budget_spent),
            grants=sorted((g.max_calls, g.max_dispatches, g.max_cost_units, g.spent_calls) for g in grants),
            attempts=counts["NativeEffectAttempt"],
            claims=counts["NativeEffectDispatchClaim"],
        )


def test_operation_confirmations_are_separate_immutable_single_calls_under_root_limit(approval_case):
    c = approval_case
    raw = tuple(_input_effect(c, effect) for effect in _effects(c, 3))
    first_effects, first_guards = _prepare_pending(c, raw[:1])
    effects, guards = list(first_effects), list(first_guards)
    assert _decide(c, guards[0]) == _decide(c, guards[0])
    first = _claim(c, effects[0])
    result = c.store.store_result(ref=c.ref, key=effects[0].key, result={"done": True})
    c.ledger.guard.record_outcome(permit=first, outcome="completed", result_ref=result)
    assert c.ledger.guard.before_call(ref=c.ref, intent=effects[0]) == RecordedResult(
        operation_id=first.operation_id, result_ref=result
    )
    # Trusted internal reconfirmation also reuses the immutable spent grant.
    reconfirm = {
        "ref": c.ref,
        "intent": effects[0],
        "decision": "approved",
        "max_calls": 1,
        "max_dispatches": 1,
        "max_cost_units": 2,
        "expires_at": datetime.fromisoformat(guards[0].terms.expires_at),
    }
    assert c.ledger.guard.decide(**reconfirm) == c.ledger.guard.decide(**reconfirm)
    assert isinstance(c.ledger.guard.before_call(ref=c.ref, intent=raw[1]), ApprovalWait)
    assert _counts(c).grants == [(1, 1, 2, 1)]
    next_effects, next_guards = _prepare_pending(c, raw[1:2])
    effects.extend(next_effects)
    guards.extend(next_guards)
    _decide(c, guards[1])
    second = _claim(c, effects[1])
    c.ledger.guard.record_outcome(permit=second, outcome="unknown", result_ref=None)
    next_effects, next_guards = _prepare_pending(c, raw[2:])
    effects.extend(next_effects)
    guards.extend(next_guards)
    _decide(c, guards[2])
    _resume(c)
    assert c.ledger.guard.before_call(ref=c.ref, intent=effects[2]) == PolicyStop(reason_code="native_budget_exhausted")
    counts = _counts(c)
    assert counts.quota == (2, 2, 4)
    assert counts.budget == {"cpu_ms": 20}
    assert counts.grants == [(1, 1, 2, 0), (1, 1, 2, 1), (1, 1, 2, 1)]
    assert (counts.attempts, counts.claims) == (2, 2)


def test_unknown_operation_cannot_redispatch_using_another_operation_grant(approval_case):
    c = approval_case
    raw = tuple(_input_effect(c, effect) for effect in _effects(c, 2))
    first_effects, first_guards = _prepare_pending(c, raw[:1])
    effects, guards = list(first_effects), list(first_guards)
    _decide(c, guards[0])
    first = _claim(c, effects[0])
    c.ledger.guard.record_outcome(permit=first, outcome="unknown", result_ref=None)
    next_effects, next_guards = _prepare_pending(c, raw[1:])
    effects.extend(next_effects)
    guards.extend(next_guards)
    _decide(c, guards[1])
    for _ in range(2):
        assert c.ledger.guard.before_call(ref=c.ref, intent=effects[0]) == PolicyStop(reason_code="outcome_unknown")
    with pytest.raises(BuilderExecutionPolicyError):
        c.ledger.guard.claim_dispatch(ref=c.ref, intent=effects[0], permit=first)
    _claim(c, effects[1])
    counts = _counts(c)
    assert counts.quota == (2, 2, 4)
    assert counts.grants == [(1, 1, 2, 1), (1, 1, 2, 1)]
    assert (counts.attempts, counts.claims) == (2, 2)


def test_legacy_batch_digest_and_exhaustion_keep_one_immutable_grant(approval_case):
    c = approval_case
    with c.factory.begin() as session:
        row = session.scalar(select(NativeTestInvocation).where(NativeTestInvocation.request_id == c.ref.request_id))
        row.bindings = {
            identity: {k: v for k, v in raw.items() if k != "approval_scope"} for identity, raw in row.bindings.items()
        }
        trusted = NativeBinding.model_validate(row.bindings[operation_digest(c.ledger.intent.key)])
    # Captured from the actual old helper before either production file changed.
    assert _scope_digest(c.ledger.intent, trusted) == "f14661adebe3ee33021286ec175a3b80f7bf608468f77d873be621de7064756b"
    expiry = datetime.now(UTC) + timedelta(minutes=3)
    terms = {"max_calls": 1, "max_dispatches": 1, "max_cost_units": 2, "expires_at": expiry}
    first, second = _effects(c, 2)
    grant_id = c.ledger.guard.decide(ref=c.ref, intent=first, decision="approved", **terms)
    permit = _claim(c, first)
    c.ledger.guard.record_outcome(permit=permit, outcome="unknown", result_ref=None)
    assert isinstance(c.ledger.guard.before_call(ref=c.ref, intent=second), ApprovalWait)
    assert c.ledger.guard.decide(ref=c.ref, intent=second, decision="approved", **terms) == grant_id
    assert isinstance(c.ledger.guard.before_call(ref=c.ref, intent=second), ApprovalWait)
    with pytest.raises(BuilderExecutionPolicyError, match="native_grant_conflict"):
        c.ledger.guard.decide(ref=c.ref, intent=second, decision="approved", **{**terms, "max_calls": 2})
    counts = _counts(c)
    assert counts.grants == [(1, 1, 2, 1)]
    assert counts.quota == (1, 1, 2)
    assert (counts.attempts, counts.claims) == (1, 1)


@pytest.mark.parametrize("mode", ["operation", "batch"])
def test_denial_cannot_be_bypassed_by_decision_replay(approval_case, mode):
    c = approval_case
    with c.factory.begin() as session:
        row = session.scalar(select(NativeTestInvocation).where(NativeTestInvocation.request_id == c.ref.request_id))
        row.bindings = {identity: {**raw, "approval_scope": mode} for identity, raw in row.bindings.items()}
    effects, guards = _prepare_pending(c, _effects(c))
    _decide(c, guards[0], decision="denied")
    assert c.ledger.guard.before_call(ref=c.ref, intent=effects[0]) == PolicyStop(reason_code="effect_denied")
    terms = guards[0].terms
    with pytest.raises(BuilderExecutionPolicyError, match="native_grant_conflict"):
        c.ledger.guard.decide(
            ref=c.ref,
            intent=effects[0],
            decision="approved",
            max_calls=1,
            max_dispatches=1,
            max_cost_units=2,
            expires_at=datetime.fromisoformat(terms.expires_at),
        )
    assert _counts(c).quota == (0, 0, 0)
    assert _counts(c).attempts == _counts(c).claims == 0


def test_concurrent_guarded_decisions_and_claims_serialize_once(approval_case):
    c = approval_case
    effects, guards = _prepare_pending(c, _effects(c))
    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts = list(pool.map(lambda _: _decide(c, guards[0]), range(2)))
    assert receipts[0] == receipts[1]
    assert _counts(c).grants == [(1, 1, 2, 0)]
    _resume(c)

    def reserve_and_claim(_):
        decision = c.ledger.guard.before_call(ref=c.ref, intent=effects[0])
        if isinstance(decision, DispatchPermit):
            c.ledger.guard.claim_dispatch(ref=c.ref, intent=effects[0], permit=decision)
            return "claimed"
        return decision.reason_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(reserve_and_claim, range(2)))
    assert sorted(outcomes) == ["claimed", "dispatch_in_progress"]
    assert _counts(c).quota == (1, 1, 2)
    assert (_counts(c).attempts, _counts(c).claims) == (1, 1)


class ChangedScopeOwner(MetadataOwner):
    def resolve_binding(self, **kwargs):
        return super().resolve_binding(**kwargs).model_copy(update={"approval_scope": "batch"})


@pytest.mark.parametrize("phase", ["decision", "claim"])
def test_current_scope_metadata_drift_rejects_decision_and_physical_claim(approval_case, phase):
    c = approval_case
    effects, guards = _prepare_pending(c, _effects(c))
    changed = EffectAuthorizationService(
        OwnedNativeTestLoader(c.factory, actor=c.ledger.actor, resolver=ChangedScopeOwner())
    )
    if phase == "decision":
        with pytest.raises(BuilderExecutionPolicyError, match="native_binding_drift"):
            _decide(c, guards[0], service=changed)
        assert _counts(c).quota == (0, 0, 0)
    else:
        _decide(c, guards[0])
        _resume(c)
        permit = c.ledger.guard.before_call(ref=c.ref, intent=effects[0])
        assert isinstance(permit, DispatchPermit)
        with pytest.raises(BuilderExecutionPolicyError, match="native_binding_drift"):
            changed.claim_dispatch(ref=c.ref, intent=effects[0], permit=permit)
        assert _counts(c).quota == (1, 1, 2)
    assert _counts(c).claims == 0


@pytest.mark.parametrize("drift", ["owner", "generation"])
def test_guarded_decision_rechecks_current_owner_and_generation(approval_case, drift):
    c = approval_case
    _, guards = _prepare_pending(c, _effects(c))
    if drift == "owner":
        actor = Actor(tenant_id=str(uuid4()), account_id=str(uuid4()))
        changed = EffectAuthorizationService(OwnedNativeTestLoader(c.factory, actor=actor, resolver=c.ledger.metadata))
    else:
        changed = c.ledger.guard
        with c.factory.begin() as session:
            from models.dify_builder_native_tests import NativeInvocationState

            session.scalar(
                select(NativeInvocationState).where(
                    NativeInvocationState.request_id == c.ref.request_id,
                    NativeInvocationState.invocation_id == c.ref.invocation_id,
                )
            ).generation = 1
    with pytest.raises(BuilderExecutionPolicyError):
        _decide(c, guards[0], service=changed)
    assert _counts(c).quota == (0, 0, 0)
    assert _counts(c).grants == []
