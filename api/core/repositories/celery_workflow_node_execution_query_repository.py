"""Read pending Celery executions over persisted SQL history."""

import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from operator import attrgetter
from typing import override

from core.repositories.factory import OrderConfig, WorkflowNodeExecutionQuery
from graphon.entities import WorkflowNodeExecution

logger = logging.getLogger(__name__)


@dataclass
class CeleryWorkflowNodeExecutionCache:
    """Per-run state shared by the Celery writer and its reader."""

    executions: dict[str, WorkflowNodeExecution] = field(default_factory=dict)
    workflow_execution_mapping: dict[str, list[str]] = field(default_factory=dict)
    database_loaded_workflow_executions: set[str] = field(default_factory=set)


class CeleryWorkflowNodeExecutionQueryRepository(WorkflowNodeExecutionQuery):
    def __init__(self, *, query: WorkflowNodeExecutionQuery, cache: CeleryWorkflowNodeExecutionCache) -> None:
        self._query = query
        self._cache = cache

    @override
    def get_by_workflow_execution(
        self,
        workflow_execution_id: str,
        order_config: OrderConfig | None = None,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve workflow node executions from cache after loading persisted history once.

        Args:
            workflow_execution_id: The workflow execution identifier
            order_config: Optional configuration for ordering results

        Returns:
            A sequence of WorkflowNodeExecution instances
        """
        try:
            if workflow_execution_id not in self._cache.database_loaded_workflow_executions:
                try:
                    persisted_executions = self._query.get_by_workflow_execution(
                        workflow_execution_id,
                        order_config,
                    )
                except Exception:
                    logger.exception(
                        "Failed to load persisted workflow node executions for execution %s",
                        workflow_execution_id,
                    )
                else:
                    execution_ids = self._cache.workflow_execution_mapping.setdefault(workflow_execution_id, [])
                    for execution in persisted_executions:
                        self._cache.executions.setdefault(execution.id, execution)
                        if execution.id not in execution_ids:
                            execution_ids.append(execution.id)
                    self._cache.database_loaded_workflow_executions.add(workflow_execution_id)

            # Get execution IDs for this workflow execution from cache
            execution_ids = self._cache.workflow_execution_mapping.get(workflow_execution_id, [])

            # Retrieve executions from cache
            result = []
            for execution_id in execution_ids:
                if execution_id in self._cache.executions:
                    result.append(self._cache.executions[execution_id])

            # Apply ordering if specified
            if order_config and result:
                # Sort based on the order configuration
                reverse = order_config.order_direction == "desc"

                # Sort by multiple fields if specified
                for field_name in reversed(order_config.order_by):
                    if field_name in WorkflowNodeExecution.model_fields:
                        result.sort(key=attrgetter(field_name), reverse=reverse)

            logger.debug(
                "Retrieved %d workflow node executions for execution %s from cache",
                len(result),
                workflow_execution_id,
            )
            return result

        except Exception:
            logger.exception(
                "Failed to get workflow node executions for execution %s from cache",
                workflow_execution_id,
            )
            return []
