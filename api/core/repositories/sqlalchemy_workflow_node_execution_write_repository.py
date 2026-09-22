"""
SQLAlchemy persistence for workflow node executions.
"""

import dataclasses
import json
import logging
from collections.abc import Mapping
from typing import Any, override

import psycopg2.errors
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from tenacity import before_sleep_log, retry, retry_if_exception, stop_after_attempt

from configs import dify_config
from core.repositories.factory import WorkflowNodeExecutionWriter
from core.workflow.node_execution_process_data import preserve_workflow_agent_binding_id
from graphon.entities import WorkflowNodeExecution
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
from models.workflow import WorkflowNodeExecutionOffload
from services.file_upload_service import FileUploadActor, FileUploadService
from services.variable_truncator import VariableTruncator

logger = logging.getLogger(__name__)


@dataclasses.dataclass(frozen=True)
class _InputsOutputsTruncationResult:
    truncated_value: Mapping[str, Any]
    offload: WorkflowNodeExecutionOffload


class SQLAlchemyWorkflowNodeExecutionWriteRepository(WorkflowNodeExecutionWriter):
    """
    SQLAlchemy implementation of the WorkflowNodeExecutionWriter interface.

    This implementation supports multi-tenancy by filtering operations based on tenant_id.
    Each method creates its own session, handles the transaction, and commits changes
    to the database. This prevents long-running connections in the workflow core.
    """

    def __init__(
        self,
        session_factory: sessionmaker[Session] | Engine,
        tenant_id: str,
        user: Account | EndUser,
        app_id: str | None,
        triggered_from: WorkflowNodeExecutionTriggeredFrom | None,
        *,
        file_uploads: FileUploadService,
    ) -> None:
        """
        Initialize the repository with a SQLAlchemy sessionmaker or engine and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for creating sessions
            tenant_id: Tenant that owns the workflow node execution
            user: Account or EndUser used for creator attribution
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (SINGLE_STEP or WORKFLOW_RUN)
            file_uploads: Upload service bound to the same database as this repository
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

        # Store app context
        self._app_id = app_id

        # Extract user context
        self._triggered_from = triggered_from
        self._creator_user_id = user.id

        # Determine user role based on user type
        self._creator_user_role = CreatorUserRole.ACCOUNT if isinstance(user, Account) else CreatorUserRole.END_USER

        self._file_uploads = file_uploads

    def _create_truncator(self) -> VariableTruncator:
        return VariableTruncator(
            max_size_bytes=dify_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE,
            array_element_limit=dify_config.WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH,
            string_length_limit=dify_config.WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH,
        )

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
        db_model.created_at = domain_model.created_at
        db_model.created_by_role = self._creator_user_role
        db_model.created_by = self._creator_user_id
        db_model.finished_at = domain_model.finished_at

        return db_model

    def _is_duplicate_key_error(self, exception: BaseException) -> bool:
        """Check if the exception is a duplicate key constraint violation."""
        return isinstance(exception, IntegrityError) and isinstance(exception.orig, psycopg2.errors.UniqueViolation)

    def _regenerate_id_on_duplicate(
        self, execution: WorkflowNodeExecution, db_model: WorkflowNodeExecutionModel
    ) -> None:
        """Regenerate UUID v7 for both domain and database models when duplicate key detected."""
        new_id = str(uuidv7())
        logger.warning(
            "Duplicate key conflict for workflow node execution ID %s, generating new UUID v7: %s", db_model.id, new_id
        )
        db_model.id = new_id
        execution.id = new_id

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
        upload_file = self._file_uploads.upload_file_for_actor(
            filename=f"node_execution_{execution_id}_{suffix}.json",
            content=value_json.encode("utf-8"),
            mimetype="application/json",
            actor=FileUploadActor(id=self._creator_user_id, creator_role=self._creator_user_role),
            resource_tenant_id=self._tenant_id,
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
            offload=offload,
        )

    @override
    def save(self, execution: WorkflowNodeExecution) -> None:
        """
        Save or update a NodeExecution domain entity to the database.

        This method serves as a domain-to-database adapter that:
        1. Converts the domain entity to its database representation
        2. Checks for existing records and updates or inserts accordingly
        3. Handles truncation and offloading of large inputs/outputs
        4. Persists the database model using SQLAlchemy's merge operation
        5. Maintains proper multi-tenancy by including tenant context during conversion

        The method handles both creating new records and updating existing ones through
        SQLAlchemy's merge operation.

        Args:
            execution: The NodeExecution domain entity to persist
        """
        # NOTE: The workflow engine triggers `save` multiple times for a single node execution:
        # when the node starts, any time it retries, and once more when it reaches a terminal state.
        # Only the final call contains the complete inputs and outputs payloads, so earlier invocations
        # must tolerate missing data without attempting to offload variables.

        # Convert domain model to database model using tenant context and other attributes
        db_model = self._to_db_model(execution)

        # Use tenacity for retry logic with duplicate key handling
        @retry(
            stop=stop_after_attempt(3),
            retry=retry_if_exception(self._is_duplicate_key_error),
            before_sleep=before_sleep_log(logger, logging.WARNING),
            reraise=True,
        )
        def _save_with_retry() -> None:
            try:
                self._persist_to_database(db_model)
            except IntegrityError as e:
                if self._is_duplicate_key_error(e):
                    # Generate new UUID and retry
                    self._regenerate_id_on_duplicate(execution, db_model)
                    raise  # Let tenacity handle the retry
                else:
                    # Different integrity error, don't retry
                    logger.exception("Non-duplicate key integrity error while saving workflow node execution")
                    raise

        try:
            _save_with_retry()

        except Exception:
            logger.exception("Failed to save workflow node execution after all retries")
            raise

    @override
    def save_synchronously(self, execution: WorkflowNodeExecution) -> None:
        """Persist a caller row before an Agent v2 participant is materialized."""

        self.save(execution)

    def _persist_to_database(self, db_model: WorkflowNodeExecutionModel) -> None:
        """
        Persist the database model to the database.

        Checks if a record with the same ID exists and either updates it or creates a new one.

        Args:
            db_model: The database model to persist
        """
        with self._session_factory() as session:
            # Check if record already exists
            existing = session.get(WorkflowNodeExecutionModel, db_model.id)

            if existing:
                merged_process_data = preserve_workflow_agent_binding_id(
                    existing.process_data_dict,
                    db_model.process_data_dict,
                )
                db_model.process_data = (
                    _deterministic_json_dump(merged_process_data) if merged_process_data is not None else None
                )
                # Update existing record by copying all non-private attributes
                for key, value in db_model.__dict__.items():
                    if not key.startswith("_"):
                        setattr(existing, key, value)
            else:
                # Add new record
                session.add(db_model)

            session.commit()

    @override
    def save_execution_data(self, execution: WorkflowNodeExecution) -> None:
        domain_model = execution
        with self._session_factory(expire_on_commit=False) as session:
            query = WorkflowNodeExecutionModel.preload_offload_data(select(WorkflowNodeExecutionModel)).where(
                WorkflowNodeExecutionModel.id == domain_model.id
            )
            db_model: WorkflowNodeExecutionModel | None = session.execute(query).scalars().first()

        if db_model is not None:
            offload_data = db_model.offload_data
        else:
            db_model = self._to_db_model(domain_model)
            offload_data = db_model.offload_data

        if domain_model.inputs is not None:
            result = self._truncate_and_upload(
                domain_model.inputs,
                domain_model.id,
                ExecutionOffLoadType.INPUTS,
            )
            if result is not None:
                db_model.inputs = self._json_encode(result.truncated_value)
                domain_model.set_truncated_inputs(result.truncated_value)
                offload_data = _replace_or_append_offload(offload_data, result.offload)
            else:
                db_model.inputs = self._json_encode(domain_model.inputs)

        if domain_model.outputs is not None:
            result = self._truncate_and_upload(
                domain_model.outputs,
                domain_model.id,
                ExecutionOffLoadType.OUTPUTS,
            )
            if result is not None:
                db_model.outputs = self._json_encode(result.truncated_value)
                domain_model.set_truncated_outputs(result.truncated_value)
                offload_data = _replace_or_append_offload(offload_data, result.offload)
            else:
                db_model.outputs = self._json_encode(domain_model.outputs)

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
                offload_data = _replace_or_append_offload(offload_data, result.offload)
            else:
                db_model.process_data = self._json_encode(process_data)

        db_model.offload_data = offload_data
        with self._session_factory() as session, session.begin():
            session.merge(db_model)
            session.flush()


def _deterministic_json_dump(value: Mapping[str, Any]) -> str:
    return json.dumps(value, sort_keys=True)


def _replace_or_append_offload(
    seq: list[WorkflowNodeExecutionOffload], elem: WorkflowNodeExecutionOffload
) -> list[WorkflowNodeExecutionOffload]:
    """Replace all elements in `seq` that satisfy the equality condition defined by `eq_func` with `elem`.

    Args:
        seq: The sequence of elements to process.
        elem: The new element to insert.
        eq_func: A function that determines equality between elements.

    Returns:
        A new sequence with the specified elements replaced or appended.
    """
    ls = [i for i in seq if i.type_ != elem.type_]
    ls.append(elem)
    return ls
