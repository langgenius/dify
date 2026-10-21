"""Public binding exposes only the current saved input, never retained or raw data."""

import pytest

from core.dify_builder.input_schema import schema_hash, start_schema
from models.dify_builder import DifyBuilderSessionCommit, DifyBuilderTestInput
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414


class RejectUnexpectedNativeLaunch:
    def launch(self, *, ref):
        del ref
        pytest.fail("invalid current input reached native launch")


def prepare(owned):
    factory, _actor, _app, workflow, sid, tid = owned
    with factory.begin() as session:
        session.get(DifyBuilderTestInput, tid).start_schema_hash = schema_hash(start_schema(workflow.graph_dict))
        session.add(
            DifyBuilderSessionCommit(
                session_id=sid,
                version=1,
                state="build.review",
                actor="user",
                context={"test_input_ref": tid, "retained_test_input_ref": "old"},
            )
        )


def test_current_input_public_binding_is_owned_and_has_no_values(owned):
    from services.dify_builder.native_testing.input_binding import current_input_binding

    prepare(owned)
    factory, actor, _app, workflow, sid, tid = owned
    with factory() as session:
        result = current_input_binding(session=session, actor=actor, session_id=sid)
    assert result.test_input_id == tid
    assert result.expected_version == 1
    assert result.workflow_id == workflow.id
    assert len(result.graph_revision) == 64
    assert result.preferred_start == "builder_action"
    assert "inputs" not in result.model_dump()
    assert "retained_test_input_ref" not in result.model_dump()


@pytest.mark.parametrize("change", ["current", "schema", "version", "owner"])
def test_binding_rejects_stale_or_foreign_input(owned, change):
    from dataclasses import replace

    from services.dify_builder.native_testing.input_binding import current_input_binding

    prepare(owned)
    factory, actor, _app, _workflow, sid, tid = owned
    with factory.begin() as session:
        commit = session.query(DifyBuilderSessionCommit).one()
        if change == "current":
            commit.context = {"retained_test_input_ref": tid}
        elif change == "schema":
            session.get(DifyBuilderTestInput, tid).start_schema_hash = "old"
        elif change == "version":
            commit.version = 0
        else:
            actor = replace(actor, account_id="other")
    with factory() as session, pytest.raises(BuilderExecutionPolicyError):
        current_input_binding(session=session, actor=actor, session_id=sid)


def test_standalone_start_refuses_noncurrent_same_session_input_before_compilation(owned, monkeypatch):
    from uuid import uuid4

    from services.dify_builder.native_testing.api_service import NativeAdmissionDependencies, NativeTestApiService

    prepare(owned)
    factory, actor, _app, _workflow, sid, _tid = owned
    other = str(uuid4())
    with factory.begin() as session:
        session.add(DifyBuilderTestInput(id=other, session_id=sid, source="mock", inputs={}, start_schema_hash=""))
    from services.dify_builder.native_testing.context_binding import NativeAdmissionCompiler, NativeRuntimeProfile

    compiler = NativeAdmissionCompiler(session_factory=factory, resources=lambda **_kwargs: ())
    monkeypatch.setattr(compiler, "compile", lambda **_kwargs: pytest.fail("noncurrent input reached compilation"))
    service = NativeTestApiService(
        session_factory=factory,
        actor=actor,
        resolver=None,
        admission=NativeAdmissionDependencies(
            compiler=compiler,
            profile=NativeRuntimeProfile(
                profile_id="unit",
                implementation_revision="unit-v1",
                limits={"calls": 1, "dispatches": 1, "cost_units": 1},
            ),
            launch=RejectUnexpectedNativeLaunch(),
        ),
        resolution=None,
        runtime=None,
        disclosure=None,
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_revision_drift"):
        service.start(
            actor=actor, session_id=sid, test_input_id=other, expected_version=1, mode="native", idempotency_key="start"
        )


def test_start_rechecks_current_input_under_admission_lock_before_insert(owned, monkeypatch):
    from sqlalchemy import func, select

    from models.dify_builder import DifyBuilderExecutionRequest
    from services.dify_builder.native_testing.api_service import NativeAdmissionDependencies, NativeTestApiService
    from services.dify_builder.native_testing.context_binding import NativeAdmissionCompiler, NativeRuntimeProfile

    prepare(owned)
    factory, actor, _app, _workflow, sid, tid = owned
    compiler = NativeAdmissionCompiler(session_factory=factory, resources=lambda **_kwargs: ())
    original = compiler.recheck_local

    def replace_current(**kwargs):
        original(**kwargs)
        commit = kwargs["session"].scalar(select(DifyBuilderSessionCommit))
        commit.context = {"retained_test_input_ref": tid}

    monkeypatch.setattr(compiler, "recheck_local", replace_current)
    launch = RejectUnexpectedNativeLaunch()
    service = NativeTestApiService(
        session_factory=factory,
        actor=actor,
        resolver=None,
        admission=NativeAdmissionDependencies(
            compiler=compiler,
            profile=NativeRuntimeProfile(
                profile_id="unit",
                implementation_revision="unit-v1",
                limits={"calls": 1, "dispatches": 1, "cost_units": 1},
            ),
            launch=launch,
        ),
        resolution=None,
        runtime=None,
        disclosure=None,
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_current_input_unavailable"):
        service.start(
            actor=actor, session_id=sid, test_input_id=tid, expected_version=1, mode="native", idempotency_key="start"
        )
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(DifyBuilderExecutionRequest)) == 0


@pytest.mark.parametrize("busy", ["working", "active_request"])
def test_binding_never_offers_start_while_same_input_is_running(owned, busy):
    from uuid import uuid4

    from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession
    from services.dify_builder.native_testing.input_binding import current_input_binding

    prepare(owned)
    factory, actor, app, workflow, sid, tid = owned
    with factory.begin() as session:
        if busy == "working":
            session.get(DifyBuilderSession, sid).current_state = "build.test_and_repair"
        else:
            session.add(
                DifyBuilderExecutionRequest(
                    id=str(uuid4()),
                    tenant_id=actor.tenant_id,
                    actor_id=actor.account_id,
                    app_id=app.id,
                    workflow_id=workflow.id,
                    session_id=sid,
                    test_input_id=tid,
                    context={},
                    context_digest="a" * 64,
                    state="running",
                    observations=[],
                )
            )
    with factory() as session, pytest.raises(BuilderExecutionPolicyError, match="native_session_busy"):
        current_input_binding(session=session, actor=actor, session_id=sid)
