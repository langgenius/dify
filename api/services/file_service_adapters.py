"""Bridge detached file metadata to the existing document extraction engine."""

from core.rag.extractor.extract_processor import ExtractProcessor
from extensions.storage.storage_type import StorageType
from models.model import UploadFile
from services.file_upload_service import FileUploadResult


def extract_file_text(*, file: FileUploadResult) -> str:
    # TODO: Accept detached extraction inputs in ExtractProcessor/ExtractSetting
    # when migrating the RAG extraction boundary. No database session is needed here.
    upload = UploadFile(
        tenant_id=file.tenant_id,
        storage_type=StorageType(file.storage_type),
        key=file.key,
        name=file.name,
        size=file.size,
        extension=file.extension,
        mime_type=file.mime_type,
        created_by_role=file.created_by_role,
        created_by=file.created_by,
        created_at=file.created_at,
        used=file.used,
        used_by=file.used_by,
        used_at=file.used_at,
        hash=file.hash,
        source_url=file.source_url,
    )
    upload.id = file.id
    return ExtractProcessor.load_from_upload_file(upload, return_text=True)
