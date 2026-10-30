"""Persist images emitted by document parsers within the caller's transaction."""

from __future__ import annotations

import hashlib
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


class ExtractionImageWriter:
    """Publish one parser image and retain exact evidence for compensation."""

    def __init__(
        self,
        *,
        session: Session,
        files: ExtractionImageFileStore,
        tenant_id: str,
        user_id: str,
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

        file_id = str(uuid4())
        file_key = f"image_files/{self._tenant_id}/{uuid4()}.{normalized_extension}"
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
            hash=hashlib.sha256(image.content).hexdigest(),
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
