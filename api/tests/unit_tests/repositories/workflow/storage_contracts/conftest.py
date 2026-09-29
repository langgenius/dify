import sqlite3
from collections.abc import Iterator
from itertools import product

import pytest
from sqlalchemy.orm import Session, sessionmaker

from tasks.workflow_execution_tasks import save_workflow_execution_task
from tasks.workflow_node_execution_tasks import save_workflow_node_execution_task
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.repositories.workflow.storage_contracts.harness import BACKENDS, StorageContract
from tests.unit_tests.repositories.workflow.storage_contracts.transports import (
    AppendOnlyLogStore,
    TaskDeliveries,
    convert_tz,
)


@pytest.fixture
def transports(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> Iterator[StorageContract]:
    logs = AppendOnlyLogStore(pg=False)
    deliveries = TaskDeliveries()
    with sqlite_session_factory() as session:
        connection = session.connection().connection.driver_connection
        assert isinstance(connection, sqlite3.Connection)
        connection.create_function("CONVERT_TZ", 3, convert_tz)
    # Bind real worker code to the same isolated database as the configured writers.
    monkeypatch.setattr("core.db.session_factory._session_maker", sqlite_session_factory)
    monkeypatch.setattr(save_workflow_execution_task, "delay", deliveries.sender(save_workflow_execution_task.run))
    monkeypatch.setattr(
        save_workflow_node_execution_task, "delay", deliveries.sender(save_workflow_node_execution_task.run)
    )
    for module in ("execution_writer", "node_execution_writer", "run_repository", "node_execution_repository"):
        monkeypatch.setattr(f"repositories.workflow.logstore.{module}.AliyunLogStore", lambda: logs.client)
    apply_config_overrides(
        monkeypatch, LOGSTORE_DUAL_WRITE_ENABLED=False, LOGSTORE_DUAL_READ_ENABLED=False, DB_TYPE="mysql"
    )
    yield StorageContract(sessions=sqlite_session_factory, deliveries=deliveries, logs=logs)
    logs.close()


@pytest.fixture(params=[*(mode for mode in BACKENDS if mode != "logstore"), "logstore-sdk", "logstore-pg"])
def storage(
    request: pytest.FixtureRequest, transports: StorageContract, monkeypatch: pytest.MonkeyPatch
) -> StorageContract:
    mode = request.param.removesuffix("-sdk").removesuffix("-pg")
    apply_config_overrides(monkeypatch, WORKFLOW_RUN_STORAGE_BACKEND=mode, WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND=mode)
    transports.logs.client._use_pg_protocol = request.param == "logstore-pg"
    return transports


@pytest.fixture(
    params=list(product(BACKENDS, BACKENDS, [False, True])),
    ids=lambda case: f"run={case[0]}-node={case[1]}-{'pg' if case[2] else 'sdk'}",
)
def mixed_storage(
    request: pytest.FixtureRequest, transports: StorageContract, monkeypatch: pytest.MonkeyPatch
) -> StorageContract:
    run_mode, node_mode, pg = request.param
    transports.logs.client._use_pg_protocol = pg
    apply_config_overrides(
        monkeypatch, WORKFLOW_RUN_STORAGE_BACKEND=run_mode, WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND=node_mode
    )
    return transports
