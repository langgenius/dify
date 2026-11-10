"""Resolve variable file inputs using the invocation's database."""

from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import FileAccessControllerProtocol
from factories.file_factory import build_from_mapping
from factories.file_factory.common import resolve_mapping_file_id
from graphon.file import File, FileTransferMethod
from models.enums import CreatorUserRole
from models.utils.file_input_compat import build_file_from_mapping_without_lookup
from services.file_service import FileService, FileUploadActor
from services.workflow.draft_variable_contracts import DraftUploadRecord, DraftVariableCreator


class WorkflowDraftFileUploader:
    """Upload draft-variable content without exposing file persistence models."""

    def __init__(self, files: FileService) -> None:
        self._files = files

    def upload_file(
        self,
        *,
        filename: str,
        content: bytes,
        mimetype: str,
        creator: DraftVariableCreator,
        tenant_id: str,
    ) -> DraftUploadRecord:
        """Persist one account-owned upload in the explicit tenant and return its plain identity.

        The creator has already been admitted as an account. FileService owns storage and
        database writes; its detached result is narrowed to the identity the draft saver needs.
        """
        upload = self._files.upload_file_for_actor(
            actor=FileUploadActor(id=creator.id, creator_role=CreatorUserRole.ACCOUNT),
            resource_tenant_id=tenant_id,
            filename=filename,
            content=content,
            mimetype=mimetype,
        )
        return DraftUploadRecord(id=upload.id)


class WorkflowVariableFileGateway:
    def __init__(self, sessions: sessionmaker[Session], access: FileAccessControllerProtocol) -> None:
        self._sessions = sessions
        self._access = access

    def build(self, *, tenant_id: str, mapping: dict[str, Any]) -> File:
        return build_from_mapping(
            mapping=mapping, tenant_id=tenant_id, access_controller=self._access, sessions=self._sessions
        )

    def restore(self, *, tenant_id: str, mapping: dict[str, Any]) -> File:
        # External URLs without a stored upload already carry their metadata.
        # Opening the inspector must not retrieve the remote file again.
        if mapping["transfer_method"] == FileTransferMethod.REMOTE_URL and not resolve_mapping_file_id(
            mapping, "upload_file_id"
        ):
            return build_file_from_mapping_without_lookup(file_mapping=mapping)
        return self.build(tenant_id=tenant_id, mapping=mapping)
