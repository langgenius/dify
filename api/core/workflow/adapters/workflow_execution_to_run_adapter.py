"""
Adapter for converting WorkflowExecution domain entities to WorkflowRun database models.

This adapter bridges the gap between the core domain model (WorkflowExecution)
and the database model (WorkflowRun) that APIs expect.
"""

import json
import logging

from core.workflow.entities import WorkflowExecution
from core.workflow.enums import WorkflowExecutionStatus
from models.workflow import WorkflowRun

logger = logging.getLogger(__name__)


class WorkflowExecutionToRunAdapter:
    """
    Adapter for converting WorkflowExecution domain entities to WorkflowRun database models.
    
    This adapter ensures that API endpoints that expect WorkflowRun data can work
    with WorkflowExecution entities stored in Elasticsearch.
    """

    @staticmethod
    def to_workflow_run(
        execution: WorkflowExecution,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        created_by_role: str,
        created_by: str,
    ) -> WorkflowRun:
        """
        Convert a WorkflowExecution domain entity to a WorkflowRun database model.
        
        Args:
            execution: The WorkflowExecution domain entity
            tenant_id: Tenant identifier
            app_id: Application identifier
            triggered_from: Source of the execution trigger
            created_by_role: Role of the user who created the execution
            created_by: ID of the user who created the execution
            
        Returns:
            WorkflowRun database model instance
        """
        # Map WorkflowExecutionStatus to string
        status_mapping = {
            WorkflowExecutionStatus.RUNNING: "running",
            WorkflowExecutionStatus.SUCCEEDED: "succeeded",
            WorkflowExecutionStatus.FAILED: "failed",
            WorkflowExecutionStatus.STOPPED: "stopped",
            WorkflowExecutionStatus.PARTIAL_SUCCEEDED: "partial-succeeded",
        }
        
        workflow_run = WorkflowRun()
        workflow_run.id = execution.id_
        workflow_run.tenant_id = tenant_id
        workflow_run.app_id = app_id
        workflow_run.workflow_id = execution.workflow_id
        workflow_run.type = execution.workflow_type.value
        workflow_run.triggered_from = triggered_from
        workflow_run.version = execution.workflow_version
        workflow_run.graph = json.dumps(execution.graph) if execution.graph else None
        workflow_run.inputs = json.dumps(execution.inputs) if execution.inputs else None
        workflow_run.status = status_mapping.get(execution.status, "running")
        workflow_run.outputs = json.dumps(execution.outputs) if execution.outputs else None
        workflow_run.error = execution.error_message
        workflow_run.elapsed_time = execution.elapsed_time
        workflow_run.total_tokens = execution.total_tokens
        workflow_run.total_steps = execution.total_steps
        workflow_run.created_by_role = created_by_role
        workflow_run.created_by = created_by
        workflow_run.created_at = execution.started_at
        workflow_run.finished_at = execution.finished_at
        workflow_run.exceptions_count = execution.exceptions_count
        
        return workflow_run

    @staticmethod
    def from_workflow_run(workflow_run: WorkflowRun) -> WorkflowExecution:
        """
        Convert a WorkflowRun database model to a WorkflowExecution domain entity.
        
        Args:
            workflow_run: The WorkflowRun database model
            
        Returns:
            WorkflowExecution domain entity
        """
        from core.workflow.enums import WorkflowType
        
        # Map string status to WorkflowExecutionStatus
        status_mapping = {
            "running": WorkflowExecutionStatus.RUNNING,
            "succeeded": WorkflowExecutionStatus.SUCCEEDED,
            "failed": WorkflowExecutionStatus.FAILED,
            "stopped": WorkflowExecutionStatus.STOPPED,
            "partial-succeeded": WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
        }
        
        execution = WorkflowExecution(
            id_=workflow_run.id,
            workflow_id=workflow_run.workflow_id,
            workflow_version=workflow_run.version,
            workflow_type=WorkflowType(workflow_run.type),
            graph=workflow_run.graph_dict,
            inputs=workflow_run.inputs_dict,
            outputs=workflow_run.outputs_dict,
            status=status_mapping.get(workflow_run.status, WorkflowExecutionStatus.RUNNING),
            error_message=workflow_run.error or "",
            total_tokens=workflow_run.total_tokens,
            total_steps=workflow_run.total_steps,
            exceptions_count=workflow_run.exceptions_count,
            started_at=workflow_run.created_at,
            finished_at=workflow_run.finished_at,
        )
        
        return execution
