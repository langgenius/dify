"""Persist images emitted by document parsers within the caller's transaction."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from datetime import datetime
from typing import Protocol
from uuid import uuid4

from sqlalchemy.orm import Session

from enums.creator import CreatorUserRole
from services.entities.upload_file import CreatedUploadArtifact, UploadFileRecord
from services.extraction.contracts import ExtractedImage, ImageReference


class ExtractionImageFileStore(Protocol):
    """Upload-file persistence required by extraction image publication."""

    def save_created_upload_file_in_session(
        self,
        session: Session,
        *,
        file: UploadFileRecord,
    ) -> None: ...

    def get_by_key_in_session(
        self,
        session: Session,
        *,
        tenant_id: str,
        key: str,
    ) -> UploadFileRecord | None: ...


class ExtractionImageWriter:
    """Publish one parser image and retain exact evidence for compensation."""

    def __init__(
        self,
        *,
        session: Session,
        files: ExtractionImageFileStore,
        tenant_id: str,
        user_id: str,
        source_file_id: str | None = None,
        storage_type: str,
        files_url: str,
        save_blob: Callable[[str, bytes], None],
        on_artifact_created: Callable[[CreatedUploadArtifact], None] | None,
        clock: Callable[[], datetime],
    ) -> None:
        self._session = session
        self._files = files
        self._tenant_id = tenant_id
        self._user_id = user_id
        self._source_file_id = source_file_id
        self._storage_type = storage_type
        self._files_url = files_url.rstrip("/")
        self._save_blob = save_blob
        self._on_artifact_created = on_artifact_created
        self._clock = clock
        self._created_upload_artifacts: list[CreatedUploadArtifact] = []

    @property
    def created_upload_artifacts(self) -> tuple[CreatedUploadArtifact, ...]:
        return tuple(self._created_upload_artifacts)

    def write(self, image: ExtractedImage) -> ImageReference:
        normalized_extension = image.extension.strip().lower().lstrip(".")
        if not normalized_extension:
            raise ValueError("An extracted image requires a file extension")

        content_hash = hashlib.sha256(image.content).hexdigest()
        if self._source_file_id is not None and image.stable_identity is not None:
            stable_identity = image.stable_identity.strip()
            if not re.fullmatch(r"[A-Za-z0-9_-]+", stable_identity):
                raise ValueError("An extracted image stable identity contains unsupported characters")
            file_key = (
                f"image_files/{self._tenant_id}/{self._source_file_id}/"
                f"{stable_identity}_{content_hash}.{normalized_extension}"
            )
            existing = self._files.get_by_key_in_session(
                self._session,
                tenant_id=self._tenant_id,
                key=file_key,
            )
            if existing is not None:
                return ImageReference(preview_url=f"{self._files_url}/files/{existing.id}/file-preview")
        else:
            file_key = f"image_files/{self._tenant_id}/{uuid4()}.{normalized_extension}"

        file_id = str(uuid4())
        now = self._clock()
        file = UploadFileRecord(
            id=file_id,
            tenant_id=self._tenant_id,
            storage_type=self._storage_type,
            key=file_key,
            name=file_key,
            size=len(image.content),
            extension=normalized_extension,
            mime_type=image.mime_type,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=self._user_id,
            created_at=now,
            hash=content_hash,
            source_url="",
            used=True,
            used_by=self._user_id,
            used_at=now,
        )
        artifact = CreatedUploadArtifact(id=file.id, key=file.key)
        self._created_upload_artifacts.append(artifact)
        if self._on_artifact_created is not None:
            self._on_artifact_created(artifact)

        self._save_blob(file.key, image.content)
        self._files.save_created_upload_file_in_session(self._session, file=file)
        return ImageReference(preview_url=f"{self._files_url}/files/{file.id}/file-preview")
