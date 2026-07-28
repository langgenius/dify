from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

from sqlalchemy.orm import Session

from services.workflow_run_timing_service import get_workflow_run_public_timing


def test_get_workflow_run_public_timing_returns_wall_clock_and_accumulated_wait() -> None:
    session = MagicMock(spec=Session)
    started_at = datetime(2026, 7, 28, 12, 0, 0)
    session.scalar.return_value = SimpleNamespace(
        created_at=started_at,
        handoff_duration=42.25,
    )

    timing = get_workflow_run_public_timing(
        session=session,
        workflow_run_id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
    )

    assert timing is not None
    assert timing.started_at == started_at
    assert timing.handoff_duration == 42.25
    statement = str(session.scalar.call_args.args[0])
    assert "workflow_runs.id" in statement
    assert "workflow_runs.tenant_id" in statement
    assert "workflow_runs.app_id" in statement
    assert "workflow_runs.workflow_id" in statement


def test_get_workflow_run_public_timing_handles_missing_run_and_negative_legacy_value() -> None:
    session = MagicMock(spec=Session)
    session.scalar.return_value = None
    assert (
        get_workflow_run_public_timing(
            session=session,
            workflow_run_id="missing",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
        )
        is None
    )

    session.scalar.return_value = SimpleNamespace(
        created_at=datetime(2026, 7, 28, 12, 0, 0),
        handoff_duration=-1.0,
    )
    timing = get_workflow_run_public_timing(
        session=session,
        workflow_run_id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
    )
    assert timing is not None
    assert timing.handoff_duration == 0.0
