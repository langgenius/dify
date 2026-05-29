"""
Unit tests for WorkflowRunCleanup service.
"""

import datetime
from unittest.mock import MagicMock, patch

import pytest

from services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs import WorkflowRunCleanup


def make_run(tenant_id: str = "t1", run_id: str = "r1", created_at: datetime.datetime | None = None):
    run = MagicMock()
    run.tenant_id = tenant_id
    run.id = run_id
    run.created_at = created_at or datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC)
    return run


@pytest.fixture
def mock_repo():
    return MagicMock()


@pytest.fixture
def cleanup(mock_repo):
    with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
        cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
        cfg.BILLING_ENABLED = False
        yield WorkflowRunCleanup(days=30, batch_size=10, workflow_run_repo=mock_repo)


# ---------------------------------------------------------------------------
# Constructor validation
# ---------------------------------------------------------------------------


class TestWorkflowRunCleanupInit:
    def test_only_start_from_raises(self, mock_repo):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = False
            with pytest.raises(ValueError, match="both set or both omitted"):
                WorkflowRunCleanup(
                    days=30,
                    batch_size=10,
                    start_from=datetime.datetime(2024, 1, 1),
                    workflow_run_repo=mock_repo,
                )

    def test_only_end_before_raises(self, mock_repo):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = False
            with pytest.raises(ValueError, match="both set or both omitted"):
                WorkflowRunCleanup(
                    days=30,
                    batch_size=10,
                    end_before=datetime.datetime(2024, 1, 1),
                    workflow_run_repo=mock_repo,
                )

    def test_end_before_not_greater_than_start_raises(self, mock_repo):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = False
            with pytest.raises(ValueError, match="end_before must be greater than start_from"):
                WorkflowRunCleanup(
                    days=30,
                    batch_size=10,
                    start_from=datetime.datetime(2024, 6, 1),
                    end_before=datetime.datetime(2024, 1, 1),
                    workflow_run_repo=mock_repo,
                )

    def test_equal_start_end_raises(self, mock_repo):
        dt = datetime.datetime(2024, 1, 1)
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = False
            with pytest.raises(ValueError):
                WorkflowRunCleanup(
                    days=30,
                    batch_size=10,
                    start_from=dt,
                    end_before=dt,
                    workflow_run_repo=mock_repo,
                )

    def test_zero_batch_size_raises(self, mock_repo):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = False
            with pytest.raises(ValueError, match="batch_size must be greater than 0"):
                WorkflowRunCleanup(days=30, batch_size=0, workflow_run_repo=mock_repo)

    def test_negative_batch_size_raises(self, mock_repo):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = False
            with pytest.raises(ValueError):
                WorkflowRunCleanup(days=30, batch_size=-1, workflow_run_repo=mock_repo)

    def test_valid_window_init(self, mock_repo):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 7
            cfg.BILLING_ENABLED = False
            start = datetime.datetime(2024, 1, 1)
            end = datetime.datetime(2024, 6, 1)
            c = WorkflowRunCleanup(
                days=30,
                batch_size=5,
                start_from=start,
                end_before=end,
                workflow_run_repo=mock_repo,
            )
            assert c.window_start == start
            assert c.window_end == end

    def test_default_task_label_is_custom(self, mock_repo):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = False
            c = WorkflowRunCleanup(days=30, batch_size=10, workflow_run_repo=mock_repo)

        assert c._metrics._base_attributes["task_label"] == "custom"


# ---------------------------------------------------------------------------
# _empty_related_counts / _format_related_counts
# ---------------------------------------------------------------------------


class TestStaticHelpers:
    def test_empty_related_counts(self):
        counts = WorkflowRunCleanup._empty_related_counts()
        assert counts == {
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }

    def test_format_related_counts(self):
        counts = {
            "node_executions": 1,
            "offloads": 2,
            "app_logs": 3,
            "trigger_logs": 4,
            "pauses": 5,
            "pause_reasons": 6,
        }
        result = WorkflowRunCleanup._format_related_counts(counts)
        assert "node_executions 1" in result
        assert "offloads 2" in result
        assert "trigger_logs 4" in result


# ---------------------------------------------------------------------------
# _expiration_datetime
# ---------------------------------------------------------------------------


class TestExpirationDatetime:
    def test_negative_returns_none(self, cleanup):
        assert cleanup._expiration_datetime("t1", -1) is None

    def test_valid_timestamp(self, cleanup):
        ts = int(datetime.datetime(2025, 1, 1, tzinfo=datetime.UTC).timestamp())
        result = cleanup._expiration_datetime("t1", ts)
        assert result is not None
        assert result.year == 2025

    def test_overflow_returns_none(self, cleanup):
        result = cleanup._expiration_datetime("t1", 2**62)
        assert result is None


# ---------------------------------------------------------------------------
# _is_within_grace_period
# ---------------------------------------------------------------------------


class TestIsWithinGracePeriod:
    def test_zero_grace_period_returns_false(self, cleanup):
        cleanup.free_plan_grace_period_days = 0
        assert cleanup._is_within_grace_period("t1", {"expiration_date": 9999999999}) is False

    def test_within_grace_period(self, cleanup):
        cleanup.free_plan_grace_period_days = 30
        # expired just 1 day ago
        expired = datetime.datetime.now(datetime.UTC) - datetime.timedelta(days=1)
        ts = int(expired.timestamp())
        assert cleanup._is_within_grace_period("t1", {"expiration_date": ts}) is True

    def test_outside_grace_period(self, cleanup):
        cleanup.free_plan_grace_period_days = 5
        # expired 100 days ago
        expired = datetime.datetime.now(datetime.UTC) - datetime.timedelta(days=100)
        ts = int(expired.timestamp())
        assert cleanup._is_within_grace_period("t1", {"expiration_date": ts}) is False

    def test_missing_expiration_date_returns_false(self, cleanup):
        cleanup.free_plan_grace_period_days = 30
        assert cleanup._is_within_grace_period("t1", {"expiration_date": -1}) is False


# ---------------------------------------------------------------------------
# _get_cleanup_whitelist
# ---------------------------------------------------------------------------


class TestGetCleanupWhitelist:
    def test_billing_disabled_returns_empty(self, cleanup):
        cleanup._cleanup_whitelist = None
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.BILLING_ENABLED = False
            result = cleanup._get_cleanup_whitelist()
        assert result == set()

    def test_billing_enabled_fetches_whitelist(self, mock_repo):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = True
            c = WorkflowRunCleanup(days=30, batch_size=10, workflow_run_repo=mock_repo)
            with patch(
                "services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.BillingService"
            ) as bs:
                bs.get_expired_subscription_cleanup_whitelist.return_value = ["t1", "t2"]
                result = c._get_cleanup_whitelist()
        assert result == {"t1", "t2"}

    def test_cached_whitelist_returned(self, cleanup):
        cleanup._cleanup_whitelist = {"cached"}
        result = cleanup._get_cleanup_whitelist()
        assert result == {"cached"}

    def test_billing_service_error_returns_empty(self, mock_repo):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = True
            c = WorkflowRunCleanup(days=30, batch_size=10, workflow_run_repo=mock_repo)
            with patch(
                "services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.BillingService"
            ) as bs:
                bs.get_expired_subscription_cleanup_whitelist.side_effect = Exception("error")
                result = c._get_cleanup_whitelist()
        assert result == set()


# ---------------------------------------------------------------------------
# _filter_free_tenants
# ---------------------------------------------------------------------------


class TestFilterFreeTenants:
    def test_billing_disabled_all_tenants_free(self, cleanup):
        result = cleanup._filter_free_tenants(["t1", "t2"])
        assert result == {"t1", "t2"}

    def test_empty_tenants_returns_empty(self, cleanup):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.BILLING_ENABLED = True
            result = cleanup._filter_free_tenants([])
        assert result == set()

    def test_whitelisted_tenant_excluded(self, mock_repo):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = True
            c = WorkflowRunCleanup(days=30, batch_size=10, workflow_run_repo=mock_repo)
            c._cleanup_whitelist = {"t1"}
            with patch(
                "services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.BillingService"
            ) as bs:
                from enums.cloud_plan import CloudPlan

                bs.get_plan_bulk_with_cache.return_value = {
                    "t1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
                    "t2": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
                }
                result = c._filter_free_tenants(["t1", "t2"])
        assert "t1" not in result
        assert "t2" in result

    def test_paid_tenant_excluded(self, mock_repo):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = True
            c = WorkflowRunCleanup(days=30, batch_size=10, workflow_run_repo=mock_repo)
            c._cleanup_whitelist = set()
            with patch(
                "services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.BillingService"
            ) as bs:
                bs.get_plan_bulk_with_cache.return_value = {
                    "t1": {"plan": "professional", "expiration_date": -1},
                }
                result = c._filter_free_tenants(["t1"])
        assert result == set()

    def test_missing_billing_info_treats_as_non_free(self, mock_repo):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = True
            c = WorkflowRunCleanup(days=30, batch_size=10, workflow_run_repo=mock_repo)
            c._cleanup_whitelist = set()
            with patch(
                "services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.BillingService"
            ) as bs:
                bs.get_plan_bulk_with_cache.return_value = {}
                result = c._filter_free_tenants(["t1"])
        assert result == set()

    def test_billing_bulk_error_treats_as_non_free(self, mock_repo):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = True
            c = WorkflowRunCleanup(days=30, batch_size=10, workflow_run_repo=mock_repo)
            c._cleanup_whitelist = set()
            with patch(
                "services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.BillingService"
            ) as bs:
                bs.get_plan_bulk_with_cache.side_effect = Exception("fail")
                result = c._filter_free_tenants(["t1"])
        assert result == set()


# ---------------------------------------------------------------------------
# run() — delete mode
# ---------------------------------------------------------------------------


class TestRunDeleteMode:
    def _make_cleanup(self, mock_repo, billing_enabled=False):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = billing_enabled
            return WorkflowRunCleanup(days=30, batch_size=10, workflow_run_repo=mock_repo)

    def test_no_rows_stops_immediately(self, mock_repo):
        mock_repo.get_runs_batch_by_time_range.return_value = []
        c = self._make_cleanup(mock_repo)
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.BILLING_ENABLED = False
            c.run()
        mock_repo.delete_runs_with_related.assert_not_called()

    def test_all_paid_skips_delete(self, mock_repo):
        run = make_run("t1")
        mock_repo.get_runs_batch_by_time_range.side_effect = [[run], []]
        c = self._make_cleanup(mock_repo)
        # billing disabled -> all free; but let's override _filter_free_tenants to return empty
        c._filter_free_tenants = MagicMock(return_value=set())
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.BILLING_ENABLED = False
            c.run()
        mock_repo.delete_runs_with_related.assert_not_called()

    def test_runs_deleted_successfully(self, mock_repo):
        run = make_run("t1")
        mock_repo.get_runs_batch_by_time_range.side_effect = [[run], []]
        mock_repo.delete_runs_with_related.return_value = {
            "runs": 1,
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }
        c = self._make_cleanup(mock_repo)
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.BILLING_ENABLED = False
            with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.time.sleep"):
                c.run()
        mock_repo.delete_runs_with_related.assert_called_once()

    def test_delete_exception_reraises(self, mock_repo):
        run = make_run("t1")
        mock_repo.get_runs_batch_by_time_range.side_effect = [[run], []]
        mock_repo.delete_runs_with_related.side_effect = RuntimeError("db error")
        c = self._make_cleanup(mock_repo)
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.BILLING_ENABLED = False
            with pytest.raises(RuntimeError):
                c.run()

    def test_summary_with_window_start(self, mock_repo):
        mock_repo.get_runs_batch_by_time_range.return_value = []
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = False
            c = WorkflowRunCleanup(
                days=30,
                batch_size=10,
                start_from=datetime.datetime(2024, 1, 1),
                end_before=datetime.datetime(2024, 6, 1),
                workflow_run_repo=mock_repo,
            )
            c.run()


# ---------------------------------------------------------------------------
# run() — dry run mode
# ---------------------------------------------------------------------------


class TestRunDryRunMode:
    def _make_dry_cleanup(self, mock_repo):
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = False
            return WorkflowRunCleanup(
                days=30,
                batch_size=10,
                workflow_run_repo=mock_repo,
                dry_run=True,
            )

    def test_dry_run_no_delete_called(self, mock_repo):
        run = make_run("t1")
        mock_repo.get_runs_batch_by_time_range.side_effect = [[run], []]
        mock_repo.count_runs_with_related.return_value = {
            "node_executions": 2,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 1,
            "pauses": 0,
            "pause_reasons": 0,
        }
        c = self._make_dry_cleanup(mock_repo)
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.BILLING_ENABLED = False
            c.run()
        mock_repo.delete_runs_with_related.assert_not_called()
        mock_repo.count_runs_with_related.assert_called_once()

    def test_dry_run_summary_with_window_start(self, mock_repo):
        mock_repo.get_runs_batch_by_time_range.return_value = []
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD = 0
            cfg.BILLING_ENABLED = False
            c = WorkflowRunCleanup(
                days=30,
                batch_size=10,
                start_from=datetime.datetime(2024, 1, 1),
                end_before=datetime.datetime(2024, 6, 1),
                workflow_run_repo=mock_repo,
                dry_run=True,
            )
            c.run()

    def test_dry_run_all_paid_skips_count(self, mock_repo):
        run = make_run("t1")
        mock_repo.get_runs_batch_by_time_range.side_effect = [[run], []]
        c = self._make_dry_cleanup(mock_repo)
        c._filter_free_tenants = MagicMock(return_value=set())
        with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.dify_config") as cfg:
            cfg.BILLING_ENABLED = False
            c.run()
        mock_repo.count_runs_with_related.assert_not_called()


# ---------------------------------------------------------------------------
# _delete_trigger_logs / _count_trigger_logs
# ---------------------------------------------------------------------------


class TestTriggerLogMethods:
    def test_delete_trigger_logs(self, cleanup):
        session = MagicMock()
        with patch(
            "services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.SQLAlchemyWorkflowTriggerLogRepository"
        ) as RepoClass:
            instance = RepoClass.return_value
            instance.delete_by_run_ids.return_value = 5
            result = cleanup._delete_trigger_logs(session, ["r1", "r2"])
        assert result == 5

    def test_count_trigger_logs(self, cleanup):
        session = MagicMock()
        with patch(
            "services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.SQLAlchemyWorkflowTriggerLogRepository"
        ) as RepoClass:
            instance = RepoClass.return_value
            instance.count_by_run_ids.return_value = 3
            result = cleanup._count_trigger_logs(session, ["r1"])
        assert result == 3


# ---------------------------------------------------------------------------
# _count_node_executions / _delete_node_executions
# ---------------------------------------------------------------------------


class TestNodeExecutionMethods:
    def test_count_node_executions(self, cleanup):
        session = MagicMock()
        session.get_bind.return_value = MagicMock()
        runs = [make_run("t1", "r1")]
        with patch(
            "services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.DifyAPIRepositoryFactory"
        ) as factory:
            repo = factory.create_api_workflow_node_execution_repository.return_value
            repo.count_by_runs.return_value = (10, 2)
            with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.sessionmaker"):
                result = cleanup._count_node_executions(session, runs)
        assert result == (10, 2)

    def test_delete_node_executions(self, cleanup):
        session = MagicMock()
        session.get_bind.return_value = MagicMock()
        runs = [make_run("t1", "r1")]
        with patch(
            "services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.DifyAPIRepositoryFactory"
        ) as factory:
            repo = factory.create_api_workflow_node_execution_repository.return_value
            repo.delete_by_runs.return_value = (5, 1)
            with patch("services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs.sessionmaker"):
                result = cleanup._delete_node_executions(session, runs)
        assert result == (5, 1)
