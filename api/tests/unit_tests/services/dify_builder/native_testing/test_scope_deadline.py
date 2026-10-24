"""New admissions use the deployment cap once; reconnect never renews authority."""

from collections.abc import Callable
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from models.dify_builder_native_tests import NativeTestScope
from services.dify_builder.native_testing import agent_operations, api_service
from services.dify_builder.native_testing.context_binding import NativeAdmissionCompiler, NativeRuntimeProfile
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from tests.unit_tests.services.dify_builder import test_execution_policy_service as policy_fixtures
from tests.unit_tests.services.dify_builder.test_execution_policy_service import Owned

owned = policy_fixtures.owned


@pytest.mark.parametrize("constructor", ["ordinary", "native"])
@pytest.mark.parametrize(
    ("app_seconds", "workflow_seconds", "deadline"), [(420, 600, 7), (600, 420, 7), (3600, 3600, 60)]
)
def test_admission_deadline_uses_stricter_existing_cap_without_renewal(
    owned: Owned,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    constructor: str,
    app_seconds: int,
    workflow_seconds: int,
    deadline: int,
) -> None:
    factory, actor, app, _workflow, session_id, input_id = owned
    now = datetime(2030, 1, 1, tzinfo=UTC)
    config_overrides(APP_MAX_EXECUTION_TIME=app_seconds, WORKFLOW_MAX_EXECUTION_TIME=workflow_seconds)
    monkeypatch.setattr(api_service, "utc_now", lambda: now)
    monkeypatch.setattr("services.dify_builder.native_testing.repository.utc_now", lambda: now)
    monkeypatch.setattr(NativeExecutionStateStore, "initialize_context", lambda *_args, **_kwargs: None)
    if constructor == "ordinary":
        from dataclasses import dataclass

        from sqlalchemy import Engine

        @dataclass
        class Database:
            engine: Engine

        monkeypatch.setattr(agent_operations, "db", Database(factory.kw["bind"]))

        def admit() -> str:
            return agent_operations.admit_confirmed_agent_execution(
                actor=actor,
                session_id=session_id,
                test_input_id=input_id,
                expected_version=1,
                native_run_id=app.id,
                idempotency_key="fixed",
                limits={"calls": 4, "dispatches": 4, "cost_units": 4},
            ).ref.request_id
    else:
        from runtime_contracts.builder.native.contracts import NativeTestContextRef

        class Launch:
            def launch(self, *, ref: NativeTestContextRef) -> None:
                assert ref.request_id

        service = api_service.NativeTestApiService(
            session_factory=factory,
            actor=actor,
            resolver=None,
            runtime=None,
            resolution=None,
            disclosure=None,
            admission=api_service.NativeAdmissionDependencies(
                compiler=NativeAdmissionCompiler(session_factory=factory, resources=lambda **_: ()),
                profile=NativeRuntimeProfile(
                    profile_id="test",
                    implementation_revision="test",
                    limits={"calls": 4, "dispatches": 4, "cost_units": 4},
                ),
                launch=Launch(),
            ),
        )
        monkeypatch.setattr(service, "_launch", lambda **_: None)
        monkeypatch.setattr(service, "get", lambda **_: None)

        def admit() -> str:
            return service.start(
                actor=actor,
                session_id=session_id,
                test_input_id=input_id,
                expected_version=1,
                mode="native",
                idempotency_key="fixed",
            ).request_id

    if constructor == "native":
        from core.dify_builder.input_schema import schema_hash, start_schema
        from models.dify_builder import DifyBuilderSessionCommit, DifyBuilderTestInput

        with factory.begin() as sql:
            commit = sql.scalar(
                select(DifyBuilderSessionCommit).where(DifyBuilderSessionCommit.session_id == session_id)
            )
            assert commit is not None
            commit.context = {**commit.context, "test_input_ref": input_id}
            saved = sql.get(DifyBuilderTestInput, input_id)
            assert saved is not None
            saved.start_schema_hash = schema_hash(start_schema(dict(_workflow.graph_dict), app.mode))
    request_id = admit()
    with factory() as sql:
        scope = sql.scalar(select(NativeTestScope).where(NativeTestScope.request_id == request_id))
        assert scope is not None
        assert scope.expires_at == (datetime(2030, 1, 1, minute=deadline) if deadline < 60 else datetime(2030, 1, 1, 1))
        original = scope.expires_at
    now = datetime(2030, 1, 2, tzinfo=UTC)
    config_overrides(APP_MAX_EXECUTION_TIME=7200, WORKFLOW_MAX_EXECUTION_TIME=7200)
    assert admit() == request_id
    with factory() as sql:
        scope = sql.get(NativeTestScope, request_id)
        assert scope is not None
        assert scope.expires_at == original
