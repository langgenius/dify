from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.enums import WorkflowNodeExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)


class TestSQLAlchemyWorkflowNodeExecutionServiceRepository:
    @staticmethod
    def _create_repository(db_session_with_containers: Session) -> DifyAPISQLAlchemyWorkflowNodeExecutionRepository:
        engine = db_session_with_containers.get_bind()
        assert isinstance(engine, Engine)
        return DifyAPISQLAlchemyWorkflowNodeExecutionRepository(
            session_maker=sessionmaker(bind=engine, expire_on_commit=False)
        )

    @staticmethod
    def _create_execution(
        db_session_with_containers: Session,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        workflow_run_id: str,
        node_id: str,
        status: WorkflowNodeExecutionStatus,
        index: int,
        created_at: datetime,
    ) -> WorkflowNodeExecutionModel:
        execution = WorkflowNodeExecutionModel(
            id=str(uuid4()),
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            triggered_from="workflow-run",
            workflow_run_id=workflow_run_id,
            index=index,
            predecessor_node_id=None,
            node_execution_id=None,
            node_id=node_id,
            node_type="llm",
            title=f"Node {index}",
            inputs="{}",
            process_data="{}",
            outputs="{}",
            status=status,
            error=None,
            elapsed_time=0.0,
            execution_metadata="{}",
            created_at=created_at,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid4()),
            finished_at=None,
        )
        db_session_with_containers.add(execution)
        db_session_with_containers.commit()
        return execution

    def test_get_node_last_execution_found(self, db_session_with_containers):
        """Test getting the last execution for a node when it exists."""
        # Arrange
        tenant_id = str(uuid4())
        app_id = str(uuid4())
        workflow_id = str(uuid4())
        node_id = "node-202"
        workflow_run_id = str(uuid4())
        now = naive_utc_now()
        self._create_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            status=WorkflowNodeExecutionStatus.PAUSED,
            index=1,
            created_at=now - timedelta(minutes=2),
        )
        expected = self._create_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=2,
            created_at=now - timedelta(minutes=1),
        )
        repository = self._create_repository(db_session_with_containers)

        # Act
        result = repository.get_node_last_execution(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            node_id=node_id,
        )

        # Assert
        assert result is not None
        assert result.id == expected.id
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED

    def test_get_node_last_execution_not_found(self, db_session_with_containers):
        """Test getting the last execution for a node when it doesn't exist."""
        # Arrange
        tenant_id = str(uuid4())
        app_id = str(uuid4())
        workflow_id = str(uuid4())
        repository = self._create_repository(db_session_with_containers)

        # Act
        result = repository.get_node_last_execution(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            node_id="node-202",
        )

        # Assert
        assert result is None

    def test_get_executions_by_workflow_run_empty(self, db_session_with_containers):
        """Test getting executions for a workflow run when none exist."""
        # Arrange
        tenant_id = str(uuid4())
        app_id = str(uuid4())
        workflow_run_id = str(uuid4())
        repository = self._create_repository(db_session_with_containers)

        # Act
        result = repository.get_executions_by_workflow_run(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
        )

        # Assert
        assert result == []

    def test_get_execution_by_id_found(self, db_session_with_containers):
        """Test getting execution by ID when it exists."""
        # Arrange
        execution = self._create_execution(
            db_session_with_containers,
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            workflow_run_id=str(uuid4()),
            node_id="node-202",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=1,
            created_at=naive_utc_now(),
        )
        repository = self._create_repository(db_session_with_containers)

        # Act
        result = repository.get_execution_by_id(execution.id)

        # Assert
        assert result is not None
        assert result.id == execution.id

    def test_get_execution_by_id_not_found(self, db_session_with_containers):
        """Test getting execution by ID when it doesn't exist."""
        # Arrange
        repository = self._create_repository(db_session_with_containers)
        missing_execution_id = str(uuid4())

        # Act
        result = repository.get_execution_by_id(missing_execution_id)

        # Assert
        assert result is None

    def test_delete_expired_executions(self, db_session_with_containers):
        """Test deleting expired executions."""
        # Arrange
        tenant_id = str(uuid4())
        app_id = str(uuid4())
        workflow_id = str(uuid4())
        workflow_run_id = str(uuid4())
        now = naive_utc_now()
        before_date = now - timedelta(days=1)
        old_execution_1 = self._create_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id="node-1",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=1,
            created_at=now - timedelta(days=3),
        )
        old_execution_2 = self._create_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id="node-2",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=2,
            created_at=now - timedelta(days=2),
        )
        kept_execution = self._create_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id="node-3",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=3,
            created_at=now,
        )
        old_execution_1_id = old_execution_1.id
        old_execution_2_id = old_execution_2.id
        kept_execution_id = kept_execution.id
        repository = self._create_repository(db_session_with_containers)

        # Act
        result = repository.delete_expired_executions(
            tenant_id=tenant_id,
            before_date=before_date,
            batch_size=1000,
        )

        # Assert
        assert result == 2
        remaining_ids = {
            execution.id
            for execution in db_session_with_containers.scalars(
                select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.tenant_id == tenant_id)
            ).all()
        }
        assert old_execution_1_id not in remaining_ids
        assert old_execution_2_id not in remaining_ids
        assert kept_execution_id in remaining_ids

    def test_delete_executions_by_app(self, db_session_with_containers):
        """Test deleting executions by app."""
        # Arrange
        tenant_id = str(uuid4())
        target_app_id = str(uuid4())
        workflow_id = str(uuid4())
        workflow_run_id = str(uuid4())
        created_at = naive_utc_now()
        deleted_1 = self._create_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=target_app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id="node-1",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=1,
            created_at=created_at,
        )
        deleted_2 = self._create_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=target_app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id="node-2",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=2,
            created_at=created_at,
        )
        kept = self._create_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=str(uuid4()),
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id="node-3",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=3,
            created_at=created_at,
        )
        deleted_1_id = deleted_1.id
        deleted_2_id = deleted_2.id
        kept_id = kept.id
        repository = self._create_repository(db_session_with_containers)

        # Act
        result = repository.delete_executions_by_app(
            tenant_id=tenant_id,
            app_id=target_app_id,
            batch_size=1000,
        )

        # Assert
        assert result == 2
        remaining_ids = {
            execution.id
            for execution in db_session_with_containers.scalars(
                select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.tenant_id == tenant_id)
            ).all()
        }
        assert deleted_1_id not in remaining_ids
        assert deleted_2_id not in remaining_ids
        assert kept_id in remaining_ids

    def test_get_expired_executions_batch(self, db_session_with_containers):
        """Test getting expired executions batch for backup."""
        # Arrange
        tenant_id = str(uuid4())
        app_id = str(uuid4())
        workflow_id = str(uuid4())
        workflow_run_id = str(uuid4())
        now = naive_utc_now()
        before_date = now - timedelta(days=1)
        old_execution_1 = self._create_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id="node-1",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=1,
            created_at=now - timedelta(days=3),
        )
        old_execution_2 = self._create_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id="node-2",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=2,
            created_at=now - timedelta(days=2),
        )
        self._create_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id="node-3",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=3,
            created_at=now,
        )
        repository = self._create_repository(db_session_with_containers)

        # Act
        result = repository.get_expired_executions_batch(
            tenant_id=tenant_id,
            before_date=before_date,
            batch_size=1000,
        )

        # Assert
        assert len(result) == 2
        result_ids = {execution.id for execution in result}
        assert old_execution_1.id in result_ids
        assert old_execution_2.id in result_ids

    def test_delete_executions_by_ids(self, db_session_with_containers):
        """Test deleting executions by IDs."""
        # Arrange
        tenant_id = str(uuid4())
        app_id = str(uuid4())
        workflow_id = str(uuid4())
        workflow_run_id = str(uuid4())
        created_at = naive_utc_now()
        execution_1 = self._create_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id="node-1",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=1,
            created_at=created_at,
        )
        execution_2 = self._create_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id="node-2",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=2,
            created_at=created_at,
        )
        execution_3 = self._create_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id="node-3",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=3,
            created_at=created_at,
        )
        repository = self._create_repository(db_session_with_containers)
        execution_ids = [execution_1.id, execution_2.id, execution_3.id]

        # Act
        result = repository.delete_executions_by_ids(execution_ids)

        # Assert
        assert result == 3
        remaining = db_session_with_containers.scalars(
            select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id.in_(execution_ids))
        ).all()
        assert remaining == []

    def test_delete_executions_by_ids_empty_list(self, db_session_with_containers):
        """Test deleting executions with empty ID list."""
        # Arrange
        repository = self._create_repository(db_session_with_containers)

        # Act
        result = repository.delete_executions_by_ids([])

        # Assert
        assert result == 0
