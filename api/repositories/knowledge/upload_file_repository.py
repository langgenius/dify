"""SQLAlchemy repository for upload files used by knowledge extraction."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.entities.extraction import UploadFileExtractionInput
from models.model import UploadFile


class SQLAlchemyKnowledgeUploadRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_by_id(self, *, workspace_id: str, file_id: str) -> UploadFileExtractionInput | None:
        return self.get_by_ids(workspace_id=workspace_id, file_ids=(file_id,)).get(file_id)

    def get_by_ids(self, *, workspace_id: str, file_ids: Sequence[str]) -> dict[str, UploadFileExtractionInput]:
        return {
            upload.id: UploadFileExtractionInput.model_validate(upload)
            for upload in self.get_files(workspace_id=workspace_id, file_ids=file_ids).values()
        }

    def get_files(self, *, workspace_id: str, file_ids: Sequence[str]) -> dict[str, UploadFile]:
        if not file_ids:
            return {}
        with self._session_factory() as session:
            uploads = session.scalars(
                select(UploadFile).where(UploadFile.id.in_(file_ids), UploadFile.tenant_id == workspace_id)
            )
            return {upload.id: upload for upload in uploads}

    def get_file_name(self, *, workspace_id: str, upload_file_id: str) -> str | None:
        upload = self.get_files(workspace_id=workspace_id, file_ids=(upload_file_id,)).get(upload_file_id)
        return upload.name if upload is not None else None
