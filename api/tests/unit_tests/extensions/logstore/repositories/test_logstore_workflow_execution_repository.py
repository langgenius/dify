from collections.abc import Callable
from types import SimpleNamespace
from typing import cast
from unittest.mock import patch

from sqlalchemy.orm import Session, sessionmaker

from extensions.logstore.repositories.logstore_workflow_execution_repository import (
    LogstoreWorkflowExecutionRepository,
)
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
