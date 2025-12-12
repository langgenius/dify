import datetime
from typing import Any

import pytest

import repositories.factory as repo_factory_module
from services import clear_free_plan_expired_workflow_run_logs as cleanup_module
from services.clear_free_plan_expired_workflow_run_logs import WorkflowRunCleanup


class FakeRun:
    def __init__(self, run_id: str, tenant_id: str, created_at: datetime.datetime) -> None:
        self.id = run_id
        self.tenant_id = tenant_id
        self.created_at = created_at


class FakeRepo:
    def __init__(self, batches: list[list[FakeRun]], delete_result: dict[str, int] | None = None) -> None:
        self.batches = batches
        self.call_idx = 0
        self.deleted: list[list[str]] = []
        self.delete_result = delete_result or {
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
        start_after: datetime.datetime | None,
        end_before: datetime.datetime,
        last_seen: tuple[datetime.datetime, str] | None,
        batch_size: int,
    ) -> list[FakeRun]:
        if self.call_idx >= len(self.batches):
            return []
        batch = self.batches[self.call_idx]
        self.call_idx += 1
        return batch

    def delete_runs_with_related(self, run_ids: list[str], delete_trigger_logs=None) -> dict[str, int]:
        self.deleted.append(list(run_ids))
        result = self.delete_result.copy()
        result["runs"] = len(run_ids)
        return result


def create_cleanup(monkeypatch: pytest.MonkeyPatch, repo: FakeRepo, **kwargs: Any) -> WorkflowRunCleanup:
    monkeypatch.setattr(
        repo_factory_module.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        classmethod(lambda _cls, session_maker: repo),
    )
    return WorkflowRunCleanup(**kwargs)


def test_filter_free_tenants_billing_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = create_cleanup(monkeypatch, repo=FakeRepo([]), days=30, batch_size=10)

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", False)

    def fail_bulk(_: list[str]) -> dict[str, dict[str, Any]]:
        raise RuntimeError("should not call")

    monkeypatch.setattr(cleanup_module.BillingService, "get_info_bulk", staticmethod(fail_bulk))

    tenants = {"t1", "t2"}
    free = cleanup._filter_free_tenants(tenants)

    assert free == tenants


def test_filter_free_tenants_bulk_mixed(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = create_cleanup(monkeypatch, repo=FakeRepo([]), days=30, batch_size=10)

    monkeypatch.setattr(cleanup_module.dify_config, "BILLING_ENABLED", True)
    cleanup.billing_cache["t_free"] = cleanup_module.CloudPlan.SANDBOX
    cleanup.billing_cache["t_paid"] = cleanup_module.CloudPlan.TEAM
    monkeypatch.setattr(
        cleanup_module.BillingService,
        "get_info_bulk",
        staticmethod(lambda tenant_ids: dict.fromkeys(tenant_ids, "sandbox")),
    )

    free = cleanup._filter_free_tenants({"t_free", "t_paid", "t_missing"})

    assert free == {"t_free", "t_missing"}


def test_filter_free_tenants_bulk_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = create_cleanup(monkeypatch, repo=FakeRepo([]), days=30, batch_size=10)

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
    cleanup.billing_cache["t_free"] = cleanup_module.CloudPlan.SANDBOX
    cleanup.billing_cache["t_paid"] = cleanup_module.CloudPlan.TEAM
    monkeypatch.setattr(
        cleanup_module.BillingService,
        "get_info_bulk",
        staticmethod(lambda tenant_ids: dict.fromkeys(tenant_ids, "sandbox")),
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
        "get_info_bulk",
        staticmethod(lambda tenant_ids: dict.fromkeys(tenant_ids, "team")),
    )

    cleanup.run()

    assert repo.deleted == []


def test_run_exits_on_empty_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = create_cleanup(monkeypatch, repo=FakeRepo([]), days=30, batch_size=10)

    cleanup.run()


def test_between_sets_window_bounds(monkeypatch: pytest.MonkeyPatch) -> None:
    start_after = datetime.datetime(2024, 5, 1, 0, 0, 0)
    end_before = datetime.datetime(2024, 6, 1, 0, 0, 0)
    cleanup = create_cleanup(
        monkeypatch, repo=FakeRepo([]), days=30, batch_size=10, start_after=start_after, end_before=end_before
    )

    assert cleanup.window_start == start_after
    assert cleanup.window_end == end_before


def test_between_requires_both_boundaries(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError):
        create_cleanup(
            monkeypatch, repo=FakeRepo([]), days=30, batch_size=10, start_after=datetime.datetime.now(), end_before=None
        )
    with pytest.raises(ValueError):
        create_cleanup(
            monkeypatch, repo=FakeRepo([]), days=30, batch_size=10, start_after=None, end_before=datetime.datetime.now()
        )


def test_between_requires_end_after_start(monkeypatch: pytest.MonkeyPatch) -> None:
    start_after = datetime.datetime(2024, 6, 1, 0, 0, 0)
    end_before = datetime.datetime(2024, 5, 1, 0, 0, 0)
    with pytest.raises(ValueError):
        create_cleanup(
            monkeypatch, repo=FakeRepo([]), days=30, batch_size=10, start_after=start_after, end_before=end_before
        )
