import datetime
from typing import Any

import pytest

from services import clear_free_plan_expired_workflow_run_logs as cleanup_module
from services.clear_free_plan_expired_workflow_run_logs import WorkflowRunCleanup, WorkflowRunRow


class DummySession:
    def __init__(self) -> None:
        self.committed = False

    def __enter__(self) -> "DummySession":
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None

    def commit(self) -> None:
        self.committed = True


def test_filter_free_tenants_billing_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = WorkflowRunCleanup(days=30, batch_size=10)

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", False)

    def fail_bulk(_: list[str]) -> dict[str, dict[str, Any]]:
        raise RuntimeError("should not call")

    monkeypatch.setattr(cleanup_module.BillingService, "get_info_bulk", staticmethod(fail_bulk))

    tenants = {"t1", "t2"}
    free = cleanup._filter_free_tenants(tenants)

    assert free == tenants


def test_filter_free_tenants_bulk_mixed(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = WorkflowRunCleanup(days=30, batch_size=10)

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", True)
    # seed cache to avoid relying on billing service implementation
    cleanup.billing_cache["t_free"] = cleanup_module.CloudPlan.SANDBOX
    cleanup.billing_cache["t_paid"] = cleanup_module.CloudPlan.TEAM
    monkeypatch.setattr(
        cleanup_module.BillingService,
        "get_info_bulk",
        staticmethod(lambda tenant_ids: {tenant_id: {} for tenant_id in tenant_ids}),
    )

    free = cleanup._filter_free_tenants({"t_free", "t_paid", "t_missing"})

    assert free == {"t_free"}


def test_filter_free_tenants_bulk_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = WorkflowRunCleanup(days=30, batch_size=10)

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", True)
    monkeypatch.setattr(
        cleanup_module.BillingService,
        "get_info_bulk",
        staticmethod(lambda tenant_ids: (_ for _ in ()).throw(RuntimeError("boom"))),
    )

    free = cleanup._filter_free_tenants({"t1", "t2"})

    assert free == set()


def test_run_deletes_only_free_tenants(monkeypatch: pytest.MonkeyPatch) -> None:
    cutoff = datetime.datetime.now()
    cleanup = WorkflowRunCleanup(days=30, batch_size=10)

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", True)
    cleanup.billing_cache["t_free"] = cleanup_module.CloudPlan.SANDBOX
    cleanup.billing_cache["t_paid"] = cleanup_module.CloudPlan.TEAM
    monkeypatch.setattr(
        cleanup_module.BillingService,
        "get_info_bulk",
        staticmethod(lambda tenant_ids: {tenant_id: {} for tenant_id in tenant_ids}),
    )

    batches_returned = 0

    def fake_load_batch(session: DummySession, last_seen: tuple[datetime.datetime, str] | None) -> list[WorkflowRunRow]:
        nonlocal batches_returned
        if batches_returned > 0:
            return []
        batches_returned += 1
        return [
            WorkflowRunRow(id="run-free", tenant_id="t_free", created_at=cutoff),
            WorkflowRunRow(id="run-paid", tenant_id="t_paid", created_at=cutoff),
        ]

    deleted_ids: list[list[str]] = []

    def fake_delete_runs(session: DummySession, workflow_run_ids: list[str]) -> dict[str, int]:
        deleted_ids.append(list(workflow_run_ids))
        return {
            "runs": len(workflow_run_ids),
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }

    created_sessions: list[DummySession] = []

    def fake_session_factory(engine: object | None = None) -> DummySession:
        session = DummySession()
        created_sessions.append(session)
        return session

    monkeypatch.setattr(cleanup, "_load_batch", fake_load_batch)
    monkeypatch.setattr(cleanup, "_delete_runs", fake_delete_runs)
    monkeypatch.setattr(cleanup_module, "Session", fake_session_factory)

    class DummyDB:
        engine: object | None = None

    monkeypatch.setattr(cleanup_module, "db", DummyDB())

    cleanup.run()

    assert deleted_ids == [["run-free"]]
    assert created_sessions
    assert created_sessions[0].committed is True


def test_run_skips_when_no_free_tenants(monkeypatch: pytest.MonkeyPatch) -> None:
    cutoff = datetime.datetime.now()
    cleanup = WorkflowRunCleanup(days=30, batch_size=10)

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", True)
    monkeypatch.setattr(
        cleanup_module.BillingService,
        "get_info_bulk",
        staticmethod(lambda tenant_ids: {tenant_id: {"subscription": {"plan": "TEAM"}} for tenant_id in tenant_ids}),
    )

    batches_returned = 0

    def fake_load_batch(session: DummySession, last_seen: tuple[datetime.datetime, str] | None) -> list[WorkflowRunRow]:
        nonlocal batches_returned
        if batches_returned > 0:
            return []
        batches_returned += 1
        return [WorkflowRunRow(id="run-paid", tenant_id="t_paid", created_at=cutoff)]

    delete_called = False

    def fake_delete_runs(session: DummySession, workflow_run_ids: list[str]) -> dict[str, int]:
        nonlocal delete_called
        delete_called = True
        return {
            "runs": 0,
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }

    def fake_session_factory(engine: object | None = None) -> DummySession:  # pragma: no cover - simple factory
        return DummySession()

    monkeypatch.setattr(cleanup, "_load_batch", fake_load_batch)
    monkeypatch.setattr(cleanup, "_delete_runs", fake_delete_runs)
    monkeypatch.setattr(cleanup_module, "Session", fake_session_factory)
    monkeypatch.setattr(cleanup_module, "db", type("DummyDB", (), {"engine": None}))

    cleanup.run()

    assert delete_called is False


def test_run_exits_on_empty_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = WorkflowRunCleanup(days=30, batch_size=10)

    def fake_load_batch(session: DummySession, last_seen: tuple[datetime.datetime, str] | None) -> list[WorkflowRunRow]:
        return []

    def fake_delete_runs(session: DummySession, workflow_run_ids: list[str]) -> dict[str, int]:
        raise AssertionError("should not delete")

    def fake_session_factory(engine: object | None = None) -> DummySession:  # pragma: no cover - simple factory
        return DummySession()

    monkeypatch.setattr(cleanup, "_load_batch", fake_load_batch)
    monkeypatch.setattr(cleanup, "_delete_runs", fake_delete_runs)
    monkeypatch.setattr(cleanup_module, "Session", fake_session_factory)
    monkeypatch.setattr(cleanup_module, "db", type("DummyDB", (), {"engine": None}))

    cleanup.run()


def test_between_sets_window_bounds() -> None:
    start_after = datetime.datetime(2024, 5, 1, 0, 0, 0)
    end_before = datetime.datetime(2024, 6, 1, 0, 0, 0)
    cleanup = WorkflowRunCleanup(days=30, batch_size=10, start_after=start_after, end_before=end_before)

    assert cleanup.window_start == start_after
    assert cleanup.window_end == end_before


def test_between_requires_both_boundaries() -> None:
    with pytest.raises(ValueError):
        WorkflowRunCleanup(days=30, batch_size=10, start_after=datetime.datetime.now(), end_before=None)
    with pytest.raises(ValueError):
        WorkflowRunCleanup(days=30, batch_size=10, start_after=None, end_before=datetime.datetime.now())


def test_between_requires_end_after_start() -> None:
    start_after = datetime.datetime(2024, 6, 1, 0, 0, 0)
    end_before = datetime.datetime(2024, 5, 1, 0, 0, 0)
    with pytest.raises(ValueError):
        WorkflowRunCleanup(days=30, batch_size=10, start_after=start_after, end_before=end_before)
