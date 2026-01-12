from unittest.mock import Mock

from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository


def test_delete_by_run_ids_executes_delete():
    session = Mock(spec=Session)
    session.execute.return_value = Mock(rowcount=2)
    repo = SQLAlchemyWorkflowTriggerLogRepository(session)

    deleted = repo.delete_by_run_ids(["run-1", "run-2"])

    stmt = session.execute.call_args[0][0]
    compiled_sql = str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    assert "workflow_trigger_logs" in compiled_sql
    assert "'run-1'" in compiled_sql
    assert "'run-2'" in compiled_sql
    assert deleted == 2


def test_delete_by_run_ids_empty_short_circuits():
    session = Mock(spec=Session)
    repo = SQLAlchemyWorkflowTriggerLogRepository(session)

    deleted = repo.delete_by_run_ids([])

    session.execute.assert_not_called()
    assert deleted == 0
