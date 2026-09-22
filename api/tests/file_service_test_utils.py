"""Assemble real file services against a test's database and I/O doubles."""

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from extensions.ext_storage import storage as default_storage
from graphon.file import helpers as file_helpers
from repositories.file_repository import SQLAlchemyFileRepository
from services.file_service import FileService, FileStorage, FileTextExtractor
from services.file_service_adapters import extract_file_text
from services.file_upload_service import FileUploadService, FileUploadStorage, FileUploadUrlSigner


def make_file_upload_service(
    session_factory: sessionmaker[Session],
    *,
    storage: FileUploadStorage | None = None,
    sign_file_url: FileUploadUrlSigner | None = None,
) -> FileUploadService:
    return FileUploadService(
        uploads=SQLAlchemyFileRepository(session_factory=session_factory),
        storage=storage if storage is not None else default_storage,
        storage_type=dify_config.STORAGE_TYPE,
        sign_file_url=sign_file_url if sign_file_url is not None else file_helpers.get_signed_file_url,
    )


def make_file_service(
    session_factory: sessionmaker[Session],
    *,
    storage: FileStorage | None = None,
    sign_file_url: FileUploadUrlSigner | None = None,
    extract_text: FileTextExtractor | None = None,
) -> FileService:
    files = SQLAlchemyFileRepository(session_factory=session_factory)
    file_storage = storage if storage is not None else default_storage
    signer = sign_file_url if sign_file_url is not None else file_helpers.get_signed_file_url
    uploads = make_file_upload_service(
        session_factory,
        storage=file_storage,
        sign_file_url=signer,
    )
    return FileService(
        files=files,
        uploads=uploads,
        storage=file_storage,
        storage_type=dify_config.STORAGE_TYPE,
        extract_text=extract_text if extract_text is not None else extract_file_text,
        sign_file_url=signer,
    )
