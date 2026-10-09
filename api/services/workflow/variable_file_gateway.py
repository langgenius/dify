"""Resolve variable file inputs using the invocation's database."""

from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import FileAccessControllerProtocol
from factories.file_factory import build_from_mapping
from factories.file_factory.common import resolve_mapping_file_id
from graphon.file import File, FileTransferMethod
from models.utils.file_input_compat import build_file_from_mapping_without_lookup


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
