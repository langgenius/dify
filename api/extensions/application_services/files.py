"""Configure end-user upload policy independently of cloud billing entitlements."""

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from constants import AUDIO_EXTENSIONS, DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from enums import DeploymentEdition
from extensions.ext_storage import storage
from repositories.upload_quota_repository import UploadQuotaRepository
from services.end_user_upload_service import EndUserUploadService, UploadLimits, UploadSettings
from services.file_service import FileService
from services.file_upload_gateway import FileUploadGateway


@dataclass(frozen=True)
class FileUploadServices:
    """Application lifecycle and admitted-identity adapter share one configured policy."""

    end_users: EndUserUploadService
    gateway: FileUploadGateway


def build_file_upload_services(
    *, database_client: sessionmaker[Session], staff: FileService, deployment_edition: DeploymentEdition
) -> FileUploadServices:
    """Read deployment settings once and construct adapters without external I/O."""
    limits = (
        UploadLimits()
        if deployment_edition == DeploymentEdition.CLOUD
        else UploadLimits(dify_config.WORKSPACE_UPLOAD_QUOTA_BYTES, dify_config.WORKSPACE_UPLOAD_QUOTA_FILES)
    )
    extension_limits = {
        extension: limit * 1024 * 1024
        for extensions, limit in (
            (IMAGE_EXTENSIONS, dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT),
            (VIDEO_EXTENSIONS, dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT),
            (AUDIO_EXTENSIONS, dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT),
        )
        for extension in extensions
    }
    service = EndUserUploadService(
        uploads=UploadQuotaRepository(session_factory=database_client),
        objects=storage,
        settings=UploadSettings(
            limits=limits,
            storage_type=dify_config.STORAGE_TYPE,
            default_size_limit=dify_config.UPLOAD_FILE_SIZE_LIMIT * 1024 * 1024,
            extension_size_limits=extension_limits,
            blocked_extensions=frozenset(dify_config.UPLOAD_FILE_EXTENSION_BLACKLIST),
            document_extensions=frozenset(DOCUMENT_EXTENSIONS),
        ),
    )
    return FileUploadServices(end_users=service, gateway=FileUploadGateway(end_users=service, staff=staff))
