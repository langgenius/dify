"""Normal CI: actual signed Console wrappers plus PostgreSQL native owners.

These exercise the API boundary, not a qualified Graphon execution.
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from libs.passport import PassportService
from libs.token import _real_cookie_name, generate_csrf_token
from models.account import Account
from models.model import DifySetup
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    continuation_case as continuation_case,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    ledger_case as ledger_case,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    native_owner as native_owner,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    no_live as no_live,  # noqa: PLC0414
)


@pytest.fixture
def console_case(flask_app_with_containers, continuation_case, monkeypatch):
    from controllers.console import dify_builder as controller
    from controllers.console import wraps
    from extensions.ext_database import db

    case = continuation_case
    with case.factory.begin() as session:
        session.get(Account, case.ledger.actor.account_id).status = "active"
        if session.scalar(select(DifySetup).limit(1)) is None:
            session.add(DifySetup(version="native-console-ci"))
    # Login, CSRF and SQL ownership use real owners. Entitlement and capability
    # metadata are synthetic; RBAC tests stub the external access RPC explicitly.
    from types import SimpleNamespace

    monkeypatch.setattr(
        controller.FeatureService, "get_features", lambda _tenant: SimpleNamespace(dify_builder_enabled=True)
    )
    wraps._is_setup_completed.reset_success()
    db.session.close()
    client = flask_app_with_containers.test_client()
    token = PassportService().issue(
        {"user_id": case.ledger.actor.account_id, "exp": int(datetime.now(UTC).timestamp()) + 600}
    )
    csrf = generate_csrf_token(case.ledger.actor.account_id)
    client.set_cookie(_real_cookie_name(COOKIE_NAME_CSRF_TOKEN), csrf)
    client.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    client.environ_base[f"HTTP_{HEADER_NAME_CSRF_TOKEN.upper().replace('-', '_')}"] = csrf
    with case.factory() as session:
        from models.dify_builder import DifyBuilderExecutionRequest

        session_id = session.get(DifyBuilderExecutionRequest, case.ref.request_id).session_id
    case.client = client
    case.url = f"/console/api/dify-builder/sessions/{session_id}/native-tests"
    yield case
    wraps._is_setup_completed.reset_success()


def test_native_console_unauthenticated_is_rejected(console_case):
    c = console_case
    response = c.client.post(c.url, json={}, headers={"Authorization": ""})
    assert response.status_code == 401
    assert c.ledger.dispatched_attempt_count() == 0


def test_native_console_invalid_csrf_is_rejected(console_case):
    c = console_case
    response = c.client.post(c.url, json={}, headers={HEADER_NAME_CSRF_TOKEN: "invalid"})
    assert response.status_code == 401
    assert c.ledger.dispatched_attempt_count() == 0


def test_decision_cannot_replace_effect_parameters(console_case):
    c = console_case
    waiting = c.pause()
    response = c.client.post(
        c.url + f"/{c.ref.request_id}/decisions",
        json={
            "schema_version": "builder-native-test-v1",
            "pending_operation_id": waiting.pending_operation_ids[0],
            "decision": "confirm",
            "scope_digest": "a" * 64,
            "expected_version": 1,
            "idempotency_key": "decision-1",
            "parameters": {"recipient": "changed@example.invalid"},
        },
    )
    assert response.status_code == 400
    assert "changed@example.invalid" not in response.get_data(as_text=True)
    assert c.ledger.dispatched_attempt_count() == 0


class ConsoleDisclosure:
    """Qualified test disclosure for a single immutable approval proposal."""

    def __init__(self, effect, item):
        self.effect, self.item = effect, item

    def describe(self, *, actor, resolved):
        assert actor.account_id
        assert resolved.intent == self.effect
        return self.item


def _prepare_approval(c, ref, effect):
    from datetime import timedelta

    from models.dify_builder_native_tests import NativePendingAction, NativeTestInvocation
    from services.dify_builder.execution_contracts import canonical_digest
    from services.dify_builder.native_testing.approval_contracts import NativeApprovalProposal, NativeApprovalTerms
    from services.dify_builder.native_testing.contracts import operation_digest
    from services.dify_builder.native_testing.public_contracts import PendingActionDisclosure
    from services.dify_builder.native_testing.runtime_contracts import NativeCheckpointPayload, NodeJournalState

    # Input and future effect output are distinct immutable result slots.
    inputs = {"limit": 1}
    effect = effect.model_copy(update={"input_digest": canonical_digest(inputs)})
    input_key = effect.key.model_copy(update={"occurrence_path": (*effect.key.occurrence_path, "input")})
    assert input_key != effect.key
    input_ref = c.store.store_result(ref=ref, key=input_key, result=inputs)
    with c.factory.begin() as session:
        root = session.scalar(
            select(NativeTestInvocation).where(
                NativeTestInvocation.request_id == c.ref.request_id,
                NativeTestInvocation.invocation_id == c.ref.invocation_id,
            )
        )
        invocation = session.scalar(
            select(NativeTestInvocation).where(
                NativeTestInvocation.request_id == ref.request_id,
                NativeTestInvocation.invocation_id == ref.invocation_id,
            )
        )
        binding = dict(root.bindings[operation_digest(c.ledger.intent.key)])
        binding["intent_digest"] = canonical_digest(effect.model_dump(mode="json"))
        invocation.bindings = {**invocation.bindings, operation_digest(effect.key): binding}
    waiting = c.ledger.guard.before_call(ref=ref, intent=effect)
    terms = NativeApprovalTerms(
        max_calls=2,
        max_dispatches=2,
        max_cost_units=20,
        expires_at=(datetime.now(UTC) + timedelta(minutes=3)).isoformat(),
    )
    context = c.store.load_context(ref=ref)
    cp = c.store.commit_checkpoint(
        ref=ref,
        generation=0,
        payload=NativeCheckpointPayload(
            schema_version="1",
            native_run_id=context.native_run_id,
            generation=0,
            generate_entity_json='{"private":"secret-value"}',
            graph_runtime_state_json="{}",
            response_stream_filter_json="{}",
            child_refs=(),
            input_result_refs=(input_ref,),
            node_journals=(
                NodeJournalState(
                    invocation_id=effect.key.invocation_id,
                    occurrence_path=effect.key.occurrence_path,
                    input_result_ref=input_ref,
                    input_digest=canonical_digest(inputs),
                    cursor=0,
                    operation_keys=(effect.key,),
                    result_refs=(),
                    intents=(effect,),
                ),
            ),
            approval_proposals=(NativeApprovalProposal(key=effect.key, terms=terms),),
        ),
    )
    c.lifecycle.pause(
        ref=ref, checkpoint=cp, pending_operation_ids=(waiting.pending_operation_id,), expected_generation=0
    )
    with c.factory() as session:
        scope = session.get(NativePendingAction, waiting.pending_operation_id).owner_version
    item = PendingActionDisclosure(
        pending_operation_id=waiting.pending_operation_id,
        wait_reason="approval",
        version=1,
        scope_digest=scope,
        account_label="Synthetic CI account",
        action="mail.read",
        target={"mailbox": "inbox"},
        parameters_summary={"limit": 1},
        risk_notice="Read up to two times",
        required_configuration=(),
        native_form_ref=None,
        approval_limits=terms,
    )
    return effect, item


def _install_approval_api(c, monkeypatch, effect, item):
    from controllers.console import dify_builder as controller
    from services.dify_builder.native_testing.api_service import NativeTestApiService

    c.pending_id, c.scope_digest = item.pending_operation_id, item.scope_digest
    c.api = NativeTestApiService(
        session_factory=c.factory,
        actor=c.ledger.actor,
        resolver=c.ledger.metadata,
        admission=None,
        resolution=c.resolution,
        runtime=None,
        disclosure=ConsoleDisclosure(effect, item),
    )
    monkeypatch.setattr(controller, "build_native_test_api_service", lambda **_kwargs: c.api)
    c.body = {
        "schema_version": "builder-native-test-v1",
        "pending_operation_id": c.pending_id,
        "decision": "confirm",
        "scope_digest": c.scope_digest,
        "expected_version": 1,
        "idempotency_key": "decision-1",
    }


@pytest.fixture
def pending_console(console_case, monkeypatch):
    c = console_case
    effect, item = _prepare_approval(c, c.ref, c.ledger.intent)
    c.ledger.intent = effect
    _install_approval_api(c, monkeypatch, effect, item)
    return c


def test_protected_checkpoint_roundtrip_disclosure_and_same_key_receipt(pending_console):
    c = pending_console
    url = c.url + f"/{c.ref.request_id}/decisions"
    first = c.client.post(url, json=c.body)
    assert first.status_code == 200, first.get_json()
    second = c.client.post(url, json=c.body)
    assert second.status_code == 200
    assert second.get_json() == first.get_json()
    assert first.get_json()["data"]["pending"][0]["approval_limits"]["max_calls"] == 2
    for forbidden in ("secret-value", "context_digest", "permit_id", "input_digest", "implementation_revision"):
        assert forbidden not in first.get_data(as_text=True)
    assert c.ledger.dispatched_attempt_count() == 0


def test_same_key_different_decision_conflicts_without_dispatch(pending_console):
    c = pending_console
    url = c.url + f"/{c.ref.request_id}/decisions"
    assert c.client.post(url, json=c.body).status_code == 200
    assert c.client.post(url, json={**c.body, "decision": "deny"}).status_code == 409
    assert c.ledger.dispatched_attempt_count() == 0


@pytest.mark.parametrize("changes", [{"scope_digest": "f" * 64}, {"expected_version": 2}])
def test_stale_scope_and_version_cannot_approve(pending_console, changes):
    c = pending_console
    assert c.client.post(c.url + f"/{c.ref.request_id}/decisions", json={**c.body, **changes}).status_code == 409
    assert c.ledger.dispatched_attempt_count() == 0


def test_current_resource_rotation_cannot_approve(pending_console):
    c = pending_console
    c.ledger.metadata.credential_version = "rotated"
    assert c.client.post(c.url + f"/{c.ref.request_id}/decisions", json=c.body).status_code == 409
    assert c.ledger.dispatched_attempt_count() == 0


def _claim_approved_generation(c):
    generation = c.store.load_context(ref=c.ref).generation
    receipt = c.api.lifecycle.resume(
        actor=c.ledger.actor,
        request_id=c.ref.request_id,
        expected_generation=generation,
        idempotency_key="confirmed-console-resume",
    )
    assert c.api.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)


def test_frozen_two_call_proposal_cannot_authorize_third_call(pending_console):
    from services.dify_builder.native_testing.contracts import ApprovalWait, DispatchPermit

    c = pending_console
    second, third = c.ledger.occurrence(1), c.ledger.occurrence(2)
    assert c.client.post(c.url + f"/{c.ref.request_id}/decisions", json=c.body).status_code == 200
    _claim_approved_generation(c)
    assert isinstance(c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent), DispatchPermit)
    assert isinstance(c.ledger.guard.before_call(ref=c.ref, intent=second), DispatchPermit)
    assert isinstance(c.ledger.guard.before_call(ref=c.ref, intent=third), ApprovalWait)
    assert c.ledger.dispatched_attempt_count() == 2


def test_cross_session_request_is_not_visible(pending_console):
    from uuid import uuid4

    c = pending_console
    response = c.client.get(f"/console/api/dify-builder/sessions/{uuid4()}/native-tests/{c.ref.request_id}")
    assert response.status_code == 404


@pytest.mark.parametrize("qualified_disclosure", [True, False])
def test_old_checkpoint_without_full_intent_fails_closed(console_case, monkeypatch, qualified_disclosure):
    from types import SimpleNamespace

    from controllers.console import dify_builder as controller
    from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.api_service import NativeTestApiService

    c = console_case
    failures = []

    def never_disclose(**_kwargs):
        pytest.fail("missing full intent must fail before disclosure")

    wait = c.pause()
    service = NativeTestApiService(
        session_factory=c.factory,
        actor=c.ledger.actor,
        resolver=c.ledger.metadata,
        admission=None,
        resolution=c.resolution,
        runtime=None,
        disclosure=SimpleNamespace(describe=never_disclose) if qualified_disclosure else None,
    )
    original_load = service.pending.load

    def observed_load(**kwargs):
        try:
            return original_load(**kwargs)
        except BuilderExecutionPolicyError as error:
            failures.append(error.reason_code)
            raise

    monkeypatch.setattr(service.pending, "load", observed_load)
    monkeypatch.setattr(controller, "build_native_test_api_service", lambda **_kwargs: service)
    response = c.client.post(
        c.url + f"/{c.ref.request_id}/decisions",
        json={
            "schema_version": "builder-native-test-v1",
            "pending_operation_id": wait.pending_operation_ids[0],
            "decision": "confirm",
            "scope_digest": "a" * 64,
            "expected_version": 1,
            "idempotency_key": "decision",
        },
    )
    assert response.status_code == (409 if qualified_disclosure else 503)
    assert failures == (["native_pending_intent_unavailable"] if qualified_disclosure else [])
    assert c.ledger.dispatched_attempt_count() == 0


def test_current_test_run_permission_is_required(pending_console, monkeypatch):
    from uuid import uuid4

    from configs import dify_config
    from core.rbac import RBACPermission
    from models.model import App
    from services.enterprise.rbac_service import RBACService

    c = pending_console
    with c.factory.begin() as session:
        session.get(App, c.context.app_id).maintainer = str(uuid4())
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    scenes = []

    def check(_tenant, _actor, *, scene, resource_type, resource_id):
        assert resource_type is not None
        assert resource_id == c.context.app_id
        scenes.append(scene)
        return scene != RBACPermission.APP_TEST_AND_RUN

    monkeypatch.setattr(RBACService.CheckAccess, "check", check)
    assert c.client.get(c.url + f"/{c.ref.request_id}").status_code == 403
    assert RBACPermission.APP_TEST_AND_RUN in scenes
    assert c.ledger.dispatched_attempt_count() == 0


def test_actual_child_permission_revocation_blocks_root_public_receipt(console_case, monkeypatch):
    from uuid import uuid4

    from sqlalchemy import inspect

    from configs import dify_config
    from models.model import App
    from models.workflow import Workflow
    from services.enterprise.rbac_service import RBACService
    from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import _child_case

    c = console_case
    with c.factory.begin() as session:
        original = session.get(App, c.context.app_id)
        app = App(**{col.key: getattr(original, col.key) for col in inspect(App).column_attrs if col.key != "id"})
        app.id, app.maintainer = str(uuid4()), str(uuid4())
        source = session.get(Workflow, c.context.workflow_id)
        workflow = Workflow(
            **{col.key: getattr(source, col.key) for col in inspect(Workflow).column_attrs if col.key != "id"}
        )
        workflow.id, workflow.app_id = str(uuid4()), app.id
        app.workflow_id = workflow.id
        session.add_all((app, workflow))
        child_app, child_workflow = app.id, workflow.id
    _child_case(c, app_id=child_app, workflow_id=child_workflow)
    effect, item = _prepare_approval(c, c.ref, c.ledger.intent)
    _install_approval_api(c, monkeypatch, effect, item)
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    checked = []

    def check(_tenant, _actor, *, scene, resource_type, resource_id):
        assert scene is not None
        assert resource_type is not None
        checked.append(resource_id)
        return resource_id == c.context.app_id

    monkeypatch.setattr(RBACService.CheckAccess, "check", check)
    monkeypatch.setattr(c.api.store, "_read_object", lambda *_: pytest.fail("private decrypt before child permission"))
    response = c.client.get(c.url + f"/{c.ref.request_id}")
    assert response.status_code == 403
    assert child_app in checked


def test_generation_changes_after_protected_read_cannot_write_grant(pending_console, monkeypatch):
    from sqlalchemy import func

    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import NativeEffectGrant, NativeInvocationState

    c = pending_console
    original = c.api.authorization.decide

    def changed_generation(**kwargs):
        ref = kwargs["pending_guard"].resolved.ref
        with c.factory.begin() as session:
            state = session.scalar(
                select(NativeInvocationState).where(
                    NativeInvocationState.tenant_id == c.ledger.actor.tenant_id,
                    NativeInvocationState.request_id == ref.request_id,
                    NativeInvocationState.invocation_id == ref.invocation_id,
                )
            )
            assert state is not None
            state.generation += 1
        return original(**kwargs)

    monkeypatch.setattr(c.api.authorization, "decide", changed_generation)
    assert c.client.post(c.url + f"/{c.ref.request_id}/decisions", json=c.body).status_code == 409
    with c.factory() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(NativeEffectGrant)
                .where(NativeEffectGrant.request_id == c.ref.request_id)
            )
            == 0
        )
        assert session.get(DifyBuilderExecutionRequest, c.ref.request_id).observations == []
    assert c.ledger.dispatched_attempt_count() == 0


def test_auth_start_persists_compiled_context_and_replays_without_second_admission(console_case, monkeypatch):
    from controllers.console import dify_builder as controller
    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import NativeTestInvocation, NativeTestScope
    from services.dify_builder.execution_contracts import canonical_digest
    from services.dify_builder.native_testing.api_service import NativeAdmissionDependencies, NativeTestApiService
    from services.dify_builder.native_testing.context_binding import NativeAdmissionCompiler, NativeRuntimeProfile
    from services.dify_builder.native_testing.contracts import DispatchPermit, operation_digest
    from services.dify_builder.native_testing.repository import NativeBinding

    c = console_case
    launched = []

    class LaunchWitness:
        def launch(self, *, ref):
            launched.append(ref)

    compiler = NativeAdmissionCompiler(session_factory=c.factory, resources=lambda **_kwargs: ())
    profile = NativeRuntimeProfile(
        profile_id="ci-component",
        implementation_revision="ci-component-v1",
        limits={"calls": 2, "dispatches": 2, "cost_units": 20, "cpu_ms": 20},
    )
    service = NativeTestApiService(
        session_factory=c.factory,
        actor=c.ledger.actor,
        resolver=c.ledger.metadata,
        admission=NativeAdmissionDependencies(
            compiler=compiler,
            profile=profile,
            launch=LaunchWitness(),
        ),
        resolution=c.resolution,
        runtime=None,
        disclosure=None,
    )
    monkeypatch.setattr(controller, "build_native_test_api_service", lambda **_kwargs: service)
    with c.factory() as session:
        row = session.get(DifyBuilderExecutionRequest, c.ref.request_id)
        input_id = row.test_input_id
    body = {
        "schema_version": "builder-native-test-v1",
        "test_input_id": input_id,
        "expected_version": 1,
        "mode": "native",
        "idempotency_key": "start-1",
    }
    first = c.client.post(c.url, json=body)
    assert first.status_code == 200, first.get_json()
    assert first.get_json()["data"]["status"] == "prepared"
    assert first.get_json()["data"]["native_run_id"] is None
    assert c.client.post(c.url, json=body).get_json() == first.get_json()
    assert len(launched) == 1
    assert service.store.load_context(ref=launched[0]).inputs == {"boolean": True}
    assert c.client.post(c.url, json={**body, "mode": "mock"}).status_code == 409

    # Consume the actual admission row through the real C02 budget owner. The
    # fixture supplies trusted isolated-code metadata, not a business executor.
    ref = launched[0]
    with c.factory() as session:
        scope = session.get(NativeTestScope, ref.request_id)
        assert scope.profile == profile.limits
        assert all(type(value) is int for value in scope.profile.values())
    effect = c.ledger.intent.model_copy(
        update={
            "key": c.ledger.intent.key.model_copy(update={"invocation_id": ref.invocation_id}),
            "kind": "code",
            "resource_ref": "isolated.compute",
            "account_ref": None,
        }
    )
    binding = NativeBinding(
        intent_digest=canonical_digest(effect.model_dump(mode="json")),
        kind=effect.kind,
        resource_ref=effect.resource_ref,
        implementation_revision=effect.implementation_revision,
        account_ref=None,
        capability_digest=effect.capability_digest,
        resource_version="resource-v1",
        credential_version="credential-v1",
        isolated=True,
        egress=False,
        new_data=False,
        destructive=False,
        cost_units=2,
        budget={"cpu_ms": 10},
        execution_id="admitted-execution",
        invocation_digest="c" * 64,
    )
    with c.factory.begin() as session:
        invocation = session.scalar(
            select(NativeTestInvocation).where(
                NativeTestInvocation.tenant_id == c.ledger.actor.tenant_id,
                NativeTestInvocation.request_id == ref.request_id,
                NativeTestInvocation.invocation_id == ref.invocation_id,
            )
        )
        invocation.bindings = {operation_digest(effect.key): binding.model_dump(mode="json")}
    permit = service.authorization.before_call(ref=ref, intent=effect)
    assert isinstance(permit, DispatchPermit)
    reservation = service.authorization.resolve_budget_reservation(
        permit=permit,
        execution_id=binding.execution_id,
        invocation_digest=binding.invocation_digest,
    )
    assert reservation.authorize(
        execution_id=binding.execution_id,
        invocation_digest=binding.invocation_digest,
        requested={"cpu_ms": 10},
        now=datetime.now(UTC),
    ) == {"cpu_ms": 10}
    with c.factory() as session:
        scope = session.get(NativeTestScope, ref.request_id)
        assert scope.budget_spent == {"cpu_ms": 10}
        assert scope.spent_calls == 1
        assert scope.spent_dispatches == 1


def test_cancel_without_cleanup_ack_reports_cancelling(pending_console):
    c = pending_console
    response = c.client.post(
        c.url + f"/{c.ref.request_id}/cancel",
        json={"schema_version": "builder-native-test-v1", "idempotency_key": "cancel-1"},
    )
    assert response.status_code == 200
    receipt = response.get_json()["data"]
    assert receipt["cancellation"]["status"] == "cancelling"
    assert receipt["outcome"] is None
    assert receipt["status"] == "running"


def test_cleanup_ack_cannot_erase_unknown_dispatched_effect(pending_console):
    from types import SimpleNamespace

    from services.dify_builder.native_testing.contracts import DispatchPermit

    c = pending_console
    assert c.client.post(c.url + f"/{c.ref.request_id}/decisions", json=c.body).status_code == 200
    _claim_approved_generation(c)
    permit = c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent)
    assert isinstance(permit, DispatchPermit)
    c.api.lifecycle.runtime = SimpleNamespace(cancel=lambda *, refs: tuple(ref.invocation_id for ref in refs))
    response = c.client.post(
        c.url + f"/{c.ref.request_id}/cancel",
        json={"schema_version": "builder-native-test-v1", "idempotency_key": "cancel-1"},
    )
    assert response.status_code == 200
    receipt = response.get_json()["data"]
    assert receipt["cancellation"]["status"] == "unknown"
    assert receipt["cancellation"]["operation_states"][permit.operation_id] == "unknown"
    assert receipt["outcome"] == "unknown"


def test_resume_reuses_same_durable_dispatch(pending_console):
    from sqlalchemy import func

    from models.dify_builder_native_tests import NativeDispatch

    c = pending_console
    assert c.client.post(c.url + f"/{c.ref.request_id}/decisions", json=c.body).status_code == 200
    body = {"schema_version": "builder-native-test-v1", "expected_generation": 0, "idempotency_key": "resume-1"}
    url = c.url + f"/{c.ref.request_id}/resume"
    first = c.client.post(url, json=body)
    assert first.status_code == 200, first.get_json()
    assert first.get_json()["data"]["status"] == "running"
    assert c.client.post(url, json=body).get_json() == first.get_json()
    with c.factory() as session:
        assert (
            session.scalar(
                select(func.count()).select_from(NativeDispatch).where(NativeDispatch.request_id == c.ref.request_id)
            )
            == 1
        )


@pytest.mark.parametrize("category", ["configuration", "interaction"])
def test_approval_cannot_replace_configuration_or_native_form(console_case, monkeypatch, category):
    from controllers.console import dify_builder as controller
    from services.dify_builder.native_testing.api_service import NativeTestApiService
    from services.dify_builder.native_testing.pending_actions import NativePendingActionService

    c = console_case
    pending = NativePendingActionService(c.store.loader)
    wait = (
        pending.configuration(ref=c.ref, requirements_ref="configuration-1", expected_generation=0)
        if category == "configuration"
        else pending.interaction(ref=c.ref, native_form_ref="form-1", expected_generation=0)
    )
    cp = c.checkpoint()
    c.lifecycle.pause(
        ref=c.ref, checkpoint=cp, pending_operation_ids=(wait.pending_operation_id,), expected_generation=0
    )
    service = NativeTestApiService(
        session_factory=c.factory,
        actor=c.ledger.actor,
        resolver=c.ledger.metadata,
        admission=None,
        resolution=c.resolution,
        runtime=None,
        disclosure=None,
    )
    monkeypatch.setattr(controller, "build_native_test_api_service", lambda **_kwargs: service)
    read = c.client.get(c.url + f"/{c.ref.request_id}")
    assert read.status_code == 200
    item = read.get_json()["data"]["pending"][0]
    assert item["wait_reason"] == category
    assert item["approval_limits"] is None
    response = c.client.post(
        c.url + f"/{c.ref.request_id}/decisions",
        json={
            "schema_version": "builder-native-test-v1",
            "pending_operation_id": wait.pending_operation_id,
            "decision": "confirm",
            "scope_digest": "a" * 64,
            "expected_version": 1,
            "idempotency_key": "cannot-replace",
        },
    )
    assert response.status_code == 409
    assert c.ledger.dispatched_attempt_count() == 0


def test_expired_frozen_proposal_cannot_approve(pending_console):
    from datetime import timedelta

    from models.dify_builder_native_tests import NativeTestScope

    c = pending_console
    with c.factory.begin() as session:
        session.get(NativeTestScope, c.ref.request_id).expires_at = datetime.now(UTC) - timedelta(seconds=1)
    assert c.client.post(c.url + f"/{c.ref.request_id}/decisions", json=c.body).status_code == 409
    assert c.ledger.dispatched_attempt_count() == 0


@pytest.mark.parametrize("revoked_permission", ["APP_EDIT", "APP_TEST_AND_RUN"])
def test_final_child_authority_refresh_precedes_decision_write(console_case, monkeypatch, revoked_permission):
    from uuid import uuid4

    from sqlalchemy import func, inspect

    from configs import dify_config
    from core.rbac import RBACPermission
    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import NativeEffectGrant
    from models.model import App
    from models.workflow import Workflow
    from services.enterprise.rbac_service import RBACService
    from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import _child_case

    c = console_case
    with c.factory.begin() as session:
        original = session.get(App, c.context.app_id)
        child_app = App(**{col.key: getattr(original, col.key) for col in inspect(App).column_attrs if col.key != "id"})
        child_app.id, child_app.maintainer = str(uuid4()), str(uuid4())
        source = session.get(Workflow, c.context.workflow_id)
        child_workflow = Workflow(
            **{col.key: getattr(source, col.key) for col in inspect(Workflow).column_attrs if col.key != "id"}
        )
        child_workflow.id, child_workflow.app_id = str(uuid4()), child_app.id
        child_app.workflow_id = child_workflow.id
        session.add_all((child_app, child_workflow))
        app_id, workflow_id = child_app.id, child_workflow.id
    _, child = _child_case(c, app_id=app_id, workflow_id=workflow_id)
    effect = c.ledger.intent.model_copy(
        update={"key": c.ledger.intent.key.model_copy(update={"invocation_id": child.invocation_id})}
    )
    effect, item = _prepare_approval(c, child, effect)
    _install_approval_api(c, monkeypatch, effect, item)
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    revoked = False
    checks = []

    def check(_tenant, _actor, *, scene, resource_type, resource_id):
        assert resource_type is not None
        checks.append((revoked, resource_id, scene))
        return not (revoked and resource_id == app_id and scene == getattr(RBACPermission, revoked_permission))

    monkeypatch.setattr(RBACService.CheckAccess, "check", check)
    # The actual child effect is publicly readable before the final boundary.
    assert c.client.get(c.url + f"/{c.ref.request_id}").status_code == 200
    original_decide = c.api.authorization.decide

    def revoke_at_final_boundary(**kwargs):
        nonlocal revoked
        assert kwargs["ref"] == child
        assert kwargs["pending_guard"].invocation_app_id == app_id
        revoked = True
        monkeypatch.setattr(c.api.store, "_read_object", lambda *_: pytest.fail("decrypt after authority revocation"))
        return original_decide(**kwargs)

    monkeypatch.setattr(c.api.authorization, "decide", revoke_at_final_boundary)
    response = c.client.post(c.url + f"/{c.ref.request_id}/decisions", json=c.body)
    assert response.status_code == 403, response.get_json()
    assert (True, app_id, getattr(RBACPermission, revoked_permission)) in checks
    with c.factory() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(NativeEffectGrant)
                .where(NativeEffectGrant.request_id == c.ref.request_id)
            )
            == 0
        )
        assert session.get(DifyBuilderExecutionRequest, c.ref.request_id).observations == []
    assert c.ledger.dispatched_attempt_count() == 0


def _decision_process(url, actor, ref, sibling, session_id, effect, item, body, index, first_snapshot, barrier, pipe):
    """Independent owners and real SQL races; this is not an HTTP transport test."""
    try:
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import NullPool

        from app_factory import create_flask_app_with_configs
        from core.db.session_factory import session_factory
        from extensions import ext_database, ext_key_provider, ext_redis, ext_storage
        from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
        from services.dify_builder.native_testing.api_service import NativeTestApiService
        from services.dify_builder.native_testing.pending_actions import NativePendingActionService
        from services.dify_builder.native_testing.runtime_contracts import NativeCheckpointPayload
        from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
            MetadataOwner,
        )

        app = create_flask_app_with_configs()
        app.config["SQLALCHEMY_DATABASE_URI"] = url
        app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"poolclass": NullPool}
        ext_database.init_app(app)
        ext_redis.init_app(app)
        ext_storage.init_app(app)
        ext_key_provider.init_app(app)
        with app.app_context(), pytest.MonkeyPatch.context() as patch:
            no_outbound = no_live.__wrapped__(patch)
            next(no_outbound)
            session_factory.configure(ext_database.db.engine)
            factory = sessionmaker(bind=ext_database.db.engine, expire_on_commit=False)
            service = NativeTestApiService(
                session_factory=factory,
                actor=actor,
                resolver=MetadataOwner(),
                admission=None,
                resolution=None,
                runtime=None,
                disclosure=ConsoleDisclosure(effect, item),
            )
            if index == 1:
                assert first_snapshot.wait(timeout=60)
                wait = NativePendingActionService(service.loader).configuration(
                    ref=sibling,
                    requirements_ref="configuration-1",
                    expected_generation=0,
                )
                context = service.store.load_context(ref=sibling)
                checkpoint = service.store.commit_checkpoint(
                    ref=sibling,
                    generation=0,
                    payload=NativeCheckpointPayload(
                        schema_version="1",
                        native_run_id=context.native_run_id,
                        generation=0,
                        generate_entity_json="{}",
                        graph_runtime_state_json="{}",
                        response_stream_filter_json="{}",
                        node_journals=(),
                        child_refs=(),
                        input_result_refs=(),
                    ),
                )
                service.lifecycle.pause(
                    ref=sibling,
                    checkpoint=checkpoint,
                    pending_operation_ids=(wait.pending_operation_id,),
                    expected_generation=0,
                )
            original = service.authorization.decide
            snapshot = None

            def serialize_after_both_snapshots(**kwargs):
                nonlocal snapshot
                snapshot = kwargs["pending_guard"].receipt.model_dump(mode="json")
                # Both requests reached the command boundary with no observation
                # yet saved; the second has a real new sibling configuration wait.
                first_snapshot.set()
                barrier.wait(timeout=60)
                return original(**kwargs)

            patch.setattr(service.authorization, "decide", serialize_after_both_snapshots)
            try:
                receipt = service.decide(actor=actor, session_id=session_id, request_id=ref.request_id, **body)
                result = ("ok", receipt.model_dump(mode="json"), snapshot)
            except BuilderExecutionPolicyError as error:
                result = ("conflict", error.reason_code, snapshot)
            with pytest.raises(StopIteration):
                next(no_outbound)
            pipe.send(result)
    except BaseException as error:
        pipe.send(("error", type(error).__name__, str(error)))
    finally:
        pipe.close()


@pytest.mark.parametrize("second_decision", ["confirm", "deny"])
def test_concurrent_decisions_return_canonical_saved_receipt(console_case, second_decision):
    import multiprocessing

    from sqlalchemy import func

    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import NativeEffectGrant
    from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import _child_case

    c = console_case
    _, approval_child = _child_case(c)
    _, sibling = _child_case(c)
    # A waiting root fences every descendant. Independent children preserve the
    # running controlling root while the second snapshot gains a sibling wait.
    effect = c.ledger.intent.model_copy(
        update={"key": c.ledger.intent.key.model_copy(update={"invocation_id": approval_child.invocation_id})}
    )
    effect, item = _prepare_approval(c, approval_child, effect)
    with c.factory() as session:
        session_id = session.get(DifyBuilderExecutionRequest, c.ref.request_id).session_id
    ctx = multiprocessing.get_context("spawn")
    first_snapshot, barrier = ctx.Event(), ctx.Barrier(2)
    pairs = [ctx.Pipe(duplex=False) for _ in range(2)]
    url = c.factory.kw["bind"].url.render_as_string(hide_password=False)
    body = {
        "pending_operation_id": item.pending_operation_id,
        "scope_digest": item.scope_digest,
        "expected_version": 1,
        "idempotency_key": "concurrent-decision",
    }
    processes = [
        ctx.Process(
            target=_decision_process,
            args=(
                url,
                c.ledger.actor,
                c.ref,
                sibling,
                session_id,
                effect,
                item,
                {**body, "decision": "confirm" if i == 0 else second_decision},
                i,
                first_snapshot,
                barrier,
                pairs[i][1],
            ),
        )
        for i in range(2)
    ]
    try:
        for process in processes:
            process.start()
        for process in processes:
            process.join(timeout=90)
        assert all(not p.is_alive() and p.exitcode == 0 for p in processes)
        assert all(pair[0].poll(5) for pair in pairs)
        results = [pair[0].recv() for pair in pairs]
        assert all(row[0] != "error" for row in results), results
        assert [len(row[2]["pending"]) for row in results] == [1, 2], results
        with c.factory() as session:
            observations = session.get(DifyBuilderExecutionRequest, c.ref.request_id).observations
            assert len(observations) == 1
            assert (
                session.scalar(
                    select(func.count())
                    .select_from(NativeEffectGrant)
                    .where(NativeEffectGrant.request_id == c.ref.request_id)
                )
                == 1
            )
        if second_decision == "confirm":
            assert [row[0] for row in results] == ["ok", "ok"], results
            assert results[0][1] == results[1][1] == observations[0]["receipt"]
        else:
            assert sorted(row[0] for row in results) == ["conflict", "ok"], results
            assert next(row[1] for row in results if row[0] == "ok") == observations[0]["receipt"]
            assert next(row[1] for row in results if row[0] == "conflict") == "native_idempotency_conflict"
        assert c.ledger.dispatched_attempt_count() == 0
    finally:
        for process in processes:
            if process.is_alive():
                process.kill()
                process.join()
        for pair in pairs:
            for pipe in pair:
                pipe.close()
