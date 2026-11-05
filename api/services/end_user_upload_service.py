"""End-user upload admission, storage and recoverable finalization.

Capacity includes historical uploads and durable in-flight reservations. Object
I/O runs outside database transactions. An uncertain failure never releases a
reservation: the object or metadata commit might already be externally visible.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha3_256
from pathlib import PurePosixPath
from typing import Literal, Protocol
from uuid import uuid4

from services.errors.file import BlockedFileExtensionError, FileTooLargeError, UnsupportedFileTypeError


class UploadOwnerNotFoundError(ValueError):
    """The admitted end user does not belong to the requested workspace/app."""


class WorkspaceUploadQuotaExceededError(FileTooLargeError):
    """The workspace has insufficient cumulative upload capacity."""

    def __init__(self) -> None:
        """Create the established per-file error with a cumulative-quota message."""
        super().__init__("Workspace upload quota exceeded; remove uploads or increase the configured quota.")


@dataclass(frozen=True)
class UploadActor:
    """Trusted creator and resource owner, reconstructed at the admission boundary."""

    tenant_id: str
    end_user_id: str


@dataclass(frozen=True)
class UploadLimits:
    """Nonnegative limits; zero disables that dimension, including for empty files."""

    max_bytes: int = 0
    max_files: int = 0

    def __post_init__(self) -> None:
        """Reject negative capacities before constructing an application service."""
        if self.max_bytes < 0 or self.max_files < 0:
            raise ValueError("Upload quotas must be nonnegative")

    @property
    def enabled(self) -> bool:
        """Return whether admission must reserve persistent capacity."""
        return bool(self.max_bytes or self.max_files)


@dataclass(frozen=True)
class UploadSettings:
    """Plain deployment settings; all size limits are bytes, not MiB."""

    limits: UploadLimits
    storage_type: str
    default_size_limit: int
    extension_size_limits: Mapping[str, int]
    blocked_extensions: frozenset[str]
    document_extensions: frozenset[str]


@dataclass(frozen=True)
class PendingUpload:
    """Immutable metadata used for both an admitted reservation and its final row."""

    id: str
    tenant_id: str
    created_by: str
    storage_type: str
    key: str
    name: str
    size: int
    extension: str
    mime_type: str
    created_at: datetime
    hash: str
    source_url: str


class UploadStore(Protocol):
    """Tenant-scoped persistence; each operation owns one short transaction.

    Reserve and finalize serialize on a workspace-row write lock. Admission
    atomically counts user-upload-purpose end-user rows (including historical role
    spellings) plus reservations and inserts one reservation within the limits.
    Finalize inserts metadata and removes the reservation atomically under the
    same lock, or returns an identical already-committed upload. Unknown outcomes
    retain the reservation or the committed row. No port performs object I/O.
    """

    def reserve(self, upload: PendingUpload, limits: UploadLimits) -> None:
        """Validate the full owner chain and reserve, or reject without changing usage."""
        ...

    def finalize(self, upload: PendingUpload, *, reserved: bool) -> PendingUpload:
        """Commit metadata exactly once; a reserved write needs matching durable metadata."""
        ...

    def pending(self, *, tenant_id: str, limit: int, reservation_id: str | None = None) -> Sequence[PendingUpload]:
        """Return a bounded snapshot for one workspace, not sessions or ORM objects."""
        ...

    def release_missing(self, upload: PendingUpload) -> None:
        """With writers quiesced and object absent, recheck identity and release only pending capacity."""
        ...


class UploadObjects(Protocol):
    """External object backend; a write exception may follow a visible side effect."""

    def save(self, filename: str, data: bytes) -> None:
        """Write one generated key; errors make no guarantee about object absence."""
        ...

    def load_once(self, filename: str) -> bytes:
        """Read an object, raising FileNotFoundError only for confirmed absence."""
        ...


RecoveryResult = Literal["ready", "finalized", "missing", "released", "mismatch", "different_backend"]


class EndUserUploadService:
    """Own end-user upload policy and lifecycle through consumer-owned ports."""

    def __init__(self, *, uploads: UploadStore, objects: UploadObjects, settings: UploadSettings) -> None:
        """Receive configured ports; construction performs no I/O."""
        self._uploads = uploads
        self._objects = objects
        self._settings = settings

    def upload(
        self,
        actor: UploadActor,
        *,
        filename: str,
        content: bytes,
        mimetype: str,
        source_url: str = "",
        source: Literal["datasets", "knowledge_fs"] | None = None,
        default_file_size_limit: int | None = None,
    ) -> PendingUpload:
        """Validate a trusted upload, reserve if enabled, then store and finalize.

        ``default_file_size_limit`` is an optional non-media limit in MiB;
        zero accepts only empty files. None retains the deployment default.
        Admission/validation failures create no object. Storage/commit failures
        propagate, retaining a durable reservation when quotas are enabled.
        """
        if any(separator in filename for separator in ("/", "\\")):
            raise ValueError("Filename contains invalid characters")
        extension = PurePosixPath(filename).suffix.lstrip(".").lower()
        if len(filename) > 200:
            filename = filename.split(".")[0][:200] + "." + extension
        if extension and extension in self._settings.blocked_extensions:
            raise BlockedFileExtensionError(f"File extension '.{extension}' is not allowed for security reasons")
        if source == "datasets" and extension not in self._settings.document_extensions:
            raise UnsupportedFileTypeError()
        default_limit = (
            self._settings.default_size_limit
            if default_file_size_limit is None
            else default_file_size_limit * 1024 * 1024
        )
        if len(content) > self._settings.extension_size_limits.get(extension, default_limit):
            raise FileTooLargeError()
        upload_id = str(uuid4())
        upload = PendingUpload(
            id=upload_id,
            tenant_id=actor.tenant_id,
            created_by=actor.end_user_id,
            storage_type=self._settings.storage_type,
            key=f"upload_files/{actor.tenant_id}/{upload_id}.{extension}",
            name=filename,
            size=len(content),
            extension=extension,
            mime_type=mimetype,
            created_at=datetime.now(UTC).replace(tzinfo=None, microsecond=0),
            hash=sha3_256(content).hexdigest(),
            source_url=source_url,
        )
        if self._settings.limits.enabled:
            self._uploads.reserve(upload, self._settings.limits)
        self._objects.save(upload.key, content)
        return self._uploads.finalize(upload, reserved=self._settings.limits.enabled)

    def pending(self, *, tenant_id: str, limit: int, reservation_id: str | None = None) -> Sequence[PendingUpload]:
        """Read a bounded workspace batch or one explicit ID; None selects the oldest batch."""
        if not 1 <= limit <= 1000:
            raise ValueError("limit must be between 1 and 1000")
        return self._uploads.pending(tenant_id=tenant_id, limit=limit, reservation_id=reservation_id)

    def recover(
        self,
        upload: PendingUpload,
        *,
        apply: bool,
        release_missing: bool,
        writers_stopped: bool,
    ) -> RecoveryResult:
        """Inspect one reservation; dry-run never changes DB or storage.

        Complete, matching objects may be finalized without repeating writes.
        Missing capacity is freed only with an explicit quiesced-writer claim.
        Mismatched objects, backend changes and non-absence errors never free
        capacity. No recovery path deletes objects or committed uploads.
        """
        if release_missing and not writers_stopped:
            raise ValueError("All upload writers must be stopped before releasing missing objects")
        if upload.storage_type != self._settings.storage_type:
            return "different_backend"
        try:
            content = self._objects.load_once(upload.key)
        except FileNotFoundError:
            if apply and release_missing:
                self._uploads.release_missing(upload)
                return "released"
            return "missing"
        if len(content) != upload.size or sha3_256(content).hexdigest() != upload.hash:
            return "mismatch"
        if apply:
            self._uploads.finalize(upload, reserved=True)
            return "finalized"
        return "ready"
