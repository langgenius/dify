from collections.abc import Callable
from types import SimpleNamespace
from typing import cast
from unittest.mock import patch

from sqlalchemy.orm import Session, sessionmaker

from extensions.logstore.repositories.logstore_workflow_execution_repository import (
    LogstoreWorkflowExecutionRepository,
)
from graphon.entities import WorkflowExecution
from models.account import Account
from models.enums import WorkflowRunTriggeredFrom


def test_repository_uses_typed_logstore_migration_flags(
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    config_overrides(
        LOGSTORE_DUAL_WRITE_ENABLED=True,
        LOGSTORE_ENABLE_PUT_GRAPH_FIELD=False,
    )
    with (
        patch("extensions.logstore.repositories.logstore_workflow_execution_repository.AliyunLogStore"),
        patch(
            "extensions.logstore.repositories.logstore_workflow_execution_repository."
            "SQLAlchemyWorkflowExecutionRepository"
        ),
    ):
        repository = LogstoreWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant-1",
            user=cast(Account, SimpleNamespace(id="account-1")),
            app_id="app-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

    assert repository._enable_dual_write is True
    assert repository._enable_put_graph_field is False


def test_save_synchronously_delegates_to_sql_repository(
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    config_overrides(LOGSTORE_DUAL_WRITE_ENABLED=False)
    with (
        patch("extensions.logstore.repositories.logstore_workflow_execution_repository.AliyunLogStore") as logstore,
        patch(
            "extensions.logstore.repositories.logstore_workflow_execution_repository."
            "SQLAlchemyWorkflowExecutionRepository"
        ) as sql_repository,
    ):
        repository = LogstoreWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant-1",
            user=cast(Account, SimpleNamespace(id="account-1")),
            app_id="app-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )
        execution = cast(
            WorkflowExecution,
            SimpleNamespace(id_="run-1", workflow_id="workflow-1", status=SimpleNamespace(value="paused")),
        )

        with patch.object(repository, "_to_logstore_model", return_value=[("id", "run-1")]):
            repository.save_synchronously(execution)

    sql_repository.return_value.save_synchronously.assert_called_once_with(execution)
    sql_repository.return_value.save.assert_not_called()
    logstore.return_value.put_log.assert_called_once_with(logstore.workflow_execution_logstore, [("id", "run-1")])
