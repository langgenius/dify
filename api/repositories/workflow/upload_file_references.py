"""Workflow-domain references to shared upload files."""

import json
from collections.abc import Iterable, Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from extensions.ext_storage import storage
from models import App, UploadFile
from models.workflow import (
    ConversationVariable,
    Workflow,
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowPause,
    WorkflowRun,
)
from repositories.file.reference_queries import candidate_batches, payload_reference_predicate
from repositories.file.upload_file_repository import lock_and_validate_owned_upload_files_in_session
from services.entities.upload_file import UploadFileReferenceCandidate
from services.file_reference_parser import referenced_candidate_ids, trusted_upload_file_ids


def _decode_payload(payload: object) -> object:
    if isinstance(payload, Mapping):
        return {key: _decode_payload(value) for key, value in payload.items()}
    if isinstance(payload, (list, tuple)):
        return [_decode_payload(value) for value in payload]
    if isinstance(payload, str):
        try:
            decoded = json.loads(payload)
        except (TypeError, ValueError):
            return payload
        if decoded == payload:
            return payload
        return _decode_payload(decoded)
    return payload


def lock_new_workflow_upload_file_references(
    session: Session,
    *,
    tenant_id: str,
    previous_payloads: Iterable[object] = (),
    current_payloads: Iterable[object] = (),
    direct_upload_file_ids: Iterable[str] = (),
) -> None:
    """Fence UploadFiles newly referenced by one workflow-domain mutation.

    Existing payload references are deliberately excluded so unrelated updates to
    historical workflow rows do not fail merely because one old reference no
    longer resolves.  Direct relation-table ids are always new associations at
    the call sites using this helper.
    """

    previous_ids: set[str] = set()
    for payload in previous_payloads:
        previous_ids.update(trusted_upload_file_ids(_decode_payload(payload)))

    current_ids: set[str] = set()
    for payload in current_payloads:
        current_ids.update(trusted_upload_file_ids(_decode_payload(payload)))

    new_ids = current_ids - previous_ids
    new_ids.update(file_id for file_id in direct_upload_file_ids if file_id)
    if not new_ids:
        return
    lock_and_validate_owned_upload_files_in_session(
        session,
        tenant_id=tenant_id,
        upload_file_ids=tuple(sorted(new_ids)),
    )


def _load_opaque_payload(key: str) -> object | None:
    try:
        payload = storage.load(key)
    except FileNotFoundError:
        return None
    return _decode_payload(payload.decode())


def _opaque_payload_keys(
    session: Session,
    *,
    tenant_id: str,
) -> tuple[str, ...]:
    """Lock and return every live opaque workflow payload for one tenant."""

    execution_query = (
        select(UploadFile.key)
        .join(WorkflowNodeExecutionOffload, WorkflowNodeExecutionOffload.file_id == UploadFile.id)
        .join(
            WorkflowNodeExecutionModel,
            WorkflowNodeExecutionModel.id == WorkflowNodeExecutionOffload.node_execution_id,
        )
        .where(
            UploadFile.tenant_id == tenant_id,
            WorkflowNodeExecutionOffload.tenant_id == tenant_id,
            WorkflowNodeExecutionModel.tenant_id == tenant_id,
        )
        .with_for_update(read=True, nowait=True)
    )
    draft_query = (
        select(UploadFile.key)
        .join(WorkflowDraftVariableFile, WorkflowDraftVariableFile.upload_file_id == UploadFile.id)
        .join(WorkflowDraftVariable, WorkflowDraftVariable.file_id == WorkflowDraftVariableFile.id)
        .join(App, App.id == WorkflowDraftVariable.app_id)
        .where(
            UploadFile.tenant_id == tenant_id,
            WorkflowDraftVariableFile.tenant_id == tenant_id,
            App.tenant_id == tenant_id,
        )
        .with_for_update(read=True, nowait=True)
    )
    pause_query = (
        select(WorkflowPause.state_object_key)
        .join(WorkflowRun, WorkflowRun.id == WorkflowPause.workflow_run_id)
        .where(WorkflowRun.tenant_id == tenant_id, WorkflowPause.resumed_at.is_(None))
        .with_for_update(read=True, nowait=True)
    )
    keys = (
        *session.scalars(execution_query),
        *session.scalars(draft_query),
        *session.scalars(pause_query),
    )
    return tuple(dict.fromkeys(keys))


def _candidate_ids_maybe_referenced_by_opaque_payloads(
    session: Session,
    *,
    tenant_id: str,
    candidates: Sequence[UploadFileReferenceCandidate],
) -> set[str]:
    """Resolve references from actual offload and pause-state payloads."""

    referenced: set[str] = set()
    remaining = tuple(candidates)
    # Keep the candidate and owner-row locks while reading immutable payloads;
    # releasing either side before parsing would reopen the attach/delete race.
    for key in _opaque_payload_keys(session, tenant_id=tenant_id):
        payload = _load_opaque_payload(key)
        if payload is None:
            continue
        referenced.update(referenced_candidate_ids((payload,), remaining))
        remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        if not remaining:
            break
    return referenced


def get_referenced_upload_file_ids(
    session: Session,
    *,
    tenant_id: str,
    candidates: Sequence[UploadFileReferenceCandidate],
) -> set[str]:
    """Return candidates retained by workflow definitions and execution state."""

    if not candidates:
        return set()

    referenced = _candidate_ids_maybe_referenced_by_opaque_payloads(
        session,
        tenant_id=tenant_id,
        candidates=candidates,
    )
    for batch in candidate_batches(candidates):
        batch_ids = tuple(candidate.id for candidate in batch)
        referenced.update(
            session.scalars(
                select(WorkflowNodeExecutionOffload.file_id)
                .where(
                    WorkflowNodeExecutionOffload.tenant_id == tenant_id,
                    WorkflowNodeExecutionOffload.file_id.in_(batch_ids),
                )
                .with_for_update(read=True, nowait=True)
            )
        )
        referenced.update(
            session.scalars(
                select(WorkflowDraftVariableFile.upload_file_id)
                .where(
                    WorkflowDraftVariableFile.tenant_id == tenant_id,
                    WorkflowDraftVariableFile.upload_file_id.in_(batch_ids),
                )
                .with_for_update(read=True, nowait=True)
            )
        )
        remaining = tuple(candidate for candidate in batch if candidate.id not in referenced)
        if not remaining:
            continue

        run_columns = (WorkflowRun.graph, WorkflowRun.inputs, WorkflowRun.outputs)
        run_rows = session.execute(
            select(*run_columns)
            .where(
                WorkflowRun.tenant_id == tenant_id,
                payload_reference_predicate(run_columns, remaining),
            )
            .with_for_update(read=True, nowait=True)
        ).all()
        referenced.update(referenced_candidate_ids((payload for row in run_rows for payload in row), remaining))
        remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        if not remaining:
            continue

        execution_columns = (
            WorkflowNodeExecutionModel.inputs,
            WorkflowNodeExecutionModel.process_data,
            WorkflowNodeExecutionModel.outputs,
            WorkflowNodeExecutionModel.execution_metadata,
        )
        execution_rows = session.execute(
            select(*execution_columns)
            .where(
                WorkflowNodeExecutionModel.tenant_id == tenant_id,
                payload_reference_predicate(execution_columns, remaining),
            )
            .with_for_update(read=True, nowait=True)
        ).all()
        referenced.update(referenced_candidate_ids((payload for row in execution_rows for payload in row), remaining))
        remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        if not remaining:
            continue

        draft_rows = session.scalars(
            select(WorkflowDraftVariable.value)
            .join(App, App.id == WorkflowDraftVariable.app_id)
            .where(
                App.tenant_id == tenant_id,
                payload_reference_predicate((WorkflowDraftVariable.value,), remaining),
            )
            .with_for_update(read=True, nowait=True)
        )
        referenced.update(referenced_candidate_ids(draft_rows, remaining))
        remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        if not remaining:
            continue

        conversation_rows = session.scalars(
            select(ConversationVariable.data)
            .join(App, App.id == ConversationVariable.app_id)
            .where(
                App.tenant_id == tenant_id,
                payload_reference_predicate((ConversationVariable.data,), remaining),
            )
            .with_for_update(read=True, nowait=True)
        )
        referenced.update(referenced_candidate_ids(conversation_rows, remaining))
        remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        if not remaining:
            continue

        workflow_columns = (Workflow.graph, Workflow._conversation_variables)
        workflow_rows = session.execute(
            select(*workflow_columns)
            .where(
                Workflow.tenant_id == tenant_id,
                payload_reference_predicate(workflow_columns, remaining),
            )
            .with_for_update(read=True, nowait=True)
        ).all()
        referenced.update(referenced_candidate_ids((payload for row in workflow_rows for payload in row), remaining))
    return referenced
