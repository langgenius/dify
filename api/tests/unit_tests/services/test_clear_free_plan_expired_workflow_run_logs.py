import datetime
from typing import Any

import pytest

from services.billing_service import SubscriptionPlan
from services.retention.workflow_run import clear_free_plan_expired_workflow_run_logs as cleanup_module
from services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs import WorkflowRunCleanup


class FakeRun:
    def __init__(
        self,
        run_id: str,
        tenant_id: str,
        created_at: datetime.datetime,
        app_id: str = "app-1",
        workflow_id: str = "wf-1",
        triggered_from: str = "workflow-run",
    ) -> None:
        self.id = run_id
        self.tenant_id = tenant_id
        self.app_id = app_id
        self.workflow_id = workflow_id
        self.triggered_from = triggered_from
        self.created_at = created_at


class FakeRepo:
    def __init__(
        self,
        batches: list[list[FakeRun]],
        delete_result: dict[str, int] | None = None,
        count_result: dict[str, int] | None = None,
    ) -> None:
        self.batches = batches
        self.call_idx = 0
        self.deleted: list[list[str]] = []
        self.counted: list[list[str]] = []
        self.delete_result = delete_result or {
            "runs": 0,
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }
        self.count_result = count_result or {
            "runs": 0,
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }

    def get_runs_batch_by_time_range(
        self,
        start_from: datetime.datetime | None,
        end_before: datetime.datetime,
        last_seen: tuple[datetime.datetime, str] | None,
        batch_size: int,
    ) -> list[FakeRun]:
        if self.call_idx >= len(self.batches):
            return []
        batch = self.batches[self.call_idx]
        self.call_idx += 1
        return batch

    def delete_runs_with_related(
        self, runs: list[FakeRun], delete_node_executions=None, delete_trigger_logs=None
    ) -> dict[str, int]:
        self.deleted.append([run.id for run in runs])
        result = self.delete_result.copy()
        result["runs"] = len(runs)
        return result

    def count_runs_with_related(
        self, runs: list[FakeRun], count_node_executions=None, count_trigger_logs=None
    ) -> dict[str, int]:
        self.counted.append([run.id for run in runs])
        result = self.count_result.copy()
        result["runs"] = len(runs)
        return result


def plan_info(plan: str, expiration: int) -> SubscriptionPlan:
    return SubscriptionPlan(plan=plan, expiration_date=expiration)


def create_cleanup(
    monkeypatch: pytest.MonkeyPatch,
    repo: FakeRepo,
    *,
    grace_period_days: int = 0,
    whitelist: set[str] | None = None,
    **kwargs: Any,
) -> WorkflowRunCleanup:
    monkeypatch.setattr(
        cleanup_module.dify_config,
        "SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD",
        grace_period_days,
    )
    monkeypatch.setattr(
        cleanup_module.WorkflowRunCleanup,
        "_get_cleanup_whitelist",
        lambda self: whitelist or set(),
    )
    return WorkflowRunCleanup(workflow_run_repo=repo, **kwargs)


def test_filter_free_tenants_billing_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = create_cleanup(monkeypatch, repo=FakeRepo([]), days=30, batch_size=10)

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", False)

    def fail_bulk(_: list[str]) -> dict[str, SubscriptionPlan]:
        raise RuntimeError("should not call")

    monkeypatch.setattr(cleanup_module.BillingService, "get_plan_bulk_with_cache", staticmethod(fail_bulk))

    tenants = {"t1", "t2"}
    free = cleanup._filter_free_tenants(tenants)

    assert free == tenants


def test_filter_free_tenants_bulk_mixed(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = create_cleanup(monkeypatch, repo=FakeRepo([]), days=30, batch_size=10)

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", True)
    monkeypatch.setattr(
        cleanup_module.BillingService,
        "get_plan_bulk_with_cache",
        staticmethod(
            lambda tenant_ids: {
                tenant_id: (plan_info("team", -1) if tenant_id == "t_paid" else plan_info("sandbox", -1))
                for tenant_id in tenant_ids
            }
        ),
    )

    free = cleanup._filter_free_tenants({"t_free", "t_paid", "t_missing"})

    assert free == {"t_free", "t_missing"}


def test_filter_free_tenants_respects_grace_period(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = create_cleanup(monkeypatch, repo=FakeRepo([]), days=30, batch_size=10, grace_period_days=45)

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", True)
    now = datetime.datetime.now(datetime.UTC)
    within_grace_ts = int((now - datetime.timedelta(days=10)).timestamp())
    outside_grace_ts = int((now - datetime.timedelta(days=90)).timestamp())

    def fake_bulk(_: list[str]) -> dict[str, SubscriptionPlan]:
        return {
            "recently_downgraded": plan_info("sandbox", within_grace_ts),
            "long_sandbox": plan_info("sandbox", outside_grace_ts),
        }

    monkeypatch.setattr(cleanup_module.BillingService, "get_plan_bulk_with_cache", staticmethod(fake_bulk))

    free = cleanup._filter_free_tenants({"recently_downgraded", "long_sandbox"})

    assert free == {"long_sandbox"}


def test_filter_free_tenants_skips_cleanup_whitelist(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = create_cleanup(
        monkeypatch,
        repo=FakeRepo([]),
        days=30,
        batch_size=10,
        whitelist={"tenant_whitelist"},
    )

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", True)
    monkeypatch.setattr(
        cleanup_module.BillingService,
        "get_plan_bulk_with_cache",
        staticmethod(
            lambda tenant_ids: {
                tenant_id: (plan_info("team", -1) if tenant_id == "t_paid" else plan_info("sandbox", -1))
                for tenant_id in tenant_ids
            }
        ),
    )

    tenants = {"tenant_whitelist", "tenant_regular"}
    free = cleanup._filter_free_tenants(tenants)

    assert free == {"tenant_regular"}


def test_filter_free_tenants_bulk_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = create_cleanup(monkeypatch, repo=FakeRepo([]), days=30, batch_size=10)

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", True)
    monkeypatch.setattr(
        cleanup_module.BillingService,
        "get_plan_bulk_with_cache",
        staticmethod(lambda tenant_ids: (_ for _ in ()).throw(RuntimeError("boom"))),
    )

    free = cleanup._filter_free_tenants({"t1", "t2"})

    assert free == set()


def test_run_deletes_only_free_tenants(monkeypatch: pytest.MonkeyPatch) -> None:
    cutoff = datetime.datetime.now()
    repo = FakeRepo(
        batches=[
            [
                FakeRun("run-free", "t_free", cutoff),
                FakeRun("run-paid", "t_paid", cutoff),
            ]
        ]
    )
    cleanup = create_cleanup(monkeypatch, repo=repo, days=30, batch_size=10)

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", True)
    monkeypatch.setattr(
        cleanup_module.BillingService,
        "get_plan_bulk_with_cache",
        staticmethod(
            lambda tenant_ids: {
                tenant_id: (plan_info("team", -1) if tenant_id == "t_paid" else plan_info("sandbox", -1))
                for tenant_id in tenant_ids
            }
        ),
    )

    cleanup.run()

    assert repo.deleted == [["run-free"]]


def test_run_skips_when_no_free_tenants(monkeypatch: pytest.MonkeyPatch) -> None:
    cutoff = datetime.datetime.now()
    repo = FakeRepo(batches=[[FakeRun("run-paid", "t_paid", cutoff)]])
    cleanup = create_cleanup(monkeypatch, repo=repo, days=30, batch_size=10)

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", True)
    monkeypatch.setattr(
        cleanup_module.BillingService,
        "get_plan_bulk_with_cache",
        staticmethod(lambda tenant_ids: {tenant_id: plan_info("team", 1893456000) for tenant_id in tenant_ids}),
    )

    cleanup.run()

    assert repo.deleted == []


def test_run_exits_on_empty_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = create_cleanup(monkeypatch, repo=FakeRepo([]), days=30, batch_size=10)

    cleanup.run()


def test_run_dry_run_skips_deletions(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    cutoff = datetime.datetime.now()
    repo = FakeRepo(
        batches=[[FakeRun("run-free", "t_free", cutoff)]],
        count_result={
            "runs": 0,
            "node_executions": 2,
            "offloads": 1,
            "app_logs": 3,
            "trigger_logs": 4,
            "pauses": 5,
            "pause_reasons": 6,
        },
    )
    cleanup = create_cleanup(monkeypatch, repo=repo, days=30, batch_size=10, dry_run=True)

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", False)

    cleanup.run()

    assert repo.deleted == []
    assert repo.counted == [["run-free"]]
    captured = capsys.readouterr().out
    assert "Dry run mode enabled" in captured
    assert "would delete 1 runs" in captured
    assert "related records" in captured
    assert "node_executions 2" in captured
    assert "offloads 1" in captured
    assert "app_logs 3" in captured
    assert "trigger_logs 4" in captured
    assert "pauses 5" in captured
    assert "pause_reasons 6" in captured


def test_between_sets_window_bounds(monkeypatch: pytest.MonkeyPatch) -> None:
    start_from = datetime.datetime(2024, 5, 1, 0, 0, 0)
    end_before = datetime.datetime(2024, 6, 1, 0, 0, 0)
    cleanup = create_cleanup(
        monkeypatch, repo=FakeRepo([]), days=30, batch_size=10, start_from=start_from, end_before=end_before
    )

    assert cleanup.window_start == start_from
    assert cleanup.window_end == end_before


def test_between_requires_both_boundaries(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError):
        create_cleanup(
            monkeypatch, repo=FakeRepo([]), days=30, batch_size=10, start_from=datetime.datetime.now(), end_before=None
        )
    with pytest.raises(ValueError):
        create_cleanup(
            monkeypatch, repo=FakeRepo([]), days=30, batch_size=10, start_from=None, end_before=datetime.datetime.now()
        )


def test_between_requires_end_after_start(monkeypatch: pytest.MonkeyPatch) -> None:
    start_from = datetime.datetime(2024, 6, 1, 0, 0, 0)
    end_before = datetime.datetime(2024, 5, 1, 0, 0, 0)
    with pytest.raises(ValueError):
        create_cleanup(
            monkeypatch, repo=FakeRepo([]), days=30, batch_size=10, start_from=start_from, end_before=end_before
        )
