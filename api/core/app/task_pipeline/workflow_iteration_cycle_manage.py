import json
import time
from typing import Optional, Union

from core.app.entities.queue_entities import (
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
)
from core.app.entities.task_entities import (
    IterationNodeCompletedStreamResponse,
    IterationNodeNextStreamResponse,
    IterationNodeStartStreamResponse,
    NodeExecutionInfo,
)
from core.app.task_pipeline.workflow_cycle_state_manager import WorkflowCycleStateManager
from core.workflow.entities.node_entities import NodeType
from extensions.ext_database import db
from models.workflow import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
)


class WorkflowIterationCycleManage(WorkflowCycleStateManager):
    def _handle_iteration_to_stream_response(self, task_id: str, event: QueueIterationStartEvent | QueueIterationNextEvent | QueueIterationCompletedEvent) \
    -> Union[IterationNodeStartStreamResponse, IterationNodeNextStreamResponse, IterationNodeCompletedStreamResponse]:
        """
        Handle iteration to stream response
        :param task_id: task id
        :param event: iteration event
        :return:
        """
        if isinstance(event, QueueIterationStartEvent):
            return IterationNodeStartStreamResponse(
                task_id=task_id,
                workflow_run_id=self._task_state.workflow_run_id,
                data=IterationNodeStartStreamResponse.Data(
                    id=event.node_id,
                    node_id=event.node_id,
                    created_at=int(time.time()),
                    extras={}
                )
            )
        elif isinstance(event, QueueIterationNextEvent):
            return IterationNodeNextStreamResponse(
                task_id=task_id,
                workflow_run_id=self._task_state.workflow_run_id,
                data=IterationNodeNextStreamResponse.Data(
                    id=event.node_id,
                    node_id=event.node_id,
                    index=event.index,
                    output=event.output,
                    created_at=int(time.time()),
                    extras={}
                )
            )
        elif isinstance(event, QueueIterationCompletedEvent):
            return IterationNodeCompletedStreamResponse(
                task_id=task_id,
                workflow_run_id=self._task_state.workflow_run_id,
                data=IterationNodeCompletedStreamResponse.Data(
                    id=event.node_id,
                    node_id=event.node_id,
                    outputs=event.outputs,
                    created_at=int(time.time()),
                    extras={}
                )
            )
        
    def _init_iteration_execution_from_workflow_run(self, 
        workflow_run: WorkflowRun,
        node_id: str,
        node_type: NodeType,
        node_title: str,
        node_run_index: int = 1,
        predecessor_node_id: Optional[str] = None
    ) -> WorkflowNodeExecution:
        workflow_node_execution = WorkflowNodeExecution(
            tenant_id=workflow_run.tenant_id,
            app_id=workflow_run.app_id,
            workflow_id=workflow_run.workflow_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            workflow_run_id=workflow_run.id,
            predecessor_node_id=predecessor_node_id,
            index=node_run_index,
            node_id=node_id,
            node_type=node_type.value,
            title=node_title,
            status=WorkflowNodeExecutionStatus.RUNNING.value,
            created_by_role=workflow_run.created_by_role,
            created_by=workflow_run.created_by,
            execution_metadata=json.dumps({
            })
        )

        db.session.add(workflow_node_execution)
        db.session.commit()
        db.session.refresh(workflow_node_execution)
        db.session.close()

        return workflow_node_execution
    
    def _handle_iteration_operation(self, event: QueueIterationStartEvent | QueueIterationNextEvent | QueueIterationCompletedEvent) -> WorkflowNodeExecution:
        if isinstance(event, QueueIterationStartEvent):
            return self._handle_iteration_started(event)
        elif isinstance(event, QueueIterationNextEvent):
            return self._handle_iteration_next(event)
        elif isinstance(event, QueueIterationCompletedEvent):
            return self._handle_iteration_completed(event)
    
    def _handle_iteration_started(self, event: QueueIterationStartEvent) -> WorkflowNodeExecution:
        workflow_run = db.session.query(WorkflowRun).filter(WorkflowRun.id == self._task_state.workflow_run_id).first()
        workflow_node_execution = self._init_iteration_execution_from_workflow_run(
            workflow_run=workflow_run,
            node_id=event.node_id,
            node_type=NodeType.ITERATION,
            node_title=event.node_id,
            node_run_index=event.node_run_index,
            predecessor_node_id=event.predecessor_node_id
        )

        latest_node_execution_info = NodeExecutionInfo(
            workflow_node_execution_id=workflow_node_execution.id,
            node_type=NodeType.ITERATION,
            start_at=time.perf_counter()
        )

        self._task_state.ran_node_execution_infos[event.node_id] = latest_node_execution_info
        self._task_state.latest_node_execution_info = latest_node_execution_info

        db.session.close()

        return workflow_node_execution
    
    def _handle_iteration_next(self, event: QueueIterationNextEvent) -> WorkflowNodeExecution:
        pass

    def _handle_iteration_completed(self, event: QueueIterationCompletedEvent) -> WorkflowNodeExecution:
        pass