"""Rebuild message attachments with the shared file factory and explicit sessions."""

from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import FileAccessControllerProtocol
from factories.file_factory import build_from_mapping
from graphon.file import FileTransferMethod


class AgentLogFileGateway:
    def __init__(self, *, sessions: sessionmaker[Session], access: FileAccessControllerProtocol) -> None:
        self._sessions = sessions
        self._access = access

    def resolve(self, *, tenant_id: str, files: list[dict[str, Any]]) -> list[dict[str, Any]]:
        result = []
        for source in files:
            mapping = dict(source)
            if mapping["transfer_method"] == FileTransferMethod.TOOL_FILE:
                reference = mapping["upload_file_id"]
                if reference is None:
                    reference = mapping["url"].split("/")[-1].split(".")[0]
                mapping["tool_file_id"] = reference
                mapping["upload_file_id"] = reference
            file = build_from_mapping(
                mapping=mapping, tenant_id=tenant_id, access_controller=self._access, sessions=self._sessions
            )
            result.append(
                {"belongs_to": source["belongs_to"], "upload_file_id": mapping["upload_file_id"], **file.to_dict()}
            )
        return result
