"""Storage and extraction adapters composing the file application service."""

from contextlib import suppress

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from enums import DeploymentEdition
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from graphon.file import helpers as file_helpers
from libs.datetime_utils import naive_utc_now
from repositories.agent.upload_file_references import get_referenced_upload_file_ids as get_agent_file_reference_ids
from repositories.app.upload_file_references import get_referenced_upload_file_ids as get_app_file_reference_ids
from repositories.conversation.upload_file_references import (
    get_referenced_upload_file_ids as get_message_file_reference_ids,
)
from repositories.file.upload_file_reclamation import SQLAlchemyUploadFileReclaimer, UploadFileReferenceQuery
from repositories.file.upload_file_repository import UploadFileRepository
from repositories.knowledge.upload_file_references import (
    get_referenced_upload_file_ids as get_knowledge_file_reference_ids,
)
from repositories.workflow.human_input.upload_file_references import (
    get_referenced_upload_file_ids as get_human_input_file_reference_ids,
)
from repositories.workflow.upload_file_references import (
    get_referenced_upload_file_ids as get_workflow_file_reference_ids,
)
from repositories.workspace.upload_file_references import (
    get_referenced_upload_file_ids as get_workspace_file_reference_ids,
)
from services.entities.upload_file import UploadFileRecord
from services.file_service import FileService
from services.file_upload_policy import configured_file_upload_policy

UPLOAD_FILE_REFERENCE_QUERIES: tuple[UploadFileReferenceQuery, ...] = (
    get_knowledge_file_reference_ids,
    get_workflow_file_reference_ids,
    get_human_input_file_reference_ids,
    get_message_file_reference_ids,
    get_app_file_reference_ids,
    get_agent_file_reference_ids,
    get_workspace_file_reference_ids,
)


def _extract_text(file: UploadFileRecord) -> str:
    from services.extraction.contracts import DatasourceType, ExtractSetting, UploadFileExtractionInput
    from services.extraction.processor import ExtractProcessor

    result = ExtractProcessor.extract(
        ExtractSetting(
            datasource_type=DatasourceType.FILE,
            upload_file=UploadFileExtractionInput(
                id=file.id,
                tenant_id=file.tenant_id,
                key=file.key,
                created_by=file.created_by,
            ),
            document_model="text_model",
        ),
    )
    return "\n".join(document.page_content for document in result.documents)


def delete_upload_blob(key: str) -> None:
    # A prior attempt may have removed the blob before its metadata commit.
    with suppress(FileNotFoundError):
        storage.delete(key)


def build_upload_file_reclaimer(
    *,
    session_factory: sessionmaker[Session],
    files: UploadFileRepository,
) -> SQLAlchemyUploadFileReclaimer:
    """Compose the fixed owner-domain checks used by physical file cleanup."""

    return SQLAlchemyUploadFileReclaimer(
        session_factory=session_factory,
        files=files,
        reference_queries=UPLOAD_FILE_REFERENCE_QUERIES,
    )


def build_file_service(*, session_factory: sessionmaker[Session]) -> FileService:
    """Compose the same file dependencies for HTTP and session-bound worker roots."""

    files = UploadFileRepository(session_factory=session_factory)
    return FileService(
        files=files,
        reclaimer=build_upload_file_reclaimer(session_factory=session_factory, files=files),
        storage=storage,
        upload_policy=configured_file_upload_policy(),
        storage_type=dify_config.STORAGE_TYPE,
        sign_file=file_helpers.get_signed_file_url,
        extract_text=_extract_text,
        delete_blob=delete_upload_blob,
        direct_icon_urls=(
            dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and dify_config.STORAGE_TYPE == StorageType.S3
        ),
        access_timeout=dify_config.FILES_ACCESS_TIMEOUT,
        clock=naive_utc_now,
    )
