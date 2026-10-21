"""Transaction-local deployment quota checks."""

import pytest
from sqlalchemy import Select, event
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker

from models.account import Account, Tenant
from models.model import DifySetup
from repositories.workspace.deployment_quota_repository import check_deployment_quota
from services.account_errors import SeatsLimitExceededError
from services.errors.workspace import WorkspacesLimitExceededError
from services.workspace.quota import DeploymentQuotaSnapshot


def test_limited_write_locks_setup_before_reading_current_usage(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                DifySetup(version="1"),
                Account(name="Existing", email="existing@example.com"),
                Tenant(name="Existing"),
            ]
        )

    statements: list[str] = []

    def record_statement(execution: ORMExecuteState) -> None:
        if isinstance(execution.statement, Select):
            statements.append(str(execution.statement.compile(dialect=mysql.dialect())))

    event.listen(sqlite_session_factory, "do_orm_execute", record_statement)
    try:
        with sqlite_session_factory.begin() as session:
            with pytest.raises(SeatsLimitExceededError):
                check_deployment_quota(
                    session,
                    DeploymentQuotaSnapshot(1, 0, 2, 0),
                    seats_delta=1,
                    workspaces_delta=1,
                )
    finally:
        event.remove(sqlite_session_factory, "do_orm_execute", record_statement)

    assert "FROM dify_setups" in statements[0]
    assert "FOR UPDATE" in statements[0]
    assert "FROM accounts" in statements[1]


def test_remote_usage_floor_and_workspace_count_are_both_enforced(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(DifySetup(version="1"))

    with sqlite_session_factory.begin() as session:
        with pytest.raises(SeatsLimitExceededError):
            check_deployment_quota(
                session,
                DeploymentQuotaSnapshot(2, 2, None, 0),
                seats_delta=1,
            )

    with sqlite_session_factory.begin() as session:
        session.add(Tenant(name="Existing"))
    with sqlite_session_factory.begin() as session:
        with pytest.raises(WorkspacesLimitExceededError):
            check_deployment_quota(
                session,
                DeploymentQuotaSnapshot(None, 0, 1, 0),
                workspaces_delta=1,
            )


def test_setup_bootstrap_without_marker_is_admitted(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        check_deployment_quota(
            session,
            DeploymentQuotaSnapshot(1, 1, 1, 1),
            seats_delta=1,
            workspaces_delta=1,
        )
