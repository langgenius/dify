"""Actual PostgreSQL grant/result owners with a deterministic physical boundary.

The callback is a test-owned business effect; no provider/model/OAuth is called.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import JsonValue
from typing_extensions import TypedDict

from core.dify_builder.models import Actor
from runtime_contracts.builder.native.contracts import DispatchPermit
from runtime_contracts.builder.native.runtime_contracts import NodeJournalState
from tests.e2e_tests.containers.core.workflow.builder_native_fixture_records import require_instance

if TYPE_CHECKING:
    from services.dify_builder.native_testing.pending_intents import ResolvedPendingIntent


from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tests.e2e_tests.containers.core.workflow.test_builder_native_continuation import ContinuationCase

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tests.e2e_tests.containers.core.workflow import (
        test_builder_native_continuation as _fixture_types_0,
    )
    from tests.e2e_tests.containers.core.workflow import test_builder_restricted_native as _fixture_types_1


# Imported aliases register shared pytest fixtures in this module.
# ruff: noqa: PLC0414
from uuid import uuid4

import pytest
from dify_agent.adapters.native_testing.client import AgentPhysicalDispatchPayload
from dify_agent.protocol.native_testing import AgentDispatchPermit, AgentEffectIntent, AgentNativeTestRef
from sqlalchemy import func, select

from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession
from models.dify_builder_native_tests import NativeEffectDispatchClaim, NativeEffectOperation, NativeTestScope
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import ApprovalWait, RecordedResult
from services.dify_builder.native_testing.agent_lineage import NativeAgentEndpointContext
from services.dify_builder.native_testing.agent_operations import (
    AgentOperationService,
    AgentToolDispatchOwner,
    admit_confirmed_agent_execution,
)
from tests.e2e_tests.containers.core.workflow.test_builder_native_continuation import ContinuationCase
from tests.e2e_tests.containers.core.workflow.test_builder_native_continuation import (
    continuation_case as continuation_case,
)
from tests.e2e_tests.containers.core.workflow.test_builder_native_continuation import (
    migrated_continuation_tables as migrated_continuation_tables,
)
from tests.e2e_tests.containers.core.workflow.test_builder_native_continuation import (
    migrated_native_tables as migrated_native_tables,
)
from tests.e2e_tests.containers.core.workflow.test_builder_native_continuation import (
    native_owner as native_owner,
)
from tests.e2e_tests.containers.core.workflow.test_builder_native_continuation import (
    no_live as no_live,
)


def payload(case: ContinuationCase, permit: DispatchPermit) -> AgentPhysicalDispatchPayload:
    return AgentPhysicalDispatchPayload(
        ref=AgentNativeTestRef.model_validate(case.ref.model_dump(mode="json")),
        intent=AgentEffectIntent.model_validate(case.ledger.intent.model_dump(mode="json")),
        permit=AgentDispatchPermit.model_validate(permit.model_dump(mode="json")),
    )


def test_actual_sql_approval_dispatch_and_result_replay_once(
    continuation_case: _fixture_types_0.ContinuationCase,
) -> None:
    case = continuation_case
    calls: list[str] = []
    guard = case.ledger.guard
    assert isinstance(guard.before_call(ref=case.ref, intent=case.ledger.intent), ApprovalWait)
    assert calls == []
    case.ledger.confirm()
    permit = guard.before_call(ref=case.ref, intent=case.ledger.intent)
    assert isinstance(permit, DispatchPermit)
    owner = AgentToolDispatchOwner(authorization=guard, state_store=case.store, revalidate=lambda **_kwargs: None)
    assert (
        owner.invoke(envelope=payload(case, permit), invoke=lambda: calls.append("dispatch") or "real observation")
        == "real observation"
    )
    with pytest.raises(BuilderExecutionPolicyError):
        owner.invoke(envelope=payload(case, permit), invoke=lambda: calls.append("duplicate"))
    replay = guard.before_call(ref=case.ref, intent=case.ledger.intent)
    assert isinstance(replay, RecordedResult)
    assert case.store.load_result(ref=case.ref, result_ref=replay.result_ref) == "real observation"
    assert calls == ["dispatch"]
    with case.factory() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(NativeEffectDispatchClaim)
                .where(NativeEffectDispatchClaim.request_id == case.ref.request_id)
            )
            == 1
        )


def test_physical_timeout_is_unknown_and_cannot_dispatch_again(
    continuation_case: _fixture_types_0.ContinuationCase,
) -> None:
    case = continuation_case
    calls: list[str] = []
    case.ledger.confirm()
    guard = case.ledger.guard
    permit = guard.before_call(ref=case.ref, intent=case.ledger.intent)
    assert isinstance(permit, DispatchPermit)
    owner = AgentToolDispatchOwner(authorization=guard, state_store=case.store, revalidate=lambda **_kwargs: None)

    def lost_response() -> None:
        calls.append("dispatch")
        raise TimeoutError("test response lost")

    with pytest.raises(TimeoutError):
        owner.invoke(envelope=payload(case, permit), invoke=lost_response)
    with pytest.raises(BuilderExecutionPolicyError):
        owner.invoke(envelope=payload(case, permit), invoke=lost_response)
    with case.factory() as session:
        assert (
            session.scalar(
                select(NativeEffectOperation.state).where(NativeEffectOperation.request_id == case.ref.request_id)
            )
            == "unknown"
        )
    assert calls == ["dispatch"]


def test_confirmed_admission_uses_original_key_and_preallocated_parent_run(
    continuation_case: _fixture_types_0.ContinuationCase, native_owner: _fixture_types_1.NativeOwner
) -> None:
    del continuation_case  # Preserve admission setup before using its native owner.
    factory, actor, _app, _workflow, session_id, test_input_id = native_owner
    with factory() as session:
        version = require_instance(session.get(DifyBuilderSession, session_id), DifyBuilderSession).version
    run_id = str(uuid4())
    kwargs: AgentAdmissionArguments = {
        "actor": actor,
        "session_id": session_id,
        "test_input_id": test_input_id,
        "expected_version": version,
        "native_run_id": run_id,
        "idempotency_key": "owned-test-reservation",
        "limits": {"calls": 4, "dispatches": 4, "cost_units": 4},
    }
    first = admit_confirmed_agent_execution(**kwargs)
    second = admit_confirmed_agent_execution(**kwargs)
    assert first == second
    assert first.native_run_id == run_id
    with factory() as session:
        row = session.get(DifyBuilderExecutionRequest, first.ref.request_id)
        scope = session.get(NativeTestScope, first.ref.request_id)
        assert (
            require_instance(row, DifyBuilderExecutionRequest).context["profile"]["profile_id"]
            == "builder-agent-confirmed-v1"
        )
        assert require_instance(scope, NativeTestScope).task_approved is True
        assert require_instance(scope, NativeTestScope).spent_calls == 0
    conflicting = kwargs.copy()
    conflicting["native_run_id"] = str(uuid4())
    with pytest.raises(BuilderExecutionPolicyError, match="native_idempotency_conflict"):
        admit_confirmed_agent_execution(**conflicting)


@pytest.mark.parametrize("canvas_save", [False, True])
def test_confirmed_deferred_calls_have_distinct_pending_and_one_c03_snapshot(
    continuation_case: _fixture_types_0.ContinuationCase, native_owner: _fixture_types_1.NativeOwner, canvas_save: bool
) -> None:
    """SQL owners are real; current tool metadata is the explicit no-I/O fixture."""
    from datetime import UTC, datetime, timedelta

    from models.dify_builder_native_tests import (
        NativeEffectAttempt,
        NativeEffectGrant,
        NativePendingAction,
        NativeTestInvocation,
    )
    from runtime_contracts.builder.execution import canonical_digest
    from runtime_contracts.builder.native.approval_contracts import NativeApprovalProposal, NativeApprovalTerms
    from runtime_contracts.builder.native.contracts import OperationKey, operation_digest
    from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload
    from services.dify_builder.native_testing.api_service import NativeTestApiService
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService
    from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
    from services.dify_builder.native_testing.public_contracts import PendingActionDisclosure
    from services.dify_builder.native_testing.repository import NativeBinding, OwnedNativeTestLoader
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

    case = continuation_case
    factory, actor, _app, _workflow, session_id, test_input_id = native_owner
    with factory() as session:
        version = require_instance(session.get(DifyBuilderSession, session_id), DifyBuilderSession).version
    context = admit_confirmed_agent_execution(
        actor=actor,
        session_id=session_id,
        test_input_id=test_input_id,
        expected_version=version,
        native_run_id=str(uuid4()),
        idempotency_key="two-deferred-calls",
        limits={"calls": 4, "dispatches": 4, "cost_units": 4},
    )
    ref, execution_id = context.ref, str(uuid4())
    typed_inputs: dict[str, JsonValue] = {"synthetic": True}
    effects = tuple(
        case.ledger.intent.model_copy(
            update={
                "key": OperationKey(
                    invocation_id=ref.invocation_id,
                    occurrence_path=(execution_id, "core_tool", f"call-{index}"),
                    cursor=0,
                ),
                "parameters": {"limit": index},
                "input_digest": canonical_digest(typed_inputs),
            }
        )
        for index in (1, 2)
    )
    bindings: dict[str, dict[str, JsonValue]] = {}
    descriptors: dict[str, dict[str, JsonValue]] = {}
    for effect in effects:
        identity = operation_digest(effect.key)
        bindings[identity] = NativeBinding(
            intent_digest=canonical_digest(effect.model_dump(mode="json")),
            kind="tool",
            resource_ref=effect.resource_ref,
            implementation_revision=effect.implementation_revision,
            account_ref=effect.account_ref,
            capability_digest=effect.capability_digest,
            resource_version="fixture-current-pin",
            credential_version="credential-v1",
            isolated=False,
            egress=True,
            new_data=True,
            destructive=False,
            approval_scope="operation",
            cost_units=1,
            budget={},
            execution_id=execution_id,
            invocation_digest=canonical_digest(effect.model_dump(mode="json")),
        ).model_dump(mode="json")
        descriptors[identity] = {
            "node_id": "fixture-agent",
            "agent_id": "fixture-published-agent",
            "snapshot_id": "fixture-pin",
            "snapshot_digest": "a" * 64,
            "graph_revision": context.graph_revision,
        }
    with factory.begin() as session:
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == ref.request_id)
        )
        require_instance(invocation, NativeTestInvocation).bindings = {**bindings, "_agent_operations_v1": descriptors}
    loader = OwnedNativeTestLoader(factory, actor=actor, resolver=case.ledger.metadata)
    guard, store = EffectAuthorizationService(loader), NativeExecutionStateStore(loader)
    lifecycle = NativeTestLifecycleService(loader, state_store=store)
    first = guard.before_call(ref=ref, intent=effects[0])
    assert isinstance(first, ApprovalWait)
    lifecycle.fence_pending(ref=ref, pending_operation_ids=(first.pending_operation_id,), expected_generation=0)
    second = guard.before_call(ref=ref, intent=effects[1])
    assert isinstance(second, ApprovalWait)
    assert second.pending_operation_id != first.pending_operation_id
    lifecycle.fence_pending(
        ref=ref, pending_operation_ids=(first.pending_operation_id, second.pending_operation_id), expected_generation=0
    )
    assert guard.before_call(ref=ref, intent=effects[1]) == second
    # Another execution or publication cannot join this Agent's self fence.
    for foreign_execution, foreign_snapshot in ((str(uuid4()), "fixture-pin"), (execution_id, "other-pin")):
        foreign = effects[1].model_copy(
            update={
                "key": OperationKey(
                    invocation_id=ref.invocation_id,
                    occurrence_path=(foreign_execution, "core_tool", str(uuid4())),
                    cursor=0,
                )
            }
        )
        identity = operation_digest(foreign.key)
        with factory.begin() as session:
            invocation = session.scalar(
                select(NativeTestInvocation).where(NativeTestInvocation.request_id == ref.request_id)
            )
            raw = dict(require_instance(invocation, NativeTestInvocation).bindings)
            raw[identity] = {
                **bindings[operation_digest(effects[1].key)],
                "intent_digest": canonical_digest(foreign.model_dump(mode="json")),
                "invocation_digest": canonical_digest(foreign.model_dump(mode="json")),
                "execution_id": foreign_execution,
            }
            raw["_agent_operations_v1"] = {
                **raw["_agent_operations_v1"],
                identity: {**descriptors[operation_digest(effects[1].key)], "snapshot_id": foreign_snapshot},
            }
            require_instance(invocation, NativeTestInvocation).bindings = raw
        assert guard.before_call(ref=ref, intent=foreign) == first
    with factory() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(NativeEffectAttempt)
                .where(NativeEffectAttempt.request_id == ref.request_id)
            )
            == 0
        )
        assert require_instance(session.get(NativeTestScope, ref.request_id), NativeTestScope).spent_calls == 0
        pending = session.scalars(
            select(NativePendingAction).where(NativePendingAction.request_id == ref.request_id)
        ).all()
        assert {row.id for row in pending} == {first.pending_operation_id, second.pending_operation_id}
        assert len({row.operation_id for row in pending}) == 2
    input_ref = store.store_node_inputs(ref=ref, generation=0, native_execution_id=execution_id, inputs=typed_inputs)
    terms = NativeApprovalTerms(
        max_calls=1,
        max_dispatches=1,
        max_cost_units=1,
        expires_at=(datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
    )
    checkpoint_payload = NativeCheckpointPayload(
        schema_version="1",
        native_run_id=require_instance(context.native_run_id, str),
        generation=0,
        generate_entity_json="{}",
        graph_runtime_state_json="{}",
        response_stream_filter_json="{}",
        child_refs=(),
        input_result_refs=(input_ref,),
        node_journals=tuple(
            NodeJournalState(
                invocation_id=ref.invocation_id,
                occurrence_path=effect.key.occurrence_path,
                input_result_ref=input_ref,
                input_digest=canonical_digest(typed_inputs),
                cursor=0,
                operation_keys=(effect.key,),
                result_refs=(),
                intents=(effect,),
            )
            for effect in effects
        ),
        approval_proposals=tuple(NativeApprovalProposal(key=effect.key, terms=terms) for effect in effects),
    )
    checkpoint = store.commit_checkpoint(ref=ref, generation=0, payload=checkpoint_payload)
    paused = lifecycle.pause(
        ref=ref,
        checkpoint=checkpoint,
        pending_operation_ids=(first.pending_operation_id, second.pending_operation_id),
        expected_generation=0,
    )
    if canvas_save:
        import json

        from models.workflow import Workflow

        with factory.begin() as session:
            workflow = session.get(Workflow, context.workflow_id)
            graph = json.loads(require_instance(workflow, Workflow).graph)
            graph["viewport"] = {"x": 8, "y": 21, "zoom": 0.7}
            graph["nodes"][0]["positionAbsolute"] = {"x": 8, "y": 21}
            require_instance(workflow, Workflow).graph = json.dumps(graph, separators=(",", ":"))
    selected = store.read_checkpoint(ref=ref, checkpoint=paused.checkpoint)
    assert tuple(intent for journal in selected.node_journals for intent in journal.intents) == effects
    assert tuple(proposal.key for proposal in selected.approval_proposals) == tuple(effect.key for effect in effects)

    class FixtureDisclosure:
        def describe(self, *, actor: Actor, resolved: ResolvedPendingIntent) -> PendingActionDisclosure:
            assert actor == loader.actor
            with factory() as session:
                operation = session.scalar(
                    select(NativeEffectOperation).where(
                        NativeEffectOperation.request_id == ref.request_id,
                        NativeEffectOperation.operation_digest == operation_digest(resolved.intent.key),
                    )
                )
                pending = session.scalar(
                    select(NativePendingAction).where(
                        NativePendingAction.operation_id == require_instance(operation, NativeEffectOperation).id
                    )
                )
                return PendingActionDisclosure(
                    pending_operation_id=require_instance(pending, NativePendingAction).id,
                    wait_reason="approval",
                    version=1,
                    scope_digest=require_instance(pending, NativePendingAction).owner_version,
                    account_label="inert fixture account",
                    action="fixture tool",
                    target=None,
                    parameters_summary=resolved.intent.parameters,
                    risk_notice="No provider I/O in this SQL component test",
                    required_configuration=(),
                    native_form_ref=None,
                    approval_limits=terms,
                )

    api = NativeTestApiService(
        session_factory=factory,
        actor=actor,
        resolver=case.ledger.metadata,
        admission=None,
        resolution=None,
        runtime=None,
        disclosure=FixtureDisclosure(),
    )
    receipt = api.get(actor=actor, session_id=session_id, request_id=ref.request_id)
    for item in receipt.pending:
        api.decide(
            actor=actor,
            session_id=session_id,
            request_id=ref.request_id,
            pending_operation_id=item.pending_operation_id,
            decision="confirm",
            scope_digest=require_instance(item.scope_digest, str),
            expected_version=receipt.version,
            idempotency_key="decision-" + item.pending_operation_id,
        )
    with factory() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(NativeEffectGrant)
                .where(NativeEffectGrant.request_id == ref.request_id)
            )
            == 2
        )
        assert (
            session.scalar(
                select(func.count())
                .select_from(NativeEffectAttempt)
                .where(NativeEffectAttempt.request_id == ref.request_id)
            )
            == 0
        )


class AgentAdmissionArguments(TypedDict, closed=True):
    actor: Actor
    session_id: str
    test_input_id: str
    expected_version: int
    native_run_id: str
    idempotency_key: str
    limits: dict[str, int]


type ClaimedShellAck = tuple[
    ContinuationCase, AgentOperationService, NativeAgentEndpointContext, AgentPhysicalDispatchPayload
]


class AsyncConfigQuery(TypedDict, closed=True):
    context: NativeAgentEndpointContext
    envelope: AgentPhysicalDispatchPayload
    operations: AgentOperationService
    tenant_id: str
    user_id: str
    agent_id: str
    config_version_id: str
    config_version_kind: str


@pytest.fixture(params=["shell_run"])
def claimed_shell_ack(
    continuation_case: ContinuationCase, monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest
) -> ClaimedShellAck:
    """Real SQL/encrypted state; current prepared owner and physical GET are controlled seams."""
    from dify_agent.protocol.native_testing import AgentShellJobStatus

    from models.dify_builder_native_tests import NativeTestInvocation
    from runtime_contracts.builder.execution import canonical_digest
    from runtime_contracts.builder.native.agent_contracts import (
        AgentParentNodeRef,
        AgentPreparedConfig,
        AgentTestWorkspaceRef,
    )
    from runtime_contracts.builder.native.contracts import operation_digest
    from services.dify_builder.native_testing.agent_lineage import NativeAgentEndpointContext
    from services.dify_builder.native_testing.agent_operations import AgentOperationService

    case = continuation_case
    boundary = request.param
    assert isinstance(boundary, str)
    original_key = operation_digest(case.ledger.intent.key)
    effect = case.ledger.intent.model_copy(
        update={
            "kind": "bootstrap" if boundary == "bootstrap" else "shell",
            "key": case.ledger.intent.key.model_copy(update={"occurrence_path": ("node", boundary, "call")}),
        }
    )
    case.ledger.intent = effect
    with case.factory.begin() as session:
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == case.ref.request_id)
        )
        raw = dict(require_instance(invocation, NativeTestInvocation).bindings)
        key = operation_digest(effect.key)
        raw[key] = {
            **raw.pop(original_key),
            "kind": effect.kind,
            "intent_digest": canonical_digest(effect.model_dump(mode="json")),
        }
        require_instance(invocation, NativeTestInvocation).bindings = raw
    prepared = AgentPreparedConfig(
        parent_node=AgentParentNodeRef(
            ref=case.ref, execution_id=str(uuid4()), input_result_ref="input", input_digest="a" * 64
        ),
        workflow_native_run_id="native-run",
        config_ref="protected-config",
        config_digest="a" * 64,
        workspace=AgentTestWorkspaceRef(
            binding_id="binding",
            workspace_id="workspace",
            backend_binding_ref="original-binding",
            backend_workspace_ref="workdir",
            pinned_snapshot_id="snapshot",
            home_snapshot_id=None,
            workspace_generation=0,
        ),
        config={
            "composition": {
                "layers": [
                    {
                        "name": "execution_context",
                        "config": {"tenant_id": case.ledger.actor.tenant_id, "user_id": case.ledger.actor.account_id},
                    },
                    {
                        "name": "config",
                        "config": {
                            "agent_id": "agent",
                            "config_version": {"id": "snapshot", "kind": "snapshot"},
                            "skills": [{"name": "check"}],
                            "files": [{"name": "input.json"}],
                        },
                    },
                ]
            }
        },
    )
    endpoint = NativeAgentEndpointContext(
        ref=AgentNativeTestRef.model_validate(case.ref.model_dump(mode="json")),
        config=prepared,
        association=None,
        native_test_profile="confirmed",
    )
    service = AgentOperationService(loader=case.store.loader, state_store=case.store, assessor=None)
    monkeypatch.setattr(service, "_endpoint", lambda _ref: endpoint)
    monkeypatch.setattr(service, "revalidate", lambda **_kwargs: None)
    monkeypatch.setattr(
        service,
        "_read_shell_job",
        lambda **_kwargs: AgentShellJobStatus(job_id="job-one", status="running", done=False, exit_code=None),
        raising=False,
    )
    case.ledger.confirm()
    permit = case.ledger.guard.before_call(ref=case.ref, intent=effect)
    assert isinstance(permit, DispatchPermit)
    envelope = payload(case, permit)
    service.claim_shell_dispatch(envelope=envelope)
    return case, service, endpoint, envelope


def test_completed_async_ack_allows_second_declared_config_read_without_dispatch(
    claimed_shell_ack: ClaimedShellAck,
) -> None:
    from dify_agent.protocol.native_testing import AgentShellJobReceipt

    from services.dify_builder.native_testing.agent_config_access import validate_config_read

    case, service, endpoint, envelope = claimed_shell_ack
    query: AsyncConfigQuery = {
        "context": endpoint,
        "envelope": envelope,
        "operations": service,
        "tenant_id": case.ledger.actor.tenant_id,
        "user_id": case.ledger.actor.account_id,
        "agent_id": "agent",
        "config_version_id": "snapshot",
        "config_version_kind": "snapshot",
    }
    validate_config_read(**query, source={"kind": "skill", "name": "check"})
    actual_result = {"output": "async ACK", "done": False}
    result_ref = service.store_result(
        ref=envelope.ref,
        key=envelope.intent.key,
        result=actual_result,
        native_dispatch=envelope.model_dump(mode="json"),
        shell_job=AgentShellJobReceipt(
            binding_ref="original-binding", job_id="job-one", status="running", done=False, exit_code=None
        ),
    )
    validate_config_read(**query, source={"kind": "file", "name": "input.json"})
    assert case.store.load_result(ref=case.ref, result_ref=result_ref) == actual_result
    assert isinstance(case.ledger.guard.before_call(ref=case.ref, intent=case.ledger.intent), RecordedResult)
    with pytest.raises(BuilderExecutionPolicyError):
        service.validate_claimed_shell(envelope=envelope)
    with pytest.raises(BuilderExecutionPolicyError):
        service.claim_shell_dispatch(envelope=envelope)
    assert case.ledger.dispatched_attempt_count() == 1
    with case.factory() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(NativeEffectDispatchClaim)
                .where(NativeEffectDispatchClaim.request_id == case.ref.request_id)
            )
            == 1
        )


@pytest.mark.parametrize(
    "failure",
    [
        "missing",
        "wrong-job",
        "terminal",
        "404",
        "timeout",
        "unknown",
        "cancel",
        "expired",
        "wrong-attempt",
        "wrong-binding",
        "wrong-snapshot",
        "wrong-owner",
        "cancel-during-status",
        "expired-during-status",
        "owner-during-status",
    ],
)
def test_completed_shell_config_read_refuses_uncertain_or_foreign_authority(
    claimed_shell_ack: ClaimedShellAck, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    from dataclasses import replace
    from datetime import datetime, timedelta

    from dify_agent.protocol.native_testing import AgentShellJobReceipt, AgentShellJobStatus

    case, service, endpoint, envelope = claimed_shell_ack
    receipt = AgentShellJobReceipt(
        binding_ref="original-binding", job_id="job-one", status="running", done=False, exit_code=None
    )
    service.store_result(
        ref=envelope.ref,
        key=envelope.intent.key,
        result={"output": "job-one running", "done": False, "shell_job": receipt.model_dump(mode="json")},
        native_dispatch=envelope.model_dump(mode="json"),
        shell_job=None if failure == "missing" else receipt,
    )
    observed: list[dict[str, str]] = []

    def status(**kwargs: str) -> AgentShellJobStatus:
        observed.append(kwargs)
        if failure in {"404", "timeout"}:
            raise FileNotFoundError() if failure == "404" else TimeoutError()
        if failure == "cancel-during-status":
            with case.factory.begin() as session:
                scope = session.scalar(select(NativeTestScope).where(NativeTestScope.request_id == case.ref.request_id))
                require_instance(scope, NativeTestScope).cancelled = True
        if failure == "expired-during-status":
            now = datetime.fromisoformat(envelope.permit.expires_at) + timedelta(seconds=1)
            service.bridge.authorization.clock = lambda: now
        if failure == "owner-during-status":
            changed = endpoint.config.model_copy(update={"config_ref": "foreign-after-status"})
            monkeypatch.setattr(service, "_endpoint", lambda _ref: replace(endpoint, config=changed))
        if failure == "unknown":
            return AgentShellJobStatus.model_construct(job_id="job-one", status="unknown", done=False, exit_code=None)
        return AgentShellJobStatus(
            job_id="other-job" if failure == "wrong-job" else "job-one",
            status="exited" if failure == "terminal" else "running",
            done=failure == "terminal",
            exit_code=0 if failure == "terminal" else None,
        )

    monkeypatch.setattr(service, "_read_shell_job", status, raising=False)
    if failure == "cancel":
        with case.factory.begin() as session:
            scope = session.scalar(select(NativeTestScope).where(NativeTestScope.request_id == case.ref.request_id))
            require_instance(scope, NativeTestScope).cancelled = True
    if failure == "expired":
        now = datetime.fromisoformat(envelope.permit.expires_at) + timedelta(seconds=1)
        service.bridge.authorization.clock = lambda: now
    if failure == "wrong-attempt":
        envelope = envelope.model_copy(
            update={"permit": envelope.permit.model_copy(update={"attempt_id": str(uuid4())})}
        )
    if failure in {"wrong-binding", "wrong-snapshot", "wrong-owner"}:
        if failure == "wrong-binding":
            changed = endpoint.config.model_copy(
                update={"workspace": endpoint.config.workspace.model_copy(update={"backend_binding_ref": "foreign"})}
            )
        elif failure == "wrong-snapshot":
            changed = endpoint.config.model_copy(update={"config_ref": "other-snapshot"})
        else:
            changed = endpoint.config.model_copy(
                update={"parent_node": endpoint.config.parent_node.model_copy(update={"execution_id": str(uuid4())})}
            )
        monkeypatch.setattr(service, "_endpoint", lambda _ref: replace(endpoint, config=changed))
    with pytest.raises(BuilderExecutionPolicyError):
        service.validate_config_read_shell(envelope=envelope)
    if failure in {"missing", "cancel", "expired", "wrong-attempt", "wrong-binding", "wrong-snapshot", "wrong-owner"}:
        assert observed == []
    assert case.ledger.dispatched_attempt_count() == 1
    with case.factory() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(NativeEffectDispatchClaim)
                .where(NativeEffectDispatchClaim.request_id == case.ref.request_id)
            )
            == 1
        )


@pytest.mark.parametrize("failure", ["storage", "conflict"])
def test_receipt_failure_preserves_known_completed_ack_and_refuses_config_read(
    claimed_shell_ack: ClaimedShellAck, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    from dify_agent.protocol.native_testing import AgentShellJobReceipt

    from runtime_contracts.builder.native.contracts import NativeTestContextRef
    from services.dify_builder.native_testing.state_store import ObjectReceipt, PayloadKind

    case, service, _endpoint, envelope = claimed_shell_ack
    logical_key = service._shell_ack_key(envelope)
    if failure == "conflict":
        conflicting = case.store.prepare_object(
            ref=case.ref,
            tenant_id=case.ledger.actor.tenant_id,
            kind="result",
            logical_key=logical_key,
            payload={"conflicting": "immutable receipt"},
        )
        with case.store.loader.locked(ref=case.ref) as (session, _, _):
            case.store.acknowledge_object(session, conflicting)
    else:
        prepare = case.store.prepare_object

        def unavailable_receipt(
            *,
            ref: NativeTestContextRef,
            tenant_id: str,
            kind: PayloadKind,
            logical_key: str,
            payload: JsonValue,
            max_bytes: int | None = None,
        ) -> ObjectReceipt:
            if logical_key.startswith("agent-shell-ack:"):
                raise OSError("test metadata storage unavailable")
            return prepare(
                ref=ref, tenant_id=tenant_id, kind=kind, logical_key=logical_key, payload=payload, max_bytes=max_bytes
            )

        monkeypatch.setattr(case.store, "prepare_object", unavailable_receipt)
    result = {"output": "known asynchronous ACK"}
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_job_unavailable"):
        service.store_result(
            ref=envelope.ref,
            key=envelope.intent.key,
            result=result,
            native_dispatch=envelope.model_dump(mode="json"),
            shell_job=AgentShellJobReceipt(
                binding_ref="original-binding", job_id="job-one", status="running", done=False, exit_code=None
            ),
        )
    replay = case.ledger.guard.before_call(ref=case.ref, intent=case.ledger.intent)
    assert isinstance(replay, RecordedResult)
    assert case.store.load_result(ref=case.ref, result_ref=replay.result_ref) == result
    with pytest.raises(BuilderExecutionPolicyError):
        service.validate_config_read_shell(envelope=envelope)
    with pytest.raises(BuilderExecutionPolicyError):
        service.claim_shell_dispatch(envelope=envelope)
    assert case.ledger.dispatched_attempt_count() == 1


@pytest.mark.parametrize(
    "claimed_shell_ack", ["bootstrap", "shell_wait", "shell_input", "shell_interrupt", "config_pull"], indirect=True
)
def test_completed_ack_exception_is_exclusive_to_original_shell_run(claimed_shell_ack: ClaimedShellAck) -> None:
    from dify_agent.protocol.native_testing import AgentShellJobReceipt

    case, service, _endpoint, envelope = claimed_shell_ack
    service.store_result(
        ref=envelope.ref,
        key=envelope.intent.key,
        result="ACK",
        native_dispatch=envelope.model_dump(mode="json"),
        shell_job=AgentShellJobReceipt(
            binding_ref="original-binding", job_id="job-one", status="running", done=False, exit_code=None
        ),
    )
    with pytest.raises(BuilderExecutionPolicyError):
        service.validate_config_read_shell(envelope=envelope)
    assert case.ledger.dispatched_attempt_count() == 1


@pytest.mark.parametrize("outcome", ["unknown", "failed", "not_dispatched"])
def test_noncompleted_outcome_never_unlocks_config_read(claimed_shell_ack: ClaimedShellAck, outcome: str) -> None:
    from runtime_contracts.builder.native.contracts import Outcome
    from services.dify_builder.native_testing.agent_bridge import api_permit

    case, service, _endpoint, envelope = claimed_shell_ack
    assert outcome in {"unknown", "failed", "not_dispatched"}
    choices: dict[str, Outcome] = {"unknown": "unknown", "failed": "failed", "not_dispatched": "not_dispatched"}
    checked = choices[outcome]
    service.bridge.authorization.record_outcome(permit=api_permit(envelope.permit), outcome=checked, result_ref=None)
    with pytest.raises(BuilderExecutionPolicyError):
        service.validate_config_read_shell(envelope=envelope)
    assert case.ledger.dispatched_attempt_count() == 1


def test_cancellation_during_final_ack_decryption_refuses_url_admission(
    claimed_shell_ack: ClaimedShellAck, monkeypatch: pytest.MonkeyPatch
) -> None:
    from dify_agent.protocol.native_testing import AgentShellJobReceipt

    from models.dify_builder_native_tests import NativePayloadObject
    from services.dify_builder.native_testing.state_store import ObjectReceipt

    case, service, _endpoint, envelope = claimed_shell_ack
    service.store_result(
        ref=envelope.ref,
        key=envelope.intent.key,
        result="known ACK",
        native_dispatch=envelope.model_dump(mode="json"),
        shell_job=AgentShellJobReceipt(
            binding_ref="original-binding", job_id="job-one", status="running", done=False, exit_code=None
        ),
    )
    read = case.store._read_object
    reads = 0

    def cancel_on_final_decryption(
        row: NativePayloadObject | ObjectReceipt, *, max_bytes: int | None = None
    ) -> JsonValue:
        nonlocal reads
        value = read(row, max_bytes=max_bytes)
        if row.logical_key.startswith("agent-shell-ack:"):
            reads += 1
            if reads == 2:
                with case.factory.begin() as session:
                    scope = session.scalar(
                        select(NativeTestScope).where(NativeTestScope.request_id == case.ref.request_id)
                    )
                    require_instance(scope, NativeTestScope).cancelled = True
        return value

    monkeypatch.setattr(case.store, "_read_object", cancel_on_final_decryption)
    with pytest.raises(BuilderExecutionPolicyError):
        service.validate_config_read_shell(envelope=envelope)
    assert reads == 2
    assert case.ledger.dispatched_attempt_count() == 1


@pytest.mark.parametrize("paused", [False, True])
@pytest.mark.parametrize(
    "closed", [None, "cancelled", "expired", "unknown", "terminal", "invalid-pending", "wrong-reason"]
)
def test_existing_live_shell_config_read_survives_later_approval_wait(
    claimed_shell_ack: ClaimedShellAck, paused: bool, closed: str | None
) -> None:
    from dify_agent.protocol.native_testing import AgentShellJobReceipt

    from models.dify_builder_native_tests import NativeTestInvocation
    from runtime_contracts.builder.execution import canonical_digest
    from runtime_contracts.builder.native.contracts import operation_digest

    case, service, _endpoint, envelope = claimed_shell_ack
    service.store_result(
        ref=envelope.ref,
        key=envelope.intent.key,
        result="running ACK",
        native_dispatch=envelope.model_dump(mode="json"),
        shell_job=AgentShellJobReceipt(
            binding_ref="original-binding", job_id="job-one", status="running", done=False, exit_code=None
        ),
    )
    original = case.ledger.intent
    wait = original.model_copy(
        update={
            "key": original.key.model_copy(update={"occurrence_path": ("node", "shell_wait", "next")}),
            "parameters": {"job_id": "job-one"},
        }
    )
    with case.factory.begin() as session:
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == case.ref.request_id)
        )
        invocation = require_instance(invocation, NativeTestInvocation)
        raw = dict(invocation.bindings)
        raw[operation_digest(wait.key)] = {
            **raw[operation_digest(original.key)],
            "intent_digest": canonical_digest(wait.model_dump(mode="json")),
        }
        invocation.bindings = raw
    pending = case.ledger.guard.before_call(ref=case.ref, intent=wait)
    assert isinstance(pending, ApprovalWait)
    if paused:
        case.lifecycle.pause(
            ref=case.ref,
            checkpoint=case.checkpoint(),
            pending_operation_ids=(pending.pending_operation_id,),
            expected_generation=0,
        )
    else:
        case.lifecycle.fence_pending(
            ref=case.ref, pending_operation_ids=(pending.pending_operation_id,), expected_generation=0
        )
    if closed is not None:
        from datetime import datetime, timedelta

        from models.dify_builder_native_tests import NativeInvocationState

        if closed == "expired":
            now = datetime.fromisoformat(envelope.permit.expires_at) + timedelta(seconds=1)
            service.bridge.authorization.clock = lambda: now
        else:
            with case.factory.begin() as session:
                if closed == "cancelled":
                    scope = session.scalar(
                        select(NativeTestScope).where(NativeTestScope.request_id == case.ref.request_id)
                    )
                    require_instance(scope, NativeTestScope).cancelled = True
                else:
                    state = session.scalar(
                        select(NativeInvocationState).where(NativeInvocationState.request_id == case.ref.request_id)
                    )
                    state = require_instance(state, NativeInvocationState)
                    if closed in {"unknown", "terminal"}:
                        state.state = "unknown" if closed == "unknown" else "completed"
                    elif closed == "invalid-pending":
                        state.pending_ids = [str(uuid4())]
                    else:
                        state.wait_reason = "interaction"
        with pytest.raises(BuilderExecutionPolicyError):
            service.validate_config_read_shell(envelope=envelope)
    else:
        service.validate_config_read_shell(envelope=envelope)
    assert case.ledger.dispatched_attempt_count() == 1
    with pytest.raises(BuilderExecutionPolicyError):
        service.claim_shell_dispatch(envelope=envelope)
