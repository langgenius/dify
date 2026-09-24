"""Read workflow node executions without constructing upload or creator dependencies."""

import json
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import Any, override

from sqlalchemy import UnaryExpression, asc, desc, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.factory import OrderConfig, WorkflowNodeExecutionQuery
from extensions.ext_storage import storage
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from models.enums import ExecutionOffLoadType
from models.model import UploadFile
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, WorkflowNodeExecutionTriggeredFrom


class SQLAlchemyWorkflowNodeExecutionQueryRepository(WorkflowNodeExecutionQuery):
    """Materialize owned rows before reading offloaded data from storage."""

    def __init__(
        self,
        session_factory: sessionmaker[Session] | Engine,
        tenant_id: str,
        app_id: str | None,
    ) -> None:
        match session_factory:
            case Engine():
                self._session_factory = sessionmaker(bind=session_factory, expire_on_commit=False)
            case sessionmaker():
                self._session_factory = session_factory
            case _:
                raise ValueError(
                    f"Invalid session_factory type {type(session_factory).__name__}; expected sessionmaker or Engine"
                )
        if not tenant_id:
            raise ValueError("tenant_id is required")
        self._tenant_id = tenant_id
        self._app_id = app_id

    def get_db_models_by_workflow_run(
        self,
        workflow_run_id: str,
        order_config: OrderConfig | None = None,
        triggered_from: WorkflowNodeExecutionTriggeredFrom = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    ) -> Sequence[WorkflowNodeExecutionModel]:
        """
        Retrieve all WorkflowNodeExecution database models for a specific workflow run.

        The returned models have `offload_data` preloaded, along with the associated
        `inputs_file` and `outputs_file` data.

        This method directly returns database models without converting to domain models,
        which is useful when you need to access database-specific fields like triggered_from.

        Args:
            workflow_run_id: The workflow run ID
            order_config: Optional configuration for ordering results
                order_config.order_by: List of fields to order by (e.g., ["index", "created_at"])
                order_config.order_direction: Direction to order ("asc" or "desc")

        Returns:
            A list of WorkflowNodeExecution database models
        """
        with self._session_factory() as session:
            stmt = WorkflowNodeExecutionModel.preload_offload_data_and_files(select(WorkflowNodeExecutionModel))
            stmt = stmt.where(
                WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id,
                WorkflowNodeExecutionModel.tenant_id == self._tenant_id,
                WorkflowNodeExecutionModel.triggered_from == triggered_from,
                WorkflowNodeExecutionModel.status != WorkflowNodeExecutionStatus.PAUSED,
            )

            if self._app_id:
                stmt = stmt.where(WorkflowNodeExecutionModel.app_id == self._app_id)

            # Apply ordering if provided
            if order_config and order_config.order_by:
                order_columns: list[UnaryExpression] = []
                for field in order_config.order_by:
                    column = WorkflowNodeExecutionModel.__table__.c.get(field)
                    if column is None:
                        continue
                    if order_config.order_direction == "desc":
                        order_columns.append(desc(column))
                    else:
                        order_columns.append(asc(column))

                if order_columns:
                    stmt = stmt.order_by(*order_columns)

            db_models = session.scalars(stmt).all()

            return db_models

    @override
    def get_by_workflow_execution(
        self,
        workflow_execution_id: str,
        order_config: OrderConfig | None = None,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all node executions for a workflow execution.

        Database sessions close before offloaded fields are read from storage.

        Args:
            workflow_execution_id: The workflow execution identifier
            order_config: Optional configuration for ordering results
                order_config.order_by: List of fields to order by (e.g., ["index", "created_at"])
                order_config.order_direction: Direction to order ("asc" or "desc")

        Returns:
            A list of node execution instances
        """
        db_models = self.get_db_models_by_workflow_run(workflow_execution_id, order_config)

        with ThreadPoolExecutor(max_workers=10) as executor:
            domain_models = executor.map(self._to_domain_model, db_models, timeout=30)

        return list(domain_models)

    def _to_domain_model(self, db_model: WorkflowNodeExecutionModel) -> WorkflowNodeExecution:
        """
        Convert a database model to a domain model.

        This requires the offload_data, and correspond inputs_file and outputs_file are preloaded.

        Args:
            db_model: The database model to convert. It must have `offload_data`
                  and the corresponding `inputs_file` and `outputs_file` preloaded.

        Returns:
            The domain model
        """
        # Parse JSON fields - these might be truncated versions
        inputs = db_model.inputs_dict
        process_data = db_model.process_data_dict
        outputs = db_model.outputs_dict
        metadata = {WorkflowNodeExecutionMetadataKey(k): v for k, v in db_model.execution_metadata_dict.items()}

        # Convert status to domain enum
        status = WorkflowNodeExecutionStatus(db_model.status)

        domain_model = WorkflowNodeExecution(
            id=db_model.id,
            node_execution_id=db_model.node_execution_id,
            workflow_id=db_model.workflow_id,
            workflow_execution_id=db_model.workflow_run_id,
            index=db_model.index,
            predecessor_node_id=db_model.predecessor_node_id,
            node_id=db_model.node_id,
            node_type=db_model.node_type,
            title=db_model.title,
            inputs=inputs,
            process_data=process_data,
            outputs=outputs,
            status=status,
            error=db_model.error,
            elapsed_time=db_model.elapsed_time,
            metadata=metadata,
            created_at=db_model.created_at,
            finished_at=db_model.finished_at,
        )

        if not db_model.offload_data:
            return domain_model

        offload_data = db_model.offload_data
        # Store truncated versions for API responses
        # TODO: consider load content concurrently.

        input_offload = _find_first(offload_data, _filter_by_offload_type(ExecutionOffLoadType.INPUTS))
        if input_offload is not None:
            assert input_offload.file is not None
            domain_model.inputs = self._load_file(input_offload.file)
            domain_model.set_truncated_inputs(inputs)

        outputs_offload = _find_first(offload_data, _filter_by_offload_type(ExecutionOffLoadType.OUTPUTS))
        if outputs_offload is not None:
            assert outputs_offload.file is not None
            domain_model.outputs = self._load_file(outputs_offload.file)
            domain_model.set_truncated_outputs(outputs)

        process_data_offload = _find_first(offload_data, _filter_by_offload_type(ExecutionOffLoadType.PROCESS_DATA))
        if process_data_offload is not None:
            assert process_data_offload.file is not None
            domain_model.process_data = self._load_file(process_data_offload.file)
            domain_model.set_truncated_process_data(process_data)

        return domain_model

    def _load_file(self, file: UploadFile) -> Mapping[str, Any]:
        content = storage.load(file.key)
        return json.loads(content)


def _find_first[T](seq: Sequence[T], pred: Callable[[T], bool]) -> T | None:
    filtered = [i for i in seq if pred(i)]
    if filtered:
        return filtered[0]
    return None


def _filter_by_offload_type(offload_type: ExecutionOffLoadType) -> Callable[[WorkflowNodeExecutionOffload], bool]:
    def f(offload: WorkflowNodeExecutionOffload) -> bool:
        return offload.type_ == offload_type

    return f
