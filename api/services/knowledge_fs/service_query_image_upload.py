"""Dataset API key owned query-image uploads and Service API admission validation."""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Sequence
from uuid import uuid4

from werkzeug.datastructures import FileStorage

from configs import dify_config
from core.db.session_factory import session_factory
from core.knowledge_fs.errors import KnowledgeFSProductRequestRejectedError, KnowledgeFSQueryImageError
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.knowledge_fs.query_images import (
    DATASET_API_KEY_SUBJECT_PREFIX,
    QUERY_IMAGE_MAX_BYTES,
    _assert_active_service_image_actor,
    _detect_image_mime_type,
    _validate_image_metadata,
    validate_query_image_references,
)
from services.knowledge_fs.service_api_authorization import KnowledgeFSServiceApiProfile

logger = logging.getLogger(__name__)
_IMAGE_EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}


def _reject_image(error: KnowledgeFSQueryImageError) -> KnowledgeFSProductRequestRejectedError:
    return KnowledgeFSProductRequestRejectedError(
        status_code=413 if error.code in {"QUERY_IMAGE_TOO_LARGE", "QUERY_IMAGE_TOTAL_TOO_LARGE"} else 422,
        violations=[{"field": ["queryImages"], "type": error.code}],
    )


def validate_service_query_image_references(
    *,
    profile: KnowledgeFSServiceApiProfile,
    upload_file_ids: Sequence[str],
    mark_used: bool = True,
) -> None:
    """Bind image admission to the authenticated Dataset API key, never a workspace account."""
    try:
        validate_query_image_references(
            tenant_id=profile.tenant_id,
            account_id=f"{DATASET_API_KEY_SUBJECT_PREFIX}{profile.api_token_id}",
            upload_file_ids=upload_file_ids,
            mark_used=mark_used,
        )
    except KnowledgeFSQueryImageError as error:
        raise _reject_image(error) from error


def upload_service_query_image(
    *, profile: KnowledgeFSServiceApiProfile, file: FileStorage | None
) -> dict[str, str | int]:
    """Store one bounded, sniffed image with an explicit Dataset API key creator role.

    The controller authorizes the key for the requested control space. This service rechecks
    the credential before reading its file and again when persisting the upload. Storage I/O
    stays outside database transactions, and failed admission removes the new storage object.
    """
    if file is None:
        raise KnowledgeFSProductRequestRejectedError(
            status_code=400, violations=[{"field": ["file"], "type": "missing"}]
        )
    filename = file.filename or "query-image"
    if len(filename) > 200 or any(character in filename for character in ("/", "\\", "\0")):
        raise KnowledgeFSProductRequestRejectedError(
            status_code=422, violations=[{"field": ["file"], "type": "invalid_filename"}]
        )
    subject_id = f"{DATASET_API_KEY_SUBJECT_PREFIX}{profile.api_token_id}"
    try:
        with session_factory.create_session() as session:
            _assert_active_service_image_actor(session, tenant_id=profile.tenant_id, account_id=subject_id)
        body = file.stream.read(QUERY_IMAGE_MAX_BYTES + 1)
        mime_type = _validate_image_metadata(mime_type=file.mimetype, size=len(body))
        if _detect_image_mime_type(body) != mime_type:
            raise KnowledgeFSQueryImageError("QUERY_IMAGE_MIME_MISMATCH", "Query image MIME type does not match")
    except KnowledgeFSQueryImageError as error:
        raise _reject_image(error) from error

    extension = _IMAGE_EXTENSIONS[mime_type]
    key = f"upload_files/{profile.tenant_id}/{uuid4()}.{extension}"
    upload = UploadFile(
        tenant_id=profile.tenant_id,
        storage_type=StorageType(dify_config.STORAGE_TYPE),
        key=key,
        name=filename,
        size=len(body),
        extension=extension,
        mime_type=mime_type,
        created_by_role=CreatorUserRole.DATASET_API_KEY,
        created_by=profile.api_token_id,
        created_at=naive_utc_now(),
        used=False,
        hash=hashlib.sha3_256(body).hexdigest(),
    )
    response: dict[str, str | int] = {
        "upload_file_id": upload.id,
        "byte_size": len(body),
        "mime_type": mime_type,
    }
    try:
        storage.save(key, body)
        with session_factory.create_session() as session:
            _assert_active_service_image_actor(session, tenant_id=profile.tenant_id, account_id=subject_id)
            session.add(upload)
            session.commit()
    except Exception as error:
        try:
            storage.delete(key)
        except Exception:
            logger.exception("Failed to remove unadmitted KnowledgeFS query image %s", upload.id)
        if isinstance(error, KnowledgeFSQueryImageError):
            raise _reject_image(error) from error
        raise
    return response
