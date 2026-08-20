from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from extensions.logstore.repositories.logstore_workflow_node_execution_repository import (
    LogstoreWorkflowNodeExecutionRepository,
)
from models.account import Account
from models.workflow import WorkflowNodeExecutionTriggeredFrom


def _make_account() -> Account:
    account = Account(name="Logstore User", email="logstore@example.com")
    account.id = "account-1"
    return account


def test_save_synchronously_writes_sql_when_dual_write_is_disabled(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    monkeypatch.delenv("LOGSTORE_DUAL_WRITE_ENABLED", raising=False)
    with (
        patch("extensions.logstore.repositories.logstore_workflow_node_execution_repository.AliyunLogStore"),
        patch(
            "extensions.logstore.repositories.logstore_workflow_node_execution_repository."
            "SQLAlchemyWorkflowNodeExecutionRepository"
        ) as sql_repository_type,
    ):
        repository = LogstoreWorkflowNodeExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant-1",
            user=_make_account(),
            app_id="app-1",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

    execution = MagicMock()
    repository.save_synchronously(execution)

    assert repository._enable_dual_write is False
    sql_repository_type.return_value.save_synchronously.assert_called_once_with(execution)
