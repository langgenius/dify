"""Batched storage-key hydration for workflow files."""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence

from graphon.file import File, FileTransferMethod
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.file_access import FileAccessControllerProtocol
from core.workflow.file_reference import build_file_reference, parse_file_reference
from models import ToolFile, UploadFile


class StorageKeyLoader:
    """Load storage keys for files with a constant number of database queries."""

    _session: Session
    _tenant_id: str
    _access_controller: FileAccessControllerProtocol

    def __init__(
        self,
        session: Session,
        tenant_id: str,
        access_controller: FileAccessControllerProtocol,
    ) -> None:
        self._session = session
        self._tenant_id = tenant_id
        self._access_controller = access_controller

    def _load_upload_files(self, upload_file_ids: Sequence[uuid.UUID]) -> Mapping[uuid.UUID, UploadFile]:
        stmt = select(UploadFile).where(
            UploadFile.id.in_(upload_file_ids),
            UploadFile.tenant_id == self._tenant_id,
        )
        scoped_stmt = self._access_controller.apply_upload_file_filters(stmt)
        return {uuid.UUID(upload_file.id): upload_file for upload_file in self._session.scalars(scoped_stmt)}

    def _load_tool_files(self, tool_file_ids: Sequence[uuid.UUID]) -> Mapping[uuid.UUID, ToolFile]:
        stmt = select(ToolFile).where(
            ToolFile.id.in_(tool_file_ids),
            ToolFile.tenant_id == self._tenant_id,
        )
        scoped_stmt = self._access_controller.apply_tool_file_filters(stmt)
        return {uuid.UUID(tool_file.id): tool_file for tool_file in self._session.scalars(scoped_stmt)}

    def load_storage_keys(self, files: Sequence[File]) -> None:
        """Hydrate storage keys by loading their backing file rows in batches.

        The sequence shape is preserved. Each file is updated in place with a
        canonical record reference and storage key loaded from an authorized
        database row. Tenant scoping is enforced by this loader's context
        rather than by embedding tenant identity or storage paths inside
        graph-layer ``File`` values.

        For best performance, prefer batches smaller than 1000 files.
        """

        upload_file_ids: list[uuid.UUID] = []
        tool_file_ids: list[uuid.UUID] = []
        for file in files:
            parsed_reference = parse_file_reference(file.reference)
            if parsed_reference is None:
                raise ValueError("file id should not be None.")

            model_id = uuid.UUID(parsed_reference.record_id)
            if file.transfer_method in (
                FileTransferMethod.LOCAL_FILE,
                FileTransferMethod.REMOTE_URL,
                FileTransferMethod.DATASOURCE_FILE,
            ):
                upload_file_ids.append(model_id)
            elif file.transfer_method == FileTransferMethod.TOOL_FILE:
                tool_file_ids.append(model_id)

        tool_files = self._load_tool_files(tool_file_ids)
        upload_files = self._load_upload_files(upload_file_ids)
        for file in files:
            parsed_reference = parse_file_reference(file.reference)
            if parsed_reference is None:
                raise ValueError("file id should not be None.")

            model_id = uuid.UUID(parsed_reference.record_id)
            if file.transfer_method in (
                FileTransferMethod.LOCAL_FILE,
                FileTransferMethod.REMOTE_URL,
                FileTransferMethod.DATASOURCE_FILE,
            ):
                upload_file_row = upload_files.get(model_id)
                if upload_file_row is None:
                    raise ValueError(f"Upload file not found for id: {model_id}")
                file.reference = build_file_reference(
                    record_id=str(upload_file_row.id),
                )
                file.storage_key = upload_file_row.key
            elif file.transfer_method == FileTransferMethod.TOOL_FILE:
                tool_file_row = tool_files.get(model_id)
                if tool_file_row is None:
                    raise ValueError(f"Tool file not found for id: {model_id}")
                file.reference = build_file_reference(
                    record_id=str(tool_file_row.id),
                )
                file.storage_key = tool_file_row.file_key
