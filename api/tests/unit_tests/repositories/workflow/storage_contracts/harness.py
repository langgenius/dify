"""Configured repository ports and completion control used by every behavior case."""

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from core.app.workflow.persistence_ports import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
from extensions.application_services import workflow_storage, workflow_writers
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionTriggeredFrom
from services.workflow.node_execution_queries import DifyAPIWorkflowNodeExecutionRepository
from services.workflow.run_repository import APIWorkflowRunRepository
from tests.unit_tests.model_factories import make_account
from tests.unit_tests.repositories.workflow.storage_contracts.transports import AppendOnlyLogStore, TaskDeliveries

BACKENDS = ("rdbms", "celery", "logstore")


@dataclass
class StorageContract:
    sessions: sessionmaker[Session]
    deliveries: TaskDeliveries
    logs: AppendOnlyLogStore

    def run_writer(
        self,
        *,
        tenant: str = "tenant-1",
        app: str = "app-1",
        actor: str = "actor-1",
        trigger: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.APP_RUN,
    ) -> WorkflowExecutionRepository:
        return workflow_writers.create_workflow_execution_repository(
            session_factory=self.sessions,
            tenant_id=tenant,
            app_id=app,
            user=make_account(account_id=actor),
            triggered_from=trigger,
        )

    def node_writer(
        self,
        *,
        tenant: str = "tenant-1",
        app: str = "app-1",
        trigger: WorkflowNodeExecutionTriggeredFrom = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    ) -> WorkflowNodeExecutionRepository:
        return workflow_writers.create_workflow_node_execution_repository(
            session_factory=self.sessions,
            tenant_id=tenant,
            app_id=app,
            user=make_account(account_id="actor-1"),
            triggered_from=trigger,
        )

    def runs(self) -> APIWorkflowRunRepository:
        return workflow_storage.create_api_workflow_run_repository(self.sessions)

    def nodes(self) -> DifyAPIWorkflowNodeExecutionRepository:
        return workflow_storage.create_api_workflow_node_execution_repository(self.sessions)

    def settle(self) -> None:
        """Deliver accepted async work before asserting eventual read visibility."""
        self.deliveries.drain()
