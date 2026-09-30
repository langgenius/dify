"""SQL transactions for workflow pause, resume, and persisted control state.

These records are required regardless of the configured execution log backend.
"""

import json
import logging
import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any, cast, override

from pydantic import ValidationError
from sqlalchemy import and_, null, or_, select
from sqlalchemy.orm import Session, load_only, selectinload, sessionmaker

from core.workflow.human_input_forms import load_form_tokens_by_form_id
from core.workflow.nodes.human_input.entities import FormDefinition
from core.workflow.nodes.human_input.pause_reason import (
    HumanInputRequired,
)
from core.workflow.nodes.human_input.pause_reason import (
    PauseReason as DifyPauseReason,
)
from core.workflow.nodes.human_input.session_binding import default_session_binding
from extensions.ext_storage import storage
from graphon.entities.pause_reason import (
    HitlRequired,
    PauseReasonType,
    SchedulingPause,
)
from graphon.entities.pause_reason import (
    PauseReason as GraphonPauseReason,
)
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.human_input import HumanInputForm, HumanInputFormRecipient
from models.workflow import WorkflowPause, WorkflowPauseReason, WorkflowRun
from services.workflow.run_entities import (
    WorkflowPauseEntity,
    WorkflowRunPauseRecord,
)

logger = logging.getLogger(__name__)
_HITL_REASON_TYPES = frozenset({PauseReasonType.LEGACY_HUMAN_INPUT_REQUIRED, PauseReasonType.HITL_REQUIRED})


class _WorkflowRunError(Exception):
    pass


def _build_human_input_required_reason(
    reason_model: WorkflowPauseReason,
    form_model: HumanInputForm | None,
    recipients: Sequence[HumanInputFormRecipient] = (),
) -> HumanInputRequired:
    form_content = ""
    inputs = []
    actions = []
    resolved_default_values: dict[str, Any] = {}
    node_title = "Human Input"
    form_id = reason_model.form_id
    node_id = reason_model.node_id
    if form_model is not None:
        form_id = form_model.id
        node_id = form_model.node_id or node_id
        try:
            definition_payload = json.loads(form_model.form_definition)
            if "expiration_time" not in definition_payload:
                definition_payload["expiration_time"] = form_model.expiration_time
            definition = FormDefinition.model_validate(definition_payload)
        except ValidationError:
            definition = None

        if definition is not None:
            form_content = form_model.rendered_content or definition.rendered_content or definition.form_content
            inputs = list(definition.inputs)
            actions = list(definition.user_actions)
            resolved_default_values = dict(definition.default_values)
            node_title = definition.node_title or node_title

    reason = HumanInputRequired(
        form_id=form_id,
        form_content=form_content,
        inputs=inputs,
        actions=actions,
        node_id=node_id,
        node_title=node_title,
        resolved_default_values=resolved_default_values,
    )
    return reason


def _to_dify_pause_reason(reason_model: WorkflowPauseReason) -> DifyPauseReason:
    """Map persisted pause reasons onto the Dify-facing repository contract."""
    if reason_model.type_ in _HITL_REASON_TYPES:
        return _build_human_input_required_reason(reason_model, None)
    return cast("DifyPauseReason", reason_model.to_entity())


class WorkflowPauseRepository:
    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def create_workflow_pause(
        self,
        workflow_run_id: str,
        state_owner_user_id: str,
        state: str,
        pause_reasons: Sequence[GraphonPauseReason | DifyPauseReason],
    ) -> WorkflowPauseEntity:
        """
        Create a new workflow pause state.

        Creates a pause state for a workflow run, storing the current execution
        state and marking the workflow as paused. This is used when a workflow
        needs to be suspended and later resumed.

        Args:
            workflow_run_id: Identifier of the workflow run to pause
            state_owner_user_id: User ID who owns the pause state for file storage
            state: Serialized workflow execution state (JSON string)

        Returns:
            RepositoryWorkflowPauseEntity representing the created pause state

        Raises:
            ValueError: If workflow_run_id is invalid or workflow run doesn't exist
            RuntimeError: If workflow is already paused or in invalid state
        """
        previous_pause_model_query = select(WorkflowPause).where(WorkflowPause.workflow_run_id == workflow_run_id)
        with self._session_maker() as session, session.begin():
            # Get the workflow run
            workflow_run = session.get(WorkflowRun, workflow_run_id)
            if workflow_run is None:
                raise ValueError(f"WorkflowRun not found: {workflow_run_id}")

            # Check if workflow is in RUNNING status
            # TODO(QuantumGhost): It seems that the persistence of `WorkflowRun.status`
            # happens before the execution of GraphLayer
            if workflow_run.status not in {WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.PAUSED}:
                raise _WorkflowRunError(
                    f"Only WorkflowRun with RUNNING or PAUSED status can be paused, "
                    f"workflow_run_id={workflow_run_id}, current_status={workflow_run.status}"
                )
            #
            previous_pause = session.scalars(previous_pause_model_query).first()
            if previous_pause:
                self._delete_pause_model(session, previous_pause)
                # we need to flush here to ensure that the old one is actually deleted.
                session.flush()

            state_obj_key = f"workflow-state-{uuid.uuid4()}.json"
            storage.save(state_obj_key, state.encode())
            # Upload the state file

            # Create the pause record
            pause_model = WorkflowPause(
                workflow_id=workflow_run.workflow_id,
                workflow_run_id=workflow_run.id,
                state_object_key=state_obj_key,
            )
            pause_reason_models = []
            for reason in pause_reasons:
                match reason:
                    case HitlRequired():
                        pause_reason_model = WorkflowPauseReason(
                            pause_id=pause_model.id,
                            type_=PauseReasonType.HITL_REQUIRED,
                            form_id=default_session_binding.resolve_form_id_from_session_id(
                                session_id=reason.session_id
                            ),
                            node_id=reason.node_id,
                        )
                    case HumanInputRequired():
                        pause_reason_model = WorkflowPauseReason(
                            pause_id=pause_model.id,
                            type_=PauseReasonType.HITL_REQUIRED,
                            form_id=reason.form_id,
                            node_id=reason.node_id,
                        )
                    case SchedulingPause():
                        pause_reason_model = WorkflowPauseReason(
                            pause_id=pause_model.id,
                            type_=reason.TYPE,
                            message=reason.message,
                        )
                    case _:
                        raise AssertionError(f"unknown reason type: {type(reason)}")

                pause_reason_models.append(pause_reason_model)

            # Update workflow run status
            workflow_run.status = WorkflowExecutionStatus.PAUSED

            # Save everything in a transaction
            session.add(pause_model)
            session.add(workflow_run)
            session.add_all(pause_reason_models)

            logger.info("Created workflow pause %s for workflow run %s", pause_model.id, workflow_run_id)

            # NOTE(QuantumGhost): repository callers on the Dify side should only
            # observe enriched Dify pause reasons. The Graphon-native reason is an
            # input-only boundary concern while persisting the pause.
            hydrated_pause_reasons = self._hydrate_pause_reasons(session, pause_reason_models)

            return _PrivateWorkflowPauseEntity(
                pause_model=pause_model,
                reason_models=pause_reason_models,
                pause_reasons=hydrated_pause_reasons,
            )

    def _get_reasons_by_pause_id(self, session: Session, pause_id: str):
        reason_stmt = select(WorkflowPauseReason).where(WorkflowPauseReason.pause_id == pause_id)
        pause_reason_models = session.scalars(reason_stmt).all()
        return pause_reason_models

    def _hydrate_pause_reasons(
        self,
        session: Session,
        pause_reason_models: Sequence[WorkflowPauseReason],
    ) -> list[DifyPauseReason]:
        form_ids = [
            reason.form_id for reason in pause_reason_models if reason.type_ in _HITL_REASON_TYPES and reason.form_id
        ]
        form_models: dict[str, HumanInputForm] = {}
        if form_ids:
            form_stmt = select(HumanInputForm).where(HumanInputForm.id.in_(form_ids))
            for form in session.scalars(form_stmt).all():
                form_models[form.id] = form
        recipients_by_form_id: dict[str, list[HumanInputFormRecipient]] = {}
        if form_ids:
            recipient_stmt = select(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id.in_(form_ids))
            for recipient in session.scalars(recipient_stmt).all():
                recipients_by_form_id.setdefault(recipient.form_id, []).append(recipient)

        pause_reasons: list[DifyPauseReason] = []
        for reason in pause_reason_models:
            if reason.type_ in _HITL_REASON_TYPES:
                form_model = form_models.get(reason.form_id)
                pause_reasons.append(
                    _build_human_input_required_reason(
                        reason,
                        form_model,
                        recipients_by_form_id.get(reason.form_id, ()),
                    )
                )
            else:
                pause_reasons.append(_to_dify_pause_reason(reason))
        return pause_reasons

    def get_workflow_pause(
        self,
        workflow_run_id: str,
    ) -> WorkflowPauseEntity | None:
        """
        Get an existing workflow pause state.

        Retrieves the pause state for a specific workflow run if it exists.
        Used to check if a workflow is paused and to retrieve its saved state.

        Args:
            workflow_run_id: Identifier of the workflow run to get pause state for

        Returns:
            RepositoryWorkflowPauseEntity if pause state exists, None otherwise

        Raises:
            ValueError: If workflow_run_id is invalid
        """
        with self._session_maker() as session:
            # Only the run's existence and pause relationship are needed here.
            # Snapshot reconnects already loaded its graph, inputs, and outputs.
            stmt = (
                select(WorkflowRun)
                .options(load_only(WorkflowRun.id, raiseload=True), selectinload(WorkflowRun.pause))
                .where(WorkflowRun.id == workflow_run_id)
            )
            workflow_run = session.scalar(stmt)

            if workflow_run is None:
                raise ValueError(f"WorkflowRun not found: {workflow_run_id}")

            pause_model = workflow_run.pause
            if pause_model is None:
                return None
            pause_reason_models = self._get_reasons_by_pause_id(session, pause_model.id)
            pause_reasons = self._hydrate_pause_reasons(session, pause_reason_models)

        return _PrivateWorkflowPauseEntity(
            pause_model=pause_model,
            reason_models=pause_reason_models,
            pause_reasons=pause_reasons,
        )

    def get_pause_record(
        self,
        *,
        workspace_id: str,
        workflow_run_id: str,
    ) -> WorkflowRunPauseRecord | None:
        stmt = (
            select(WorkflowRun)
            .options(selectinload(WorkflowRun.pause))
            .where(
                WorkflowRun.tenant_id == workspace_id,
                WorkflowRun.id == workflow_run_id,
            )
        )
        with self._session_maker() as session:
            workflow_run = session.scalar(stmt)
            if workflow_run is None:
                return None
            if workflow_run.status != WorkflowExecutionStatus.PAUSED:
                return WorkflowRunPauseRecord(
                    status=workflow_run.status,
                    paused_at=None,
                    reasons=(),
                    form_tokens={},
                )

            pause_model = workflow_run.pause
            if pause_model is None:
                reasons: tuple[DifyPauseReason, ...] = ()
            else:
                reason_models = self._get_reasons_by_pause_id(session, pause_model.id)
                reasons = tuple(self._hydrate_pause_reasons(session, reason_models))
            form_ids = [reason.form_id for reason in reasons if isinstance(reason, HumanInputRequired)]
            form_tokens = load_form_tokens_by_form_id(form_ids, session=session)

            return WorkflowRunPauseRecord(
                status=workflow_run.status,
                paused_at=pause_model.created_at if pause_model is not None else None,
                reasons=reasons,
                form_tokens=form_tokens,
            )

    def resume_workflow_pause(
        self,
        workflow_run_id: str,
        pause_entity: WorkflowPauseEntity,
    ) -> WorkflowPauseEntity:
        """
        Resume a paused workflow.

        Marks a paused workflow as resumed, clearing the pause state and
        returning the workflow to running status. Returns the pause entity
        that was resumed.

        Args:
            workflow_run_id: Identifier of the workflow run to resume
            pause_entity: The pause entity to resume

        Returns:
            RepositoryWorkflowPauseEntity representing the resumed pause state

        Raises:
            ValueError: If workflow_run_id is invalid
            RuntimeError: If workflow is not paused or already resumed
        """
        with self._session_maker() as session, session.begin():
            # Get the workflow run with pause
            stmt = select(WorkflowRun).options(selectinload(WorkflowRun.pause)).where(WorkflowRun.id == workflow_run_id)
            workflow_run = session.scalar(stmt)

            if workflow_run is None:
                raise ValueError(f"WorkflowRun not found: {workflow_run_id}")

            if workflow_run.status != WorkflowExecutionStatus.PAUSED:
                raise _WorkflowRunError(
                    f"WorkflowRun is not in PAUSED status, workflow_run_id={workflow_run_id}, "
                    f"current_status={workflow_run.status}"
                )
            pause_model = workflow_run.pause
            if pause_model is None:
                raise _WorkflowRunError(f"No pause state found for workflow run: {workflow_run_id}")

            if pause_model.id != pause_entity.id:
                raise _WorkflowRunError(
                    "different id in WorkflowPause and WorkflowPauseEntity, "
                    f"WorkflowPause.id={pause_model.id}, "
                    f"WorkflowPauseEntity.id={pause_entity.id}"
                )

            if pause_model.resumed_at is not None:
                raise _WorkflowRunError(f"Cannot resume an already resumed pause, pause_id={pause_model.id}")

            pause_reasons = self._get_reasons_by_pause_id(session, pause_model.id)
            hydrated_pause_reasons = self._hydrate_pause_reasons(session, pause_reasons)

            # Mark as resumed
            pause_model.resumed_at = naive_utc_now()
            workflow_run.status = WorkflowExecutionStatus.RUNNING

            session.add(pause_model)
            session.add(workflow_run)

            logger.info("Resumed workflow pause %s for workflow run %s", pause_model.id, workflow_run_id)

            return _PrivateWorkflowPauseEntity(
                pause_model=pause_model,
                reason_models=pause_reasons,
                pause_reasons=hydrated_pause_reasons,
            )

    def delete_workflow_pause(
        self,
        pause_entity: WorkflowPauseEntity,
    ) -> None:
        """
        Delete a workflow pause state.

        Removes the pause record for a workflow run and attempts to delete its
        stored state file. Used for cleanup operations when a paused workflow
        is no longer needed.

        Args:
            pause_entity: The pause entity to delete

        Raises:
            ValueError: If pause_entity is invalid
            _WorkflowRunError: If workflow is not paused

        Note:
            Storage deletion is best-effort. If it fails, the pause record is
            still deleted and the orphaned object key is logged for cleanup.
        """
        with self._session_maker() as session, session.begin():
            # Get the pause model by ID
            pause_model = session.get(WorkflowPause, pause_entity.id)
            if pause_model is None:
                raise _WorkflowRunError(f"WorkflowPause not found: {pause_entity.id}")
            self._delete_pause_model(session, pause_model)

    @staticmethod
    def _delete_pause_model(session: Session, pause_model: WorkflowPause) -> None:
        try:
            storage.delete(pause_model.state_object_key)
        except Exception:
            # Keeping the database row would block the next pause because workflow_run_id is unique.
            logger.exception(
                "Failed to delete state object for workflow pause; continuing with pause record deletion, "
                "pause_id=%s, workflow_run_id=%s, object_key=%s",
                pause_model.id,
                pause_model.workflow_run_id,
                pause_model.state_object_key,
            )

        # Delete the pause record
        session.delete(pause_model)

        logger.info("Deleted workflow pause %s for workflow run %s", pause_model.id, pause_model.workflow_run_id)

    def prune_pauses(
        self,
        expiration: datetime,
        resumption_expiration: datetime,
        limit: int | None = None,
    ) -> Sequence[str]:
        """
        Clean up expired and old pause states.

        Removes pause states that have expired (created before expiration time)
        and pause states that were resumed more than resumption_duration ago.
        This is used for maintenance and cleanup operations.

        Args:
            expiration: Remove pause states created before this time
            resumption_expiration: Remove pause states resumed before this time
            limit: maximum number of records deleted in one call

        Returns:
            a list of ids for pause records that were pruned

        Raises:
            ValueError: If parameters are invalid
        """
        _limit: int = limit or 1000
        pruned_record_ids: list[str] = []
        cond = or_(
            WorkflowPause.created_at < expiration,
            and_(
                WorkflowPause.resumed_at.is_not(null()),
                WorkflowPause.resumed_at < resumption_expiration,
            ),
        )
        # First, collect pause records to delete with their state files
        # Expired pauses (created before expiration time)
        stmt = select(WorkflowPause).where(cond).limit(_limit)

        with self._session_maker(expire_on_commit=False) as session:
            # Old resumed pauses (resumed more than resumption_duration ago)

            # Get all records to delete
            pauses_to_delete = session.scalars(stmt).all()

        # Delete state files from storage
        for pause in pauses_to_delete:
            with self._session_maker(expire_on_commit=False) as session, session.begin():
                # todo: this issues a separate query for each WorkflowPause record.
                # consider batching this lookup.
                try:
                    storage.delete(pause.state_object_key)
                    logger.info(
                        "Deleted state object for pause, pause_id=%s, object_key=%s",
                        pause.id,
                        pause.state_object_key,
                    )
                except Exception:
                    logger.exception(
                        "Failed to delete state file for pause, pause_id=%s, object_key=%s",
                        pause.id,
                        pause.state_object_key,
                    )
                    continue
                session.delete(pause)
                pruned_record_ids.append(pause.id)
                logger.info(
                    "workflow pause records deleted, id=%s, resumed_at=%s",
                    pause.id,
                    pause.resumed_at,
                )

        return pruned_record_ids


class _PrivateWorkflowPauseEntity(WorkflowPauseEntity):
    """
    Private implementation of WorkflowPauseEntity for SQLAlchemy repository.

    This implementation is internal to the repository layer and provides
    the concrete implementation of the WorkflowPauseEntity interface.
    """

    def __init__(
        self,
        *,
        pause_model: WorkflowPause,
        reason_models: Sequence[WorkflowPauseReason],
        pause_reasons: Sequence[DifyPauseReason] | None = None,
        human_input_form: Sequence = (),
    ) -> None:
        self._pause_model = pause_model
        self._reason_models = reason_models
        self._pause_reasons = pause_reasons
        self._cached_state: bytes | None = None
        self._human_input_form = human_input_form

    @property
    @override
    def id(self) -> str:
        return self._pause_model.id

    @property
    @override
    def workflow_execution_id(self) -> str:
        return self._pause_model.workflow_run_id

    @override
    def get_state(self) -> bytes:
        """
        Retrieve the serialized workflow state from storage.

        Returns:
            Mapping[str, Any]: The workflow state as a dictionary

        Raises:
            FileNotFoundError: If the state file cannot be found
            IOError: If there are issues reading the state file
            _Workflow: If the state cannot be deserialized properly
        """
        if self._cached_state is not None:
            return self._cached_state

        # Load the state from storage
        state_data = storage.load(self._pause_model.state_object_key)
        self._cached_state = state_data
        return state_data

    @property
    @override
    def resumed_at(self) -> datetime | None:
        return self._pause_model.resumed_at

    @override
    def get_pause_reasons(self) -> Sequence[DifyPauseReason]:
        if self._pause_reasons is not None:
            return list(self._pause_reasons)
        return [_to_dify_pause_reason(reason) for reason in self._reason_models]

    @property
    @override
    def paused_at(self) -> datetime:
        return self._pause_model.created_at
