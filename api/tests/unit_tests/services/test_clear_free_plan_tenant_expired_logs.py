import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy.orm import Session

from enums.cloud_plan import CloudPlan
from services import clear_free_plan_tenant_expired_logs as service_module
from services.clear_free_plan_tenant_expired_logs import ClearFreePlanTenantExpiredLogs


class TestClearFreePlanTenantExpiredLogs:
    """Unit tests for ClearFreePlanTenantExpiredLogs._clear_message_related_tables method."""

    @pytest.fixture
    def mock_session(self):
        """Create a mock database session."""
        session = Mock(spec=Session)
        session.query.return_value.filter.return_value.all.return_value = []
        session.query.return_value.filter.return_value.delete.return_value = 0
        return session

    @pytest.fixture
    def mock_storage(self):
        """Create a mock storage object."""
        storage = Mock()
        storage.save.return_value = None
        return storage

    @pytest.fixture
    def sample_message_ids(self):
        """Sample message IDs for testing."""
        return ["msg-1", "msg-2", "msg-3"]

    @pytest.fixture
    def sample_records(self):
        """Sample records for testing."""
        records = []
        for i in range(3):
            record = Mock()
            record.id = f"record-{i}"
            record.to_dict.return_value = {
                "id": f"record-{i}",
                "message_id": f"msg-{i}",
                "created_at": datetime.datetime.now().isoformat(),
            }
            records.append(record)
        return records

    def test_clear_message_related_tables_empty_message_ids(self, mock_session):
        """Test that method returns early when message_ids is empty."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", [])

            # Should not call any database operations
            mock_session.query.assert_not_called()
            mock_storage.save.assert_not_called()

    def test_clear_message_related_tables_no_records_found(self, mock_session, sample_message_ids):
        """Test when no related records are found."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            mock_session.query.return_value.where.return_value.all.return_value = []

            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", sample_message_ids)

            # Should call query for each related table but find no records
            assert mock_session.query.call_count > 0
            mock_storage.save.assert_not_called()

    def test_clear_message_related_tables_with_records_and_to_dict(
        self, mock_session, sample_message_ids, sample_records
    ):
        """Test when records are found and have to_dict method."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            mock_session.query.return_value.where.return_value.all.return_value = sample_records

            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", sample_message_ids)

            # Should call to_dict on each record (called once per table, so 7 times total)
            for record in sample_records:
                assert record.to_dict.call_count == 7

            # Should save backup data
            assert mock_storage.save.call_count > 0

    def test_clear_message_related_tables_with_records_no_to_dict(self, mock_session, sample_message_ids):
        """Test when records are found but don't have to_dict method."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            # Create records without to_dict method
            records = []
            for i in range(2):
                record = Mock()
                mock_table = Mock()
                mock_id_column = Mock()
                mock_id_column.name = "id"
                mock_message_id_column = Mock()
                mock_message_id_column.name = "message_id"
                mock_table.columns = [mock_id_column, mock_message_id_column]
                record.__table__ = mock_table
                record.id = f"record-{i}"
                record.message_id = f"msg-{i}"
                del record.to_dict
                records.append(record)

            # Mock records for first table only, empty for others
            mock_session.query.return_value.where.return_value.all.side_effect = [
                records,
                [],
                [],
                [],
                [],
                [],
                [],
            ]

            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", sample_message_ids)

            # Should save backup data even without to_dict
            assert mock_storage.save.call_count > 0

    def test_clear_message_related_tables_storage_error_continues(
        self, mock_session, sample_message_ids, sample_records
    ):
        """Test that method continues even when storage.save fails."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            mock_storage.save.side_effect = Exception("Storage error")

            mock_session.query.return_value.where.return_value.all.return_value = sample_records

            # Should not raise exception
            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", sample_message_ids)

            # Should still delete records even if backup fails
            assert mock_session.query.return_value.where.return_value.delete.called

    def test_clear_message_related_tables_serialization_error_continues(self, mock_session, sample_message_ids):
        """Test that method continues even when record serialization fails."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            record = Mock()
            record.id = "record-1"
            record.to_dict.side_effect = Exception("Serialization error")

            mock_session.query.return_value.where.return_value.all.return_value = [record]

            # Should not raise exception
            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", sample_message_ids)

            # Should still delete records even if serialization fails
            assert mock_session.query.return_value.where.return_value.delete.called

    def test_clear_message_related_tables_deletion_called(self, mock_session, sample_message_ids, sample_records):
        """Test that deletion is called for found records."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            mock_session.query.return_value.where.return_value.all.return_value = sample_records

            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", sample_message_ids)

            # Should call delete for each table that has records
            assert mock_session.query.return_value.where.return_value.delete.called

    def test_clear_message_related_tables_all_serialization_fails_skips_backup_but_deletes(
        self, mock_session, sample_message_ids
    ):
        record = Mock()
        record.id = "record-1"
        record.to_dict.side_effect = Exception("Serialization error")

        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            mock_session.query.return_value.where.return_value.all.return_value = [record]

            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", sample_message_ids)

            mock_storage.save.assert_not_called()
            assert mock_session.query.return_value.where.return_value.delete.called


class _ImmediateFuture:
    def __init__(self, fn, args, kwargs):
        self._fn = fn
        self._args = args
        self._kwargs = kwargs

    def result(self):
        return self._fn(*self._args, **self._kwargs)


class _ImmediateExecutor:
    def __init__(self, *args, **kwargs) -> None:
        self.submitted: list[tuple[object, tuple[object, ...], dict[str, object]]] = []

    def submit(self, fn, *args, **kwargs):
        self.submitted.append((fn, args, kwargs))
        return _ImmediateFuture(fn, args, kwargs)


def _session_wrapper_for_no_autoflush(session: Mock) -> Mock:
    """
    ClearFreePlanTenantExpiredLogs.process_tenant uses:
      with Session(db.engine).no_autoflush as session:
    so Session(db.engine) must return an object with a no_autoflush context manager.
    """
    cm = MagicMock()
    cm.__enter__.return_value = session
    cm.__exit__.return_value = None

    wrapper = MagicMock()
    wrapper.no_autoflush = cm
    return wrapper


def _session_wrapper_for_direct(session: Mock) -> Mock:
    """ClearFreePlanTenantExpiredLogs.process uses: with Session(db.engine) as session:"""
    wrapper = MagicMock()
    wrapper.__enter__.return_value = session
    wrapper.__exit__.return_value = None
    return wrapper


def test_process_tenant_processes_all_batches(monkeypatch: pytest.MonkeyPatch) -> None:
    flask_app = service_module.Flask("test-app")

    monkeypatch.setattr(
        service_module,
        "db",
        SimpleNamespace(
            engine=object(),
            session=SimpleNamespace(
                scalars=lambda _stmt: SimpleNamespace(
                    all=lambda: [SimpleNamespace(id="app-1"), SimpleNamespace(id="app-2")]
                )
            ),
        ),
    )

    mock_storage = MagicMock()
    monkeypatch.setattr(service_module, "storage", mock_storage)
    monkeypatch.setattr(service_module.click, "echo", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service_module.click, "style", lambda msg, **_kwargs: msg)

    clear_related = MagicMock()
    monkeypatch.setattr(ClearFreePlanTenantExpiredLogs, "_clear_message_related_tables", clear_related)

    # Session sequence for messages, conversations, workflow_app_logs loops:
    # - messages: one batch then empty
    # - conversations: one batch then empty
    # - workflow app logs: one batch then empty
    msg1 = SimpleNamespace(id="m1", to_dict=lambda: {"id": "m1"})
    conv1 = SimpleNamespace(id="c1", to_dict=lambda: {"id": "c1"})
    log1 = SimpleNamespace(id="l1", to_dict=lambda: {"id": "l1"})

    def make_query_with_batches(batches: list[list[object]]):
        q = MagicMock()
        q.where.return_value = q
        q.limit.return_value = q
        q.all.side_effect = batches
        q.delete.return_value = 1
        return q

    msg_session_1 = MagicMock()
    msg_session_1.query.side_effect = lambda model: (
        make_query_with_batches([[msg1], []]) if model == service_module.Message else MagicMock()
    )
    msg_session_1.commit.return_value = None

    msg_session_2 = MagicMock()
    msg_session_2.query.side_effect = lambda model: (
        make_query_with_batches([[]]) if model == service_module.Message else MagicMock()
    )
    msg_session_2.commit.return_value = None

    conv_session_1 = MagicMock()
    conv_session_1.query.side_effect = lambda model: (
        make_query_with_batches([[conv1], []]) if model == service_module.Conversation else MagicMock()
    )
    conv_session_1.commit.return_value = None

    conv_session_2 = MagicMock()
    conv_session_2.query.side_effect = lambda model: (
        make_query_with_batches([[]]) if model == service_module.Conversation else MagicMock()
    )
    conv_session_2.commit.return_value = None

    wal_session_1 = MagicMock()
    wal_session_1.query.side_effect = lambda model: (
        make_query_with_batches([[log1], []]) if model == service_module.WorkflowAppLog else MagicMock()
    )
    wal_session_1.commit.return_value = None

    wal_session_2 = MagicMock()
    wal_session_2.query.side_effect = lambda model: (
        make_query_with_batches([[]]) if model == service_module.WorkflowAppLog else MagicMock()
    )
    wal_session_2.commit.return_value = None

    session_wrappers = [
        _session_wrapper_for_no_autoflush(msg_session_1),
        _session_wrapper_for_no_autoflush(msg_session_2),
        _session_wrapper_for_no_autoflush(conv_session_1),
        _session_wrapper_for_no_autoflush(conv_session_2),
        _session_wrapper_for_no_autoflush(wal_session_1),
        _session_wrapper_for_no_autoflush(wal_session_2),
    ]

    monkeypatch.setattr(service_module, "Session", lambda _engine: session_wrappers.pop(0))

    def fake_select(*_args, **_kwargs):
        stmt = MagicMock()
        stmt.where.return_value = stmt
        return stmt

    monkeypatch.setattr(service_module, "select", fake_select)

    # Repositories for workflow node executions and workflow runs
    node_repo = MagicMock()
    node_repo.get_expired_executions_batch.side_effect = [[SimpleNamespace(id="ne-1")], []]
    node_repo.delete_executions_by_ids.return_value = 1

    run_repo = MagicMock()
    run_repo.get_expired_runs_batch.side_effect = [[SimpleNamespace(id="wr-1", to_dict=lambda: {"id": "wr-1"})], []]
    run_repo.delete_runs_by_ids.return_value = 1

    monkeypatch.setattr(service_module, "sessionmaker", lambda **_kwargs: object())
    monkeypatch.setattr(
        service_module.DifyAPIRepositoryFactory,
        "create_api_workflow_node_execution_repository",
        lambda _sm: node_repo,
    )
    monkeypatch.setattr(
        service_module.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda _sm: run_repo,
    )

    ClearFreePlanTenantExpiredLogs.process_tenant(flask_app, "tenant-1", days=7, batch=10)

    # messages backup, conversations backup, node executions backup, runs backup, workflow app logs backup
    assert mock_storage.save.call_count >= 5
    clear_related.assert_called()


def test_process_with_tenant_ids_filters_by_plan_and_logs_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service_module, "db", SimpleNamespace(engine=object()))

    # Total tenant count query
    count_session = MagicMock()
    count_query = MagicMock()
    count_query.count.return_value = 2
    count_session.query.return_value = count_query

    monkeypatch.setattr(service_module, "Session", lambda _engine: _session_wrapper_for_direct(count_session))

    # Avoid LocalProxy usage
    flask_app = service_module.Flask("test-app")
    monkeypatch.setattr(service_module, "current_app", SimpleNamespace(_get_current_object=lambda: flask_app))

    executor = _ImmediateExecutor()
    monkeypatch.setattr(service_module, "ThreadPoolExecutor", lambda **_kwargs: executor)

    monkeypatch.setattr(service_module.click, "style", lambda msg, **_kwargs: msg)
    echo_mock = MagicMock()
    monkeypatch.setattr(service_module.click, "echo", echo_mock)

    monkeypatch.setattr(service_module.dify_config, "BILLING_ENABLED", True)

    def fake_get_info(tenant_id: str):
        if tenant_id == "t_sandbox":
            return {"subscription": {"plan": CloudPlan.SANDBOX}}
        if tenant_id == "t_fail":
            raise RuntimeError("boom")
        return {"subscription": {"plan": "team"}}

    monkeypatch.setattr(service_module.BillingService, "get_info", staticmethod(fake_get_info))

    process_tenant_mock = MagicMock(side_effect=lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("err")))
    monkeypatch.setattr(ClearFreePlanTenantExpiredLogs, "process_tenant", process_tenant_mock)

    logger_exc = MagicMock()
    monkeypatch.setattr(service_module.logger, "exception", logger_exc)

    ClearFreePlanTenantExpiredLogs.process(days=7, batch=10, tenant_ids=["t_sandbox", "t_paid", "t_fail"])

    # Only sandbox tenant should attempt processing, and its failure should be swallowed + logged.
    assert process_tenant_mock.call_count == 1
    assert logger_exc.call_count >= 1


def test_process_without_tenant_ids_batches_and_scales_interval(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(service_module.dify_config, "BILLING_ENABLED", False)

    started_at = datetime.datetime(2023, 4, 3, 8, 59, 24)
    fixed_now = started_at + datetime.timedelta(hours=2)

    class FixedDateTime(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_now

    monkeypatch.setattr(service_module.datetime, "datetime", FixedDateTime)

    # Avoid LocalProxy usage
    flask_app = service_module.Flask("test-app")
    monkeypatch.setattr(service_module, "current_app", SimpleNamespace(_get_current_object=lambda: flask_app))

    executor = _ImmediateExecutor()
    monkeypatch.setattr(service_module, "ThreadPoolExecutor", lambda **_kwargs: executor)

    monkeypatch.setattr(service_module.click, "style", lambda msg, **_kwargs: msg)
    monkeypatch.setattr(service_module.click, "echo", lambda *_args, **_kwargs: None)

    # Sessions used:
    # 1) total tenant count
    # 2) per-batch tenant scan (count + tenant list)
    total_session = MagicMock()
    total_query = MagicMock()
    total_query.count.return_value = 250
    total_session.query.return_value = total_query

    batch_session = MagicMock()
    q1 = MagicMock()
    q1.where.return_value = q1
    q1.count.return_value = 200
    q2 = MagicMock()
    q2.where.return_value = q2
    q2.count.return_value = 200
    q3 = MagicMock()
    q3.where.return_value = q3
    q3.count.return_value = 200
    q4 = MagicMock()
    q4.where.return_value = q4
    q4.count.return_value = 50  # choose this interval, then scale it

    rows = [SimpleNamespace(id="tenant-a"), SimpleNamespace(id="tenant-b")]
    q_rs = MagicMock()
    q_rs.where.return_value = q_rs
    q_rs.order_by.return_value = rows

    batch_session.query.side_effect = [q1, q2, q3, q4, q_rs]

    sessions = [_session_wrapper_for_direct(total_session), _session_wrapper_for_direct(batch_session)]
    monkeypatch.setattr(service_module, "Session", lambda _engine: sessions.pop(0))

    process_tenant_mock = MagicMock()
    monkeypatch.setattr(ClearFreePlanTenantExpiredLogs, "process_tenant", process_tenant_mock)

    ClearFreePlanTenantExpiredLogs.process(days=7, batch=10, tenant_ids=[])

    # Should submit/process tenants from the batch query
    assert process_tenant_mock.call_count == 2


def test_process_with_tenant_ids_emits_progress_every_100(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service_module, "db", SimpleNamespace(engine=object()))

    count_session = MagicMock()
    count_query = MagicMock()
    count_query.count.return_value = 100
    count_session.query.return_value = count_query
    monkeypatch.setattr(service_module, "Session", lambda _engine: _session_wrapper_for_direct(count_session))

    flask_app = service_module.Flask("test-app")
    monkeypatch.setattr(service_module, "current_app", SimpleNamespace(_get_current_object=lambda: flask_app))
    monkeypatch.setattr(service_module.dify_config, "BILLING_ENABLED", False)

    executor = _ImmediateExecutor()
    monkeypatch.setattr(service_module, "ThreadPoolExecutor", lambda **_kwargs: executor)

    echo_mock = MagicMock()
    monkeypatch.setattr(service_module.click, "style", lambda msg, **_kwargs: msg)
    monkeypatch.setattr(service_module.click, "echo", echo_mock)

    monkeypatch.setattr(ClearFreePlanTenantExpiredLogs, "process_tenant", MagicMock())

    tenant_ids = [f"t{i}" for i in range(100)]
    ClearFreePlanTenantExpiredLogs.process(days=7, batch=10, tenant_ids=tenant_ids)

    assert any("Processed 100 tenants" in str(call.args[0]) for call in echo_mock.call_args_list)


def test_process_without_tenant_ids_all_intervals_too_many_uses_min_interval(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(service_module.dify_config, "BILLING_ENABLED", False)

    started_at = datetime.datetime(2023, 4, 3, 8, 59, 24)
    # Keep the total range smaller than the minimum interval (1 hour) so the loop runs once.
    fixed_now = started_at + datetime.timedelta(minutes=30)

    class FixedDateTime(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_now

    monkeypatch.setattr(service_module.datetime, "datetime", FixedDateTime)

    flask_app = service_module.Flask("test-app")
    monkeypatch.setattr(service_module, "current_app", SimpleNamespace(_get_current_object=lambda: flask_app))

    executor = _ImmediateExecutor()
    monkeypatch.setattr(service_module, "ThreadPoolExecutor", lambda **_kwargs: executor)

    monkeypatch.setattr(service_module.click, "style", lambda msg, **_kwargs: msg)
    monkeypatch.setattr(service_module.click, "echo", lambda *_args, **_kwargs: None)

    total_session = MagicMock()
    total_query = MagicMock()
    total_query.count.return_value = 250
    total_session.query.return_value = total_query

    batch_session = MagicMock()
    # Count results for all 5 intervals, all > 100 => take the for-else path.
    count_queries = []
    for _ in range(5):
        q = MagicMock()
        q.where.return_value = q
        q.count.return_value = 200
        count_queries.append(q)

    rows = [SimpleNamespace(id="tenant-a")]
    q_rs = MagicMock()
    q_rs.where.return_value = q_rs
    q_rs.order_by.return_value = rows

    batch_session.query.side_effect = [*count_queries, q_rs]

    sessions = [_session_wrapper_for_direct(total_session), _session_wrapper_for_direct(batch_session)]
    monkeypatch.setattr(service_module, "Session", lambda _engine: sessions.pop(0))

    process_tenant_mock = MagicMock()
    monkeypatch.setattr(ClearFreePlanTenantExpiredLogs, "process_tenant", process_tenant_mock)

    ClearFreePlanTenantExpiredLogs.process(days=7, batch=10, tenant_ids=[])

    assert process_tenant_mock.call_count == 1
    assert len(count_queries) == 5
    assert batch_session.query.call_count >= 6


def test_process_tenant_repo_loops_break_on_empty_second_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    flask_app = service_module.Flask("test-app")

    monkeypatch.setattr(
        service_module,
        "db",
        SimpleNamespace(
            engine=object(),
            session=SimpleNamespace(scalars=lambda _stmt: SimpleNamespace(all=lambda: [SimpleNamespace(id="app-1")])),
        ),
    )
    mock_storage = MagicMock()
    monkeypatch.setattr(service_module, "storage", mock_storage)
    monkeypatch.setattr(service_module.click, "echo", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service_module.click, "style", lambda msg, **_kwargs: msg)
    monkeypatch.setattr(ClearFreePlanTenantExpiredLogs, "_clear_message_related_tables", MagicMock())

    # Make message/conversation/workflow_app_log loops no-op (empty immediately)
    empty_session = MagicMock()
    q_empty = MagicMock()
    q_empty.where.return_value = q_empty
    q_empty.limit.return_value = q_empty
    q_empty.all.return_value = []
    empty_session.query.return_value = q_empty
    empty_session.commit.return_value = None
    session_wrappers = [
        _session_wrapper_for_no_autoflush(empty_session),
        _session_wrapper_for_no_autoflush(empty_session),
        _session_wrapper_for_no_autoflush(empty_session),
    ]
    monkeypatch.setattr(service_module, "Session", lambda _engine: session_wrappers.pop(0))

    def fake_select(*_args, **_kwargs):
        stmt = MagicMock()
        stmt.where.return_value = stmt
        return stmt

    monkeypatch.setattr(service_module, "select", fake_select)

    # Repos: first returns exactly batch items -> no "< batch" break, second returns [] -> hit the len==0 break.
    node_repo = MagicMock()
    node_repo.get_expired_executions_batch.side_effect = [
        [SimpleNamespace(id="ne-1"), SimpleNamespace(id="ne-2")],
        [],
    ]
    node_repo.delete_executions_by_ids.return_value = 2

    run_repo = MagicMock()
    run_repo.get_expired_runs_batch.side_effect = [
        [
            SimpleNamespace(id="wr-1", to_dict=lambda: {"id": "wr-1"}),
            SimpleNamespace(id="wr-2", to_dict=lambda: {"id": "wr-2"}),
        ],
        [],
    ]
    run_repo.delete_runs_by_ids.return_value = 2

    monkeypatch.setattr(service_module, "sessionmaker", lambda **_kwargs: object())
    monkeypatch.setattr(
        service_module.DifyAPIRepositoryFactory,
        "create_api_workflow_node_execution_repository",
        lambda _sm: node_repo,
    )
    monkeypatch.setattr(
        service_module.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda _sm: run_repo,
    )

    ClearFreePlanTenantExpiredLogs.process_tenant(flask_app, "tenant-1", days=7, batch=2)

    assert node_repo.get_expired_executions_batch.call_count == 2
    assert run_repo.get_expired_runs_batch.call_count == 2
