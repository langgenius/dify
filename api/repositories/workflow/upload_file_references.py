"""Workflow-domain references to shared upload files."""

import json
import logging
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

logger = logging.getLogger(__name__)

# Fixed per-check budgets bound the SQL owner scan and the payload bytes this
# repository accumulates. The row queries may read one extra overflow-probe
# row, and a storage adapter may buffer data internally before yielding chunks.
_OPAQUE_PAYLOAD_ROW_LIMIT = 100
_OPAQUE_PAYLOAD_BYTE_LIMIT = 16 * 1024 * 1024


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


def _load_opaque_payload(
    key: str,
    *,
    byte_budget: int,
) -> tuple[object | None, int, bool]:
    """Accumulate one streamed payload within the repository byte budget.

    The final boolean reports whether the complete object fit in the budget. A
    missing object keeps its historical meaning: it contributes no reference.
    Other storage errors propagate so reclamation fails closed. Whether the
    object is also streamed at the transport layer is the storage adapter's
    responsibility; some adapters may buffer before yielding their first chunk.
    """

    chunks: list[bytes] = []
    bytes_read = 0
    exhausted = False
    within_budget = True
    payload_stream = None
    try:
        payload_stream = storage.load_stream(key)
        while not exhausted and within_budget:
            try:
                chunk = next(payload_stream)
            except StopIteration:
                exhausted = True
            else:
                bytes_read += len(chunk)
                within_budget = bytes_read <= byte_budget
                if within_budget:
                    chunks.append(chunk)
    except FileNotFoundError:
        return None, bytes_read, True
    finally:
        if payload_stream is not None:
            payload_stream.close()

    if not within_budget:
        return None, bytes_read, False
    return _decode_payload(b"".join(chunks).decode()), bytes_read, True


def _opaque_payload_keys(
    session: Session,
    *,
    tenant_id: str,
) -> tuple[tuple[str, ...], bool]:
    """Lock a bounded, complete list of live opaque payload keys for a tenant.

    All three owner sources share one row budget. The extra row requested from
    each source proves whether the list is complete before any object is read.
    If the budget is exceeded, callers must conservatively retain candidates;
    large tenants may therefore defer otherwise-safe file reclamation.
    """

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
    queries = (execution_query, draft_query, pause_query)
    keys: list[str] = []
    query_index = 0
    complete = True
    while complete and query_index < len(queries):
        remaining = _OPAQUE_PAYLOAD_ROW_LIMIT - len(keys)
        source_keys = tuple(session.scalars(queries[query_index].limit(remaining + 1)))
        complete = len(source_keys) <= remaining
        if complete:
            keys.extend(source_keys)
        query_index += 1

    if not complete:
        logger.warning(
            "Opaque workflow payload scan exceeded the row limit; retaining upload-file candidates, "
            "tenant_id=%s, row_limit=%s",
            tenant_id,
            _OPAQUE_PAYLOAD_ROW_LIMIT,
        )
        return (), False
    return tuple(dict.fromkeys(keys)), True


def _candidate_ids_maybe_referenced_by_opaque_payloads(
    session: Session,
    *,
    tenant_id: str,
    candidates: Sequence[UploadFileReferenceCandidate],
) -> set[str]:
    """Resolve opaque references within row and repository-buffer budgets.

    Exceeding either budget treats every unresolved candidate as referenced.
    This fail-closed choice bounds the SQL owner scan and bytes accumulated by
    this repository at the cost of deferring deletion for tenants with too much
    live opaque workflow state. It does not guarantee that every storage
    adapter streams its transport without internal buffering.
    """

    referenced: set[str] = set()
    remaining = tuple(candidates)
    keys, key_list_complete = _opaque_payload_keys(session, tenant_id=tenant_id)
    if not key_list_complete:
        return {candidate.id for candidate in remaining}

    # Keep the candidate and owner-row locks while reading immutable payloads;
    # releasing either side before parsing would reopen the attach/delete race.
    key_index = 0
    bytes_read = 0
    scan_complete = True
    while scan_complete and remaining and key_index < len(keys):
        byte_budget = _OPAQUE_PAYLOAD_BYTE_LIMIT - bytes_read
        if byte_budget <= 0:
            scan_complete = False
        else:
            payload, payload_bytes_read, payload_complete = _load_opaque_payload(
                keys[key_index],
                byte_budget=byte_budget,
            )
            bytes_read += payload_bytes_read
            scan_complete = payload_complete
            if payload is not None:
                referenced.update(referenced_candidate_ids((payload,), remaining))
                remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        key_index += 1

    if not scan_complete:
        logger.warning(
            "Opaque workflow payload scan exceeded the repository byte-buffer limit; "
            "retaining unresolved upload-file candidates, "
            "tenant_id=%s, byte_limit=%s",
            tenant_id,
            _OPAQUE_PAYLOAD_BYTE_LIMIT,
        )
        referenced.update(candidate.id for candidate in remaining)
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
    if all(candidate.id in referenced for candidate in candidates):
        return referenced

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
