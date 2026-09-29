"""
SQLAlchemy implementation of the WorkflowNodeExecutionRepository.
"""

import dataclasses
import json
import logging
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, override

from sqlalchemy import UnaryExpression, asc, desc, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.app.workflow.persistence_ports import OrderConfig, WorkflowNodeExecutionRepository
from core.workflow.node_execution_process_data import preserve_workflow_agent_binding_id
from extensions.ext_storage import storage
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.workflow_type_encoder import WorkflowRuntimeTypeConverter
from libs.uuid_utils import uuidv7
from models import (
    Account,
    CreatorUserRole,
    EndUser,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
)
from models.enums import ExecutionOffLoadType
from models.model import UploadFile
from models.workflow import WorkflowNodeExecutionOffload
from repositories.workflow.offload import WorkflowOffloadUploader
from services.variable_truncator import VariableTruncator

logger = logging.getLogger(__name__)


@dataclasses.dataclass(frozen=True)
class _InputsOutputsTruncationResult:
    truncated_value: Mapping[str, Any]
    file: UploadFile
    offload: WorkflowNodeExecutionOffload


class SQLAlchemyWorkflowNodeExecutionRepository(WorkflowNodeExecutionRepository):
    """
    SQLAlchemy implementation of the WorkflowNodeExecutionRepository interface.

    This implementation supports multi-tenancy by filtering operations based on tenant_id.
    Each method creates its own session, handles the transaction, and commits changes
    to the database. This prevents long-running connections in the workflow core.
    """

    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        tenant_id: str,
        user: Account | EndUser,
        app_id: str | None,
        triggered_from: WorkflowNodeExecutionTriggeredFrom | None,
        *,
        upload_file: WorkflowOffloadUploader,
    ):
        """
        Initialize the repository with a SQLAlchemy sessionmaker or engine and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for creating sessions
            tenant_id: Tenant that owns the workflow node execution
            user: Account or EndUser used for creator attribution
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (SINGLE_STEP or WORKFLOW_RUN)
        """
        # If an engine is provided, create a sessionmaker from it
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
        self._upload_file = upload_file

        # Store app context
        self._app_id = app_id

        # Extract user context
        self._triggered_from = triggered_from
        self._creator_user_id = user.id

        # Determine user role based on user type
        self._creator_user_role = CreatorUserRole.ACCOUNT if isinstance(user, Account) else CreatorUserRole.END_USER

    def _create_truncator(self) -> VariableTruncator:
        return VariableTruncator(
            max_size_bytes=dify_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE,
            array_element_limit=dify_config.WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH,
            string_length_limit=dify_config.WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH,
        )

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
            created_at=datetime.fromisoformat(db_model.execution_attempt_version)
            if db_model.execution_attempt_version is not None
            else db_model.created_at,
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

    @staticmethod
    def _json_encode(values: Mapping[str, Any]) -> str:
        json_converter = WorkflowRuntimeTypeConverter()
        return json.dumps(json_converter.to_json_encodable(values))

    def _to_db_model(self, domain_model: WorkflowNodeExecution) -> WorkflowNodeExecutionModel:
        """
        Convert a domain model to a database model. This copies the inputs /
        process_data / outputs from domain model directly without applying truncation.

        Args:
            domain_model: The domain model to convert

        Returns:
            The database model, without setting inputs, process_data and outputs fields.
        """
        # Use values from constructor if provided
        if not self._triggered_from:
            raise ValueError("triggered_from is required in repository constructor")
        if not self._creator_user_id:
            raise ValueError("created_by is required in repository constructor")
        if not self._creator_user_role:
            raise ValueError("created_by_role is required in repository constructor")

        converter = WorkflowRuntimeTypeConverter()

        # json_converter = WorkflowRuntimeTypeConverter()
        db_model = WorkflowNodeExecutionModel()
        db_model.id = domain_model.id
        db_model.tenant_id = self._tenant_id
        if self._app_id is not None:
            db_model.app_id = self._app_id
        db_model.workflow_id = domain_model.workflow_id
        db_model.triggered_from = self._triggered_from
        db_model.workflow_run_id = domain_model.workflow_execution_id
        db_model.index = domain_model.index
        db_model.predecessor_node_id = domain_model.predecessor_node_id
        db_model.node_execution_id = domain_model.node_execution_id
        db_model.node_id = domain_model.node_id
        db_model.node_type = domain_model.node_type
        db_model.title = domain_model.title
        db_model.inputs = (
            _deterministic_json_dump(converter.to_json_encodable(domain_model.inputs))
            if domain_model.inputs is not None
            else None
        )
        db_model.process_data = (
            _deterministic_json_dump(converter.to_json_encodable(domain_model.process_data))
            if domain_model.process_data is not None
            else None
        )
        db_model.outputs = (
            _deterministic_json_dump(converter.to_json_encodable(domain_model.outputs))
            if domain_model.outputs is not None
            else None
        )
        # inputs, process_data and outputs are handled below
        db_model.status = domain_model.status
        db_model.error = domain_model.error
        db_model.elapsed_time = domain_model.elapsed_time
        db_model.execution_metadata = (
            json.dumps(jsonable_encoder(domain_model.metadata)) if domain_model.metadata else None
        )
        db_model.set_execution_attempt(domain_model.created_at)
        db_model.created_at = domain_model.created_at
        db_model.created_by_role = self._creator_user_role
        db_model.created_by = self._creator_user_id
        db_model.finished_at = domain_model.finished_at

        return db_model

    def _truncate_and_upload(
        self,
        values: Mapping[str, Any] | None,
        execution_id: str,
        type_: ExecutionOffLoadType,
    ) -> _InputsOutputsTruncationResult | None:
        if values is None:
            return None

        converter = WorkflowRuntimeTypeConverter()
        json_encodable_value = converter.to_json_encodable(values)
        truncator = self._create_truncator()
        truncated_values, truncated = truncator.truncate_variable_mapping(json_encodable_value)
        if not truncated:
            return None

        value_json = _deterministic_json_dump(json_encodable_value)
        assert value_json is not None, "value_json should be not None here."

        suffix = type_.value
        upload_file = self._upload_file(
            filename=f"node_execution_{execution_id}_{suffix}.json",
            content=value_json.encode("utf-8"),
        )
        assert self._app_id
        offload = WorkflowNodeExecutionOffload(
            tenant_id=self._tenant_id,
            app_id=self._app_id,
            node_execution_id=execution_id,
            type_=type_,
            file_id=upload_file.id,
        )
        offload.id = str(uuidv7())
        return _InputsOutputsTruncationResult(
            truncated_value=truncated_values,
            file=upload_file,
            offload=offload,
        )

    @override
    def save(self, execution: WorkflowNodeExecution) -> None:
        """Persist a node snapshot under its stable execution ID.

        Concurrent inserts converge on the same owner-checked row. Payload
        truncation and offloading are handled separately by save_execution_data.
        """
        # NOTE: The workflow engine triggers `save` multiple times for a single node execution:
        # when the node starts, any time it retries, and once more when it reaches a terminal state.
        # Only the final call contains the complete inputs and outputs payloads, so earlier invocations
        # must tolerate missing data without attempting to offload variables.

        # Convert domain model to database model using tenant context and other attributes
        db_model = self._to_db_model(execution)

        try:
            self._persist_to_database(db_model)
        except IntegrityError:
            # A queued writer may insert after our initial read. Roll back that
            # transaction, then lock and update the same execution in a fresh
            # session. IDs are shared with queued messages and offload records.
            with self._session_factory() as session, session.begin():
                existing = session.scalar(
                    select(WorkflowNodeExecutionModel)
                    .where(WorkflowNodeExecutionModel.id == db_model.id)
                    .with_for_update()
                )
                if existing is None:
                    raise
                self._update_existing(existing, db_model)

    @override
    def save_synchronously(self, execution: WorkflowNodeExecution) -> None:
        """Persist a caller row before an Agent v2 participant is materialized."""

        self.save(execution)

    def _persist_to_database(self, db_model: WorkflowNodeExecutionModel):
        """
        Persist the database model to the database.

        Checks if a record with the same ID exists and either updates it or creates a new one.

        Args:
            db_model: The database model to persist
        """
        with self._session_factory() as session:
            # Check if record already exists
            existing = session.scalar(
                select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id == db_model.id).with_for_update()
            )

            if existing:
                self._update_existing(existing, db_model)
            else:
                # Add new record
                session.add(db_model)

            session.commit()

    def _update_existing(self, existing: WorkflowNodeExecutionModel, incoming: WorkflowNodeExecutionModel) -> None:
        self._validate_owner(existing, incoming.workflow_id, incoming.workflow_run_id)
        process_data = preserve_workflow_agent_binding_id(existing.process_data_dict, incoming.process_data_dict)
        incoming.process_data = _deterministic_json_dump(process_data) if process_data is not None else None
        for key, value in incoming.__dict__.items():
            if not key.startswith("_"):
                setattr(existing, key, value)

    def _validate_owner(self, stored: WorkflowNodeExecutionModel, workflow_id: str, run_id: str | None) -> None:
        if (
            stored.tenant_id != self._tenant_id
            or (self._app_id is not None and stored.app_id != self._app_id)
            or stored.workflow_id != workflow_id
            or stored.workflow_run_id != run_id
        ):
            raise ValueError("Unauthorized access to workflow node execution")

    @override
    def save_execution_data(self, execution: WorkflowNodeExecution):
        domain_model = execution
        with self._session_factory(expire_on_commit=False) as session:
            query = WorkflowNodeExecutionModel.preload_offload_data(select(WorkflowNodeExecutionModel)).where(
                WorkflowNodeExecutionModel.id == domain_model.id
            )
            db_model: WorkflowNodeExecutionModel | None = session.execute(query).scalars().first()

        if db_model is not None:
            self._validate_owner(db_model, domain_model.workflow_id, domain_model.workflow_execution_id)
            original_offloads = {item.type_: item.id for item in db_model.offload_data}
        else:
            db_model = self._to_db_model(domain_model)
            original_offloads = {}

        original_data = {type_: getattr(db_model, f"{type_.value}_dict") for type_ in ExecutionOffLoadType}
        prepared: dict[ExecutionOffLoadType, _InputsOutputsTruncationResult | None] = {}

        if domain_model.inputs is not None:
            result = self._truncate_and_upload(
                domain_model.inputs,
                domain_model.id,
                ExecutionOffLoadType.INPUTS,
            )
            if result is not None:
                db_model.inputs = self._json_encode(result.truncated_value)
                domain_model.set_truncated_inputs(result.truncated_value)
            else:
                db_model.inputs = self._json_encode(domain_model.inputs)
            prepared[ExecutionOffLoadType.INPUTS] = result

        if domain_model.outputs is not None:
            result = self._truncate_and_upload(
                domain_model.outputs,
                domain_model.id,
                ExecutionOffLoadType.OUTPUTS,
            )
            if result is not None:
                db_model.outputs = self._json_encode(result.truncated_value)
                domain_model.set_truncated_outputs(result.truncated_value)
            else:
                db_model.outputs = self._json_encode(domain_model.outputs)
            prepared[ExecutionOffLoadType.OUTPUTS] = result

        process_data = preserve_workflow_agent_binding_id(db_model.process_data_dict, domain_model.process_data)
        if process_data is not None:
            result = self._truncate_and_upload(
                process_data,
                domain_model.id,
                ExecutionOffLoadType.PROCESS_DATA,
            )
            if result is not None:
                truncated_process_data = preserve_workflow_agent_binding_id(
                    process_data,
                    result.truncated_value,
                )
                if truncated_process_data is None:
                    raise ValueError("truncated process data is unavailable")
                db_model.process_data = self._json_encode(truncated_process_data)
                domain_model.set_truncated_process_data(truncated_process_data)
            else:
                db_model.process_data = self._json_encode(process_data)
            prepared[ExecutionOffLoadType.PROCESS_DATA] = result

        with self._session_factory() as session, session.begin():
            current = session.scalar(
                WorkflowNodeExecutionModel.preload_offload_data(select(WorkflowNodeExecutionModel))
                .where(WorkflowNodeExecutionModel.id == db_model.id)
                .with_for_update()
            )
            if current is not None:
                self._validate_owner(current, domain_model.workflow_id, domain_model.workflow_execution_id)
            else:
                current = self._to_db_model(domain_model)
                current.offload_data = []
                session.add(current)
            for type_, result in prepared.items():
                field = type_.value
                # Uploads run outside the transaction. Do not overwrite a newer
                # payload written while storage I/O was in progress.
                current_offload = next((item.id for item in current.offload_data if item.type_ == type_), None)
                if getattr(current, f"{field}_dict") != original_data[
                    type_
                ] or current_offload != original_offloads.get(type_):
                    continue
                setattr(current, field, getattr(db_model, field))
                # Keep unrelated data and the latest execution state. Merging
                # the detached row would also restore its stale status/metadata.
                current.offload_data = [item for item in current.offload_data if item.type_ != type_]
                session.flush()  # Unlink the old offload before reusing its unique slot.
                if result is not None:
                    current.offload_data.append(result.offload)

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
                    column = getattr(WorkflowNodeExecutionModel, field, None)
                    if not column:
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
        triggered_from: WorkflowNodeExecutionTriggeredFrom = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all node executions for a workflow execution.

        This method always queries the database to ensure complete and ordered results.

        Args:
            workflow_execution_id: The workflow execution identifier
            order_config: Optional configuration for ordering results
                order_config.order_by: List of fields to order by (e.g., ["index", "created_at"])
                order_config.order_direction: Direction to order ("asc" or "desc")

        Returns:
            A list of node execution instances
        """
        db_models = self.get_db_models_by_workflow_run(workflow_execution_id, order_config, triggered_from)

        with ThreadPoolExecutor(max_workers=10) as executor:
            domain_models = executor.map(self._to_domain_model, db_models, timeout=30)

        return list(domain_models)


def _deterministic_json_dump(value: Mapping[str, Any]) -> str:
    return json.dumps(value, sort_keys=True)


def _find_first[T](seq: Sequence[T], pred: Callable[[T], bool]) -> T | None:
    filtered = [i for i in seq if pred(i)]
    if filtered:
        return filtered[0]
    return None


def _filter_by_offload_type(offload_type: ExecutionOffLoadType) -> Callable[[WorkflowNodeExecutionOffload], bool]:
    def f(offload: WorkflowNodeExecutionOffload) -> bool:
        return offload.type_ == offload_type

    return f
