"""KnowledgeFS object operations backed by Dify's configured storage provider.

KnowledgeFS is a separate Node process, so it reaches this service through a
trusted inner API rather than importing Python storage implementations or
holding a second set of provider credentials. Logical KnowledgeFS keys are
confined below a dedicated physical namespace. Metadata is stored as a small
sidecar because Dify's common ``BaseStorage`` contract intentionally exposes
portable byte operations rather than provider-specific object metadata.

Object keys are immutable/versioned in KnowledgeFS product flows. A backend
must also support ``scan`` for bounded logical pagination and cleanup; health
fails closed when that capability is unavailable.
"""

from __future__ import annotations

import json
from base64 import b64decode, b64encode
from collections.abc import Generator, Mapping
from dataclasses import dataclass
from hashlib import sha256
from typing import Protocol, TypedDict

from extensions.ext_storage import storage

KNOWLEDGE_FS_OBJECT_MAX_BYTES = 64 * 1024 * 1024
_MAX_KEY_BYTES = 1024
_MAX_LIST_LIMIT = 100
_MAX_METADATA_ENTRIES = 64
_MAX_METADATA_KEY_BYTES = 64
_MAX_METADATA_VALUE_BYTES = 1024
_DATA_ROOT = "knowledge-fs/objects"
_METADATA_ROOT = "knowledge-fs/object-metadata"
_HEALTH_SCAN_ROOT = "knowledge-fs/health-capability"


class KnowledgeFSObjectStorageError(Exception):
    """Base error for the trusted KnowledgeFS storage gateway."""


class KnowledgeFSObjectStorageInvalidInputError(KnowledgeFSObjectStorageError):
    """The caller supplied an invalid key, cursor, metadata value, or limit."""


class KnowledgeFSObjectStorageTooLargeError(KnowledgeFSObjectStorageInvalidInputError):
    """The caller supplied an object body above the portable gateway limit."""


class KnowledgeFSObjectStorageChecksumError(KnowledgeFSObjectStorageError):
    """The supplied checksum does not match the uploaded object body."""


class KnowledgeFSObjectStorageCorruptError(KnowledgeFSObjectStorageError):
    """The physical object and its portable metadata sidecar disagree."""


class KnowledgeFSObjectStorageUnavailableError(KnowledgeFSObjectStorageError):
    """The selected Dify storage backend lacks a required portable capability."""


class _StorageBackend(Protocol):
    def save(self, filename: str, data: bytes) -> None: ...

    def load_once(self, filename: str) -> bytes: ...

    def load_stream(self, filename: str) -> Generator[bytes, None, None]: ...

    def exists(self, filename: str) -> bool: ...

    def delete(self, filename: str) -> None: ...

    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]: ...


class _StoredMetadataPayload(TypedDict):
    checksum_sha256_base64: str
    content_type: str | None
    key: str
    metadata: dict[str, str]
    size_bytes: int
    version: int


@dataclass(frozen=True, slots=True)
class KnowledgeFSObjectMetadata:
    """Portable metadata returned to the KnowledgeFS adapter."""

    checksum_sha256_base64: str
    content_type: str | None
    key: str
    metadata: Mapping[str, str]
    size_bytes: int


@dataclass(frozen=True, slots=True)
class KnowledgeFSObjectList:
    """One keyset-paginated page of logical KnowledgeFS objects."""

    objects: tuple[KnowledgeFSObjectMetadata, ...]
    next_cursor: str | None = None


class KnowledgeFSObjectStorageService:
    """Confine KnowledgeFS object I/O to Dify's unified storage namespace."""

    _backend: _StorageBackend

    def __init__(self, *, backend: _StorageBackend = storage) -> None:
        self._backend = backend

    def put_object(
        self,
        *,
        key: str,
        body: bytes,
        metadata: Mapping[str, str],
        checksum_sha256_base64: str | None = None,
        content_type: str | None = None,
    ) -> KnowledgeFSObjectMetadata:
        """Validate and persist one immutable logical object and its metadata sidecar."""
        normalized_key = _normalize_key(key)
        normalized_metadata = _normalize_metadata(metadata)
        normalized_content_type = _normalize_content_type(content_type)
        if len(body) > KNOWLEDGE_FS_OBJECT_MAX_BYTES:
            raise KnowledgeFSObjectStorageTooLargeError(f"object exceeds max bytes {KNOWLEDGE_FS_OBJECT_MAX_BYTES}")

        actual_checksum = b64encode(sha256(body).digest()).decode()
        if checksum_sha256_base64 is not None:
            expected_checksum = _normalize_checksum(checksum_sha256_base64)
            if expected_checksum != actual_checksum:
                raise KnowledgeFSObjectStorageChecksumError("object checksum does not match body")

        object_metadata = KnowledgeFSObjectMetadata(
            checksum_sha256_base64=actual_checksum,
            content_type=normalized_content_type,
            key=normalized_key,
            metadata=normalized_metadata,
            size_bytes=len(body),
        )
        data_path = _data_path(normalized_key)
        self._backend.save(data_path, body)
        try:
            self._backend.save(_metadata_path(normalized_key), _encode_metadata(object_metadata))
        except Exception:
            self._backend.delete(data_path)
            raise
        return object_metadata

    def head_object(self, *, key: str) -> KnowledgeFSObjectMetadata | None:
        """Return portable metadata without loading the object body."""
        normalized_key = _normalize_key(key)
        if not self._backend.exists(_data_path(normalized_key)):
            return None
        try:
            encoded = self._backend.load_once(_metadata_path(normalized_key))
        except FileNotFoundError as exc:
            raise KnowledgeFSObjectStorageCorruptError("object metadata sidecar is missing") from exc
        metadata = _decode_metadata(encoded)
        if metadata.key != normalized_key:
            raise KnowledgeFSObjectStorageCorruptError("object metadata key does not match")
        return metadata

    def load_stream(self, *, key: str) -> Generator[bytes, None, None] | None:
        """Return the configured backend's stream for one logical object."""
        normalized_key = _normalize_key(key)
        data_path = _data_path(normalized_key)
        if not self._backend.exists(data_path):
            return None
        return self._backend.load_stream(data_path)

    def delete_object(self, *, key: str) -> None:
        """Idempotently delete an object and its portable metadata sidecar."""
        normalized_key = _normalize_key(key)
        self._backend.delete(_data_path(normalized_key))
        self._backend.delete(_metadata_path(normalized_key))

    def list_objects(
        self,
        *,
        prefix: str,
        limit: int,
        cursor: str | None = None,
    ) -> KnowledgeFSObjectList:
        """List logical keys using a stable lexical cursor and portable metadata."""
        normalized_prefix = _normalize_prefix(prefix)
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= _MAX_LIST_LIMIT:
            raise KnowledgeFSObjectStorageInvalidInputError("list limit must be between 1 and 100")
        normalized_cursor = _normalize_key(cursor) if cursor is not None else None
        if normalized_cursor is not None and not normalized_cursor.startswith(normalized_prefix):
            raise KnowledgeFSObjectStorageInvalidInputError("list cursor must be within prefix")

        try:
            physical_paths = self._backend.scan(
                _physical_scan_prefix(normalized_prefix),
                files=True,
                directories=False,
            )
        except FileNotFoundError:
            physical_paths = []
        except NotImplementedError as exc:
            raise KnowledgeFSObjectStorageUnavailableError(
                "configured Dify storage backend does not support object listing"
            ) from exc
        except Exception as exc:
            raise KnowledgeFSObjectStorageUnavailableError("Dify storage listing failed") from exc

        data_prefix = f"{_DATA_ROOT}/"
        logical_keys = sorted(
            {
                physical_path[len(data_prefix) :]
                for physical_path in physical_paths
                if physical_path.startswith(data_prefix)
                and physical_path[len(data_prefix) :].startswith(normalized_prefix)
                and (normalized_cursor is None or physical_path[len(data_prefix) :] > normalized_cursor)
            }
        )
        page_keys = logical_keys[: limit + 1]
        has_more = len(page_keys) > limit
        objects: list[KnowledgeFSObjectMetadata] = []
        for logical_key in page_keys[:limit]:
            metadata = self.head_object(key=logical_key)
            if metadata is not None:
                objects.append(metadata)
        next_cursor = objects[-1].key if has_more and objects else None
        return KnowledgeFSObjectList(objects=tuple(objects), next_cursor=next_cursor)

    def health(self) -> bool:
        """Check the portable list capability without scanning the object namespace."""
        try:
            self._backend.scan(_HEALTH_SCAN_ROOT, files=True, directories=False)
        except FileNotFoundError:
            return True
        except Exception:
            return False
        return True


def _normalize_key(value: str) -> str:
    if not isinstance(value, str):
        raise KnowledgeFSObjectStorageInvalidInputError("object key must be a string")
    normalized = value.strip()
    segments = normalized.split("/")
    if (
        not normalized
        or normalized.startswith("/")
        or "\\" in normalized
        or "\x00" in normalized
        or any(segment in {"", ".", ".."} for segment in segments)
        or len(normalized.encode()) > _MAX_KEY_BYTES
    ):
        raise KnowledgeFSObjectStorageInvalidInputError("object key is invalid")
    return normalized


def _normalize_prefix(value: str) -> str:
    if value == "":
        return value
    normalized = value.strip()
    candidate = normalized.removesuffix("/")
    _normalize_key(candidate)
    return normalized


def _normalize_metadata(metadata: Mapping[str, str]) -> dict[str, str]:
    if len(metadata) > _MAX_METADATA_ENTRIES:
        raise KnowledgeFSObjectStorageInvalidInputError("object metadata has too many entries")
    normalized: dict[str, str] = {}
    for key, value in metadata.items():
        if (
            not isinstance(key, str)
            or not isinstance(value, str)
            or not key
            or len(key.encode()) > _MAX_METADATA_KEY_BYTES
            or len(value.encode()) > _MAX_METADATA_VALUE_BYTES
        ):
            raise KnowledgeFSObjectStorageInvalidInputError("object metadata is invalid")
        normalized[key] = value
    return normalized


def _normalize_content_type(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized or len(normalized) > 255 or "\r" in normalized or "\n" in normalized:
        raise KnowledgeFSObjectStorageInvalidInputError("object content type is invalid")
    return normalized


def _normalize_checksum(value: str) -> str:
    try:
        decoded = b64decode(value, validate=True)
    except ValueError as exc:
        raise KnowledgeFSObjectStorageInvalidInputError("object checksum is invalid") from exc
    if len(decoded) != 32 or b64encode(decoded).decode() != value:
        raise KnowledgeFSObjectStorageInvalidInputError("object checksum is invalid")
    return value


def _data_path(key: str) -> str:
    return f"{_DATA_ROOT}/{key}"


def _metadata_path(key: str) -> str:
    digest = sha256(key.encode()).hexdigest()
    return f"{_METADATA_ROOT}/{digest[:2]}/{digest[2:4]}/{digest}.json"


def _physical_scan_prefix(prefix: str) -> str:
    parent = prefix.rstrip("/").rpartition("/")[0]
    return f"{_DATA_ROOT}/{parent}" if parent else _DATA_ROOT


def _encode_metadata(metadata: KnowledgeFSObjectMetadata) -> bytes:
    payload: _StoredMetadataPayload = {
        "checksum_sha256_base64": metadata.checksum_sha256_base64,
        "content_type": metadata.content_type,
        "key": metadata.key,
        "metadata": dict(metadata.metadata),
        "size_bytes": metadata.size_bytes,
        "version": 1,
    }
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()


def _decode_metadata(encoded: bytes) -> KnowledgeFSObjectMetadata:
    try:
        payload = json.loads(encoded)
        if not isinstance(payload, dict) or payload.get("version") != 1:
            raise ValueError
        key = _normalize_key(payload["key"])
        checksum = _normalize_checksum(payload["checksum_sha256_base64"])
        content_type = _normalize_content_type(payload["content_type"])
        metadata = _normalize_metadata(payload["metadata"])
        size_bytes = payload["size_bytes"]
        if not isinstance(size_bytes, int) or isinstance(size_bytes, bool) or size_bytes < 0:
            raise ValueError
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise KnowledgeFSObjectStorageCorruptError("object metadata sidecar is invalid") from exc
    return KnowledgeFSObjectMetadata(
        checksum_sha256_base64=checksum,
        content_type=content_type,
        key=key,
        metadata=metadata,
        size_bytes=size_bytes,
    )
