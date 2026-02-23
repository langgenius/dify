"""Unit tests for DifyAPISQLAlchemyWorkflowNodeExecutionRepository implementation."""

from unittest.mock import Mock

from sqlalchemy.orm import Session, sessionmaker

from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)


class TestDifyAPISQLAlchemyWorkflowNodeExecutionRepository:
    def test_get_executions_by_workflow_run_keeps_paused_records(self):
        mock_session = Mock(spec=Session)
        execute_result = Mock()
        execute_result.scalars.return_value.all.return_value = []
        mock_session.execute.return_value = execute_result

        session_maker = Mock(spec=sessionmaker)
        context_manager = Mock()
        context_manager.__enter__ = Mock(return_value=mock_session)
        context_manager.__exit__ = Mock(return_value=None)
        session_maker.return_value = context_manager

        repository = DifyAPISQLAlchemyWorkflowNodeExecutionRepository(session_maker)

        repository.get_executions_by_workflow_run(
            tenant_id="tenant-123",
            app_id="app-123",
            workflow_run_id="workflow-run-123",
        )

        stmt = mock_session.execute.call_args[0][0]
        where_clauses = list(getattr(stmt, "_where_criteria", []) or [])
        where_strs = [str(clause).lower() for clause in where_clauses]

        assert any("tenant_id" in clause for clause in where_strs)
        assert any("app_id" in clause for clause in where_strs)
        assert any("workflow_run_id" in clause for clause in where_strs)
        assert not any("paused" in clause for clause in where_strs)
