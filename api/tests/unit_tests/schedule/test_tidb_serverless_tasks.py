"""Unit tests for the TiDB serverless schedule tasks.

Covers ``create_tidb_serverless_task`` / ``create_clusters`` and
``update_tidb_serverless_status_task`` after the explicit session passing
refactor: the external TiDB cloud SDK is mocked, while all persistence runs
against the shared SQLite session factory.
"""

from collections.abc import Callable
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import schedule.create_tidb_serverless_task as create_tidb_module
import schedule.update_tidb_serverless_status_task as update_tidb_module
from core.db.session_factory import session_factory
from models.dataset import TidbAuthBinding
from models.enums import TidbAuthBindingStatus
from schedule.create_tidb_serverless_task import create_clusters, create_tidb_serverless_task
from schedule.update_tidb_serverless_status_task import update_tidb_serverless_status_task


def _fake_cluster(cluster_id: str) -> dict[str, str | None]:
    return {
        "cluster_id": cluster_id,
        "cluster_name": f"cluster-{cluster_id}",
        "account": "root",
        "password": "secret",
        "qdrant_endpoint": None,
    }


def _seed_binding(session_factory_: sessionmaker[Session], *, status: TidbAuthBindingStatus, active: bool) -> str:
    binding = TidbAuthBinding(
        tenant_id=None,
        cluster_id=f"existing-{status.value}",
        cluster_name="existing",
        account="root",
        password="secret",
        active=active,
        status=status,
    )
    with session_factory_() as session:
        session.add(binding)
        session.commit()
    return binding.id


@pytest.fixture(autouse=True)
def create_tidb_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        CREATE_TIDB_SERVICE_JOB_ENABLED=True,
        TIDB_SERVERLESS_NUMBER=2,
        TIDB_PROJECT_ID="project",
        TIDB_API_URL="https://api.example.com",
        TIDB_IAM_API_URL="https://iam.example.com",
        TIDB_PUBLIC_KEY="public",
        TIDB_PRIVATE_KEY="private",
        TIDB_REGION="regions/aws-us-east-1",
    )


def test_create_clusters_persists_bindings_through_passed_session(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with patch.object(
        create_tidb_module.TidbService,
        "batch_create_tidb_serverless_cluster",
        return_value=[_fake_cluster("c-1"), _fake_cluster("c-2")],
    ):
        with session_factory.create_session() as session:
            create_clusters(20, session)

    with sqlite_session_factory() as session:
        bindings = session.scalars(select(TidbAuthBinding)).all()

    assert {binding.cluster_id for binding in bindings} == {"c-1", "c-2"}
    assert all(binding.status == TidbAuthBindingStatus.CREATING for binding in bindings)
    assert all(binding.active is False for binding in bindings)


def test_create_task_stops_once_enough_idle_clusters_exist(sqlite_session_factory: sessionmaker[Session]) -> None:
    # Two idle (inactive) bindings already satisfy TIDB_SERVERLESS_NUMBER=2.
    _seed_binding(sqlite_session_factory, status=TidbAuthBindingStatus.CREATING, active=False)
    _seed_binding(sqlite_session_factory, status=TidbAuthBindingStatus.CREATING, active=False)

    with patch.object(create_tidb_module.TidbService, "batch_create_tidb_serverless_cluster") as mock_batch_create:
        create_tidb_serverless_task()

    mock_batch_create.assert_not_called()


def test_create_task_creates_clusters_until_target_reached(sqlite_session_factory: sessionmaker[Session]) -> None:
    # No idle bindings yet: the task must create clusters until TIDB_SERVERLESS_NUMBER=2 is met.
    with patch.object(
        create_tidb_module.TidbService,
        "batch_create_tidb_serverless_cluster",
        return_value=[_fake_cluster("new-1"), _fake_cluster("new-2")],
    ) as mock_batch_create:
        create_tidb_serverless_task()

    mock_batch_create.assert_called_once()
    with sqlite_session_factory() as session:
        bindings = session.scalars(select(TidbAuthBinding)).all()
    assert {binding.cluster_id for binding in bindings} == {"new-1", "new-2"}


def test_create_task_skips_when_disabled(
    sqlite_session_factory: sessionmaker[Session], config_overrides: Callable[..., None]
) -> None:
    config_overrides(CREATE_TIDB_SERVICE_JOB_ENABLED=False)

    with patch.object(create_tidb_module.TidbService, "batch_create_tidb_serverless_cluster") as mock_batch_create:
        create_tidb_serverless_task()

    mock_batch_create.assert_not_called()
    with sqlite_session_factory() as session:
        assert session.scalars(select(TidbAuthBinding)).all() == []


def test_update_task_only_selects_inactive_creating_bindings(sqlite_session_factory: sessionmaker[Session]) -> None:
    creating_id = _seed_binding(sqlite_session_factory, status=TidbAuthBindingStatus.CREATING, active=False)
    # Active bindings and non-CREATING statuses must be skipped.
    _seed_binding(sqlite_session_factory, status=TidbAuthBindingStatus.CREATING, active=True)
    _seed_binding(sqlite_session_factory, status=TidbAuthBindingStatus.ACTIVE, active=False)

    with patch.object(
        update_tidb_module.TidbService, "batch_update_tidb_serverless_cluster_status"
    ) as mock_batch_update:
        update_tidb_serverless_status_task()

    mock_batch_update.assert_called_once()
    submitted = mock_batch_update.call_args.kwargs["tidb_serverless_list"]
    assert [binding.id for binding in submitted] == [creating_id]
