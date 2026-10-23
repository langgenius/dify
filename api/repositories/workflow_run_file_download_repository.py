"""Persistence adapter for run-scoped Service API file downloads."""

from collections.abc import Mapping
from pathlib import PurePath
from typing import Any, override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.file_reference import resolve_file_record_id
from models.enums import CreatorUserRole
from models.human_input import HumanInputForm, HumanInputFormUploadFile
from models.model import EndUser, UploadFile
from models.tools import ToolFile
from models.workflow import WorkflowRun
from services.workflow_run_file_download_service import (
    WorkflowRunFileAccessDeniedError,
    WorkflowRunFileNotFoundError,
    WorkflowRunFileNotReferencedError,
    WorkflowRunFileNotRetainedError,
    WorkflowRunFileQuery,
    WorkflowRunFileRecord,
)

_FILE_TYPES = frozenset({"audio", "custom", "document", "file", "image", "video"})


class WorkflowRunFileDownloadQueryRepository(WorkflowRunFileQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_for_run(
        self,
        *,
        file_id: str,
        run_id: str,
        app_id: str,
        tenant_id: str,
    ) -> WorkflowRunFileRecord:
        with self._session_factory() as session:
            run = session.scalar(
                select(WorkflowRun).where(
                    WorkflowRun.id == run_id,
                    WorkflowRun.app_id == app_id,
                    WorkflowRun.tenant_id == tenant_id,
                )
            )
            if run is None:
                raise WorkflowRunFileNotFoundError(run_id)

            upload_ids, tool_ids = _collect_file_references((run.inputs_dict, run.outputs_dict))
            human_input_upload = session.scalar(
                select(HumanInputFormUploadFile.upload_file_id)
                .join(HumanInputForm, HumanInputForm.id == HumanInputFormUploadFile.form_id)
                .where(
                    HumanInputFormUploadFile.upload_file_id == file_id,
                    HumanInputFormUploadFile.app_id == app_id,
                    HumanInputFormUploadFile.tenant_id == tenant_id,
                    HumanInputForm.app_id == app_id,
                    HumanInputForm.tenant_id == tenant_id,
                    HumanInputForm.workflow_run_id == run_id,
                )
                .limit(1)
            )
            is_human_input_upload = human_input_upload is not None

            if file_id not in upload_ids and file_id not in tool_ids and not is_human_input_upload:
                raise WorkflowRunFileNotReferencedError(file_id)

            upload_file = session.get(UploadFile, file_id)
            if upload_file is not None and (file_id in upload_ids or is_human_input_upload):
                if upload_file.tenant_id != tenant_id:
                    raise WorkflowRunFileAccessDeniedError(file_id)
                if not is_human_input_upload:
                    owner = session.scalar(
                        select(EndUser).where(
                            EndUser.id == upload_file.created_by,
                            EndUser.tenant_id == tenant_id,
                            EndUser.app_id == app_id,
                        )
                    )
                    if (
                        upload_file.created_by_role != CreatorUserRole.END_USER
                        or run.created_by_role != CreatorUserRole.END_USER
                        or upload_file.created_by != run.created_by
                        or owner is None
                    ):
                        raise WorkflowRunFileAccessDeniedError(file_id)
                return WorkflowRunFileRecord(
                    key=upload_file.key,
                    name=upload_file.name,
                    size=upload_file.size,
                    extension=upload_file.extension,
                    mime_type=upload_file.mime_type,
                )

            tool_file = session.get(ToolFile, file_id)
            if tool_file is not None and file_id in tool_ids:
                owner = session.scalar(
                    select(EndUser).where(
                        EndUser.id == run.created_by,
                        EndUser.tenant_id == tenant_id,
                        EndUser.app_id == app_id,
                    )
                )
                if (
                    tool_file.tenant_id != tenant_id
                    or tool_file.user_id != run.created_by
                    or run.created_by_role != CreatorUserRole.END_USER
                    or owner is None
                ):
                    raise WorkflowRunFileAccessDeniedError(file_id)
                return WorkflowRunFileRecord(
                    key=tool_file.file_key,
                    name=tool_file.name,
                    size=tool_file.size,
                    extension=PurePath(tool_file.name).suffix.lstrip("."),
                    mime_type=tool_file.mimetype,
                )

            raise WorkflowRunFileNotRetainedError(file_id)


def _collect_file_references(values: tuple[Any, ...]) -> tuple[set[str], set[str]]:
    """Read only file IDs from serialized Dify file mappings, never bare URLs."""
    upload_ids: set[str] = set()
    tool_ids: set[str] = set()

    def visit(value: Any) -> None:
        if isinstance(value, Mapping):
            transfer_method = value.get("transfer_method")
            file_type = value.get("type")
            if transfer_method == "local_file" or file_type in _FILE_TYPES:
                upload_file_id = value.get("upload_file_id")
                if isinstance(upload_file_id, str) and upload_file_id:
                    upload_ids.add(upload_file_id)
                elif transfer_method == "local_file":
                    reference = value.get("reference")
                    record_id = resolve_file_record_id(reference) if isinstance(reference, str) else None
                    if record_id:
                        upload_ids.add(record_id)
            if transfer_method == "tool_file" or "tool_file_id" in value:
                tool_file_id = value.get("tool_file_id")
                if isinstance(tool_file_id, str) and tool_file_id:
                    tool_ids.add(tool_file_id)
                elif transfer_method == "tool_file":
                    reference = value.get("reference")
                    record_id = resolve_file_record_id(reference) if isinstance(reference, str) else None
                    if record_id:
                        tool_ids.add(record_id)
            for nested in value.values():
                visit(nested)
        elif isinstance(value, (list, tuple)):
            for nested in value:
                visit(nested)

    for value in values:
        visit(value)
    return upload_ids, tool_ids
