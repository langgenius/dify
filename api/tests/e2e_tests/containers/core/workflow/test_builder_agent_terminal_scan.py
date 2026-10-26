"""The terminal recovery query must accept PostgreSQL's native UUID input IDs."""

from uuid import uuid4

from flask import Flask
from sqlalchemy.orm import sessionmaker

from extensions.ext_database import db
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderRun
from services.dify_builder.native_testing.confirmed_agent_completion import reconcile_completed_builder_runs


def test_terminal_scan_accepts_native_uuid_test_input_ids(flask_app_with_containers: Flask) -> None:
    # Empty tables still force PostgreSQL to type-check the actual recovery join:
    # BuilderRun.inputs_ref is varchar, while ExecutionRequest.test_input_id is uuid.
    with flask_app_with_containers.app_context():
        sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
        assert reconcile_completed_builder_runs(sessions=sessions) == 0


def test_terminal_scan_ignores_non_uuid_builder_input_references(flask_app_with_containers: Flask) -> None:
    # Historical Builder input references are general strings: cast the typed
    # execution ID to text instead of attempting to reinterpret every reference.
    with flask_app_with_containers.app_context():
        sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
        session_id = str(uuid4())
        with sessions.begin() as sql:
            sql.add(
                DifyBuilderExecutionRequest(
                    id=str(uuid4()),
                    tenant_id=str(uuid4()),
                    app_id=str(uuid4()),
                    workflow_id=str(uuid4()),
                    actor_id=str(uuid4()),
                    session_id=session_id,
                    test_input_id=str(uuid4()),
                    context={"profile": {"profile_id": "builder-agent-confirmed-v1"}},
                    context_digest="a" * 64,
                    state="sealed",
                )
            )
            sql.add(DifyBuilderRun(session_id=session_id, kind="verify", status="running", inputs_ref="legacy-input"))
        assert reconcile_completed_builder_runs(sessions=sessions) == 0
