"""Regression tests for None rowcount handling in workflow deletion methods.

PostgreSQL and many SQLAlchemy DBAPI drivers can return ``None`` from
``CursorResult.rowcount`` (for example when ``CURSOR_FETCH`` is used or when
the dialect cannot determine the affected row count). The bulk-deletion
methods in these repositories declare ``-> int`` and do arithmetic on the
returned value, so a ``None`` would either propagate up as a typing
violation or crash with ``TypeError`` inside the accumulator.

These tests assert that all bulk-deletion code paths defensively treat a
``None`` rowcount as zero, matching the established pattern already used by
sibling methods in the same files (e.g. ``delete_by_runs`` and
``delete_run_by_id`` already use ``.rowcount or 0``).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import cast
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.factory import OrderConfig
from graphon.entities import WorkflowExecution, WorkflowNodeExecution
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository


class _TestWorkflowNodeExecutionRepository(DifyAPISQLAlchemyWorkflowNodeExecutionRepository):
    def save(self, execution: WorkflowNodeExecution):
        raise NotImplementedError

    def save_execution_data(self, execution: WorkflowNodeExecution):
        raise NotImplementedError

    def get_by_workflow_execution(
        self,
        workflow_execution_id: str,
        order_config: OrderConfig | None = None,
    ):
        raise NotImplementedError


class _TestWorkflowRunRepository(DifyAPISQLAlchemyWorkflowRunRepository):
    def save(self, execution: WorkflowExecution):
        raise NotImplementedError


def _make_session_with_rowcount(rowcount_value: int | None, execution_id_batches: list[list[str]]):
    """Build a MagicMock session whose execute().rowcount returns rowcount_value.

    ``execution_id_batches`` is a queue of batches that the SELECT-IDs query
    should yield; an empty batch terminates the while loop. Every DELETE
    call returns a CursorResult-like mock whose ``rowcount`` is the given
    ``rowcount_value``.
    """
    session = MagicMock()

    select_results = []
    for batch in execution_id_batches:
        sel = MagicMock()
        sel.scalars.return_value.all.return_value = batch
        sel.all.return_value = batch
        select_results.append(sel)

    delete_result = MagicMock()
    delete_result.rowcount = rowcount_value

    # session.execute alternates between SELECT and DELETE.
    # The simplest correct alternation: each iteration of the while loop calls
    # execute(select), then execute(delete) — but methods differ:
    #   delete_expired_executions: select scalars().all(), delete -> rowcount
    #   delete_executions_by_ids:  delete -> rowcount only (no select)
    # So we hand back values in order and let the test wire the right counts.
    execute_returns: list[MagicMock] = []
    for sel in select_results:
        execute_returns.append(sel)
        # Only enqueue a delete-result if the batch is non-empty (the code
        # short-circuits with `if not execution_ids: break` before deleting).
        if sel.all.return_value:
            execute_returns.append(delete_result)

    session.execute.side_effect = execute_returns
    session.scalar.side_effect = []  # never expected in these paths
    session.scalars.side_effect = list(select_results)
    session.commit.return_value = None

    return session, delete_result


def _make_session_maker(session: MagicMock) -> sessionmaker[Session]:
    """Return a sessionmaker stand-in whose context manager yields session."""

    def _maker():
        cm = MagicMock()
        cm.__enter__.return_value = session
        cm.__exit__.return_value = False
        return cm

    return cast(sessionmaker[Session], _maker)


# ----------------------------------------------------------------------------
# Node-execution repository
# ----------------------------------------------------------------------------


def test_delete_executions_by_ids_handles_none_rowcount() -> None:
    """``delete_executions_by_ids`` must coerce a None rowcount to 0."""
    session = MagicMock()
    delete_result = MagicMock()
    delete_result.rowcount = None  # simulate driver returning None
    session.execute.return_value = delete_result
    session.commit.return_value = None

    repo = _TestWorkflowNodeExecutionRepository(
        _make_session_maker(session),
    )

    deleted = repo.delete_executions_by_ids(["exec-1", "exec-2"])

    assert deleted == 0
    assert isinstance(deleted, int)


def test_delete_executions_by_ids_returns_rowcount_when_present() -> None:
    """Sanity: a real integer rowcount still flows through unchanged."""
    session = MagicMock()
    delete_result = MagicMock()
    delete_result.rowcount = 7
    session.execute.return_value = delete_result
    session.commit.return_value = None

    repo = _TestWorkflowNodeExecutionRepository(
        _make_session_maker(session),
    )

    deleted = repo.delete_executions_by_ids(["exec-1", "exec-2"])

    assert deleted == 7


def test_delete_expired_executions_accumulates_none_rowcount_as_zero() -> None:
    """The batched loop must not crash with TypeError when rowcount is None."""
    # First batch returns IDs, second batch is empty (terminates loop).
    session, _ = _make_session_with_rowcount(
        rowcount_value=None,
        execution_id_batches=[["exec-1", "exec-2"], []],
    )

    repo = _TestWorkflowNodeExecutionRepository(
        _make_session_maker(session),
    )

    # Must not raise TypeError: unsupported operand type(s) for +=: 'int' and 'NoneType'.
    deleted = repo.delete_expired_executions(
        tenant_id="t-1",
        before_date=datetime(2024, 1, 1, tzinfo=UTC),
        batch_size=10,
    )

    assert deleted == 0


def test_delete_executions_by_app_accumulates_none_rowcount_as_zero() -> None:
    session, _ = _make_session_with_rowcount(
        rowcount_value=None,
        execution_id_batches=[["exec-1", "exec-2", "exec-3"], []],
    )

    repo = _TestWorkflowNodeExecutionRepository(
        _make_session_maker(session),
    )

    deleted = repo.delete_executions_by_app(
        tenant_id="t-1",
        app_id="app-1",
        batch_size=10,
    )

    assert deleted == 0


# ----------------------------------------------------------------------------
# Workflow run repository
# ----------------------------------------------------------------------------


def test_delete_runs_by_ids_handles_none_rowcount() -> None:
    session = MagicMock()
    delete_result = MagicMock()
    delete_result.rowcount = None
    session.execute.return_value = delete_result
    session.commit.return_value = None

    repo = _TestWorkflowRunRepository(
        _make_session_maker(session),
    )

    deleted = repo.delete_runs_by_ids(["run-1", "run-2"])

    assert deleted == 0
    assert isinstance(deleted, int)


def test_delete_runs_by_app_accumulates_none_rowcount_as_zero() -> None:
    """The batched loop must terminate via the `batch_deleted < batch_size` guard.

    When ``rowcount`` is None the previous code crashed with TypeError on
    ``total_deleted += batch_deleted`` AND on ``batch_deleted < batch_size``.
    After the fix, batch_deleted is 0, which is less than batch_size, so the
    loop exits cleanly on the first iteration.
    """
    session = MagicMock()
    # First call: select.scalars().all() returns a batch of run IDs.
    select_result = MagicMock()
    select_result.all.return_value = ["run-1", "run-2"]
    session.scalars.return_value = select_result

    delete_result = MagicMock()
    delete_result.rowcount = None
    session.execute.return_value = delete_result
    session.commit.return_value = None

    repo = _TestWorkflowRunRepository(
        _make_session_maker(session),
    )

    deleted = repo.delete_runs_by_app(
        tenant_id="t-1",
        app_id="app-1",
        batch_size=10,
    )

    assert deleted == 0


if __name__ == "__main__":  # pragma: no cover - manual debug helper
    pytest.main([__file__, "-v"])
