from unittest.mock import MagicMock

import pytest

from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)


class TestSQLAlchemyWorkflowNodeExecutionServiceRepository:
    @pytest.fixture
    def repository(self):
        mock_session_maker = MagicMock()
        return DifyAPISQLAlchemyWorkflowNodeExecutionRepository(session_maker=mock_session_maker)

    def test_repository_implements_protocol(self, repository):
        """Test that the repository implements the required protocol methods."""
        # Verify all protocol methods are implemented
        assert hasattr(repository, "get_node_last_execution")
        assert hasattr(repository, "get_executions_by_workflow_run")
        assert hasattr(repository, "get_execution_by_id")

        # Verify methods are callable
        assert callable(repository.get_node_last_execution)
        assert callable(repository.get_executions_by_workflow_run)
        assert callable(repository.get_execution_by_id)
        assert callable(repository.delete_expired_executions)
        assert callable(repository.delete_executions_by_app)
        assert callable(repository.get_expired_executions_batch)
        assert callable(repository.delete_executions_by_ids)
