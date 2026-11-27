"""Framework-free BYOA content and authorized file ports.

Only a file returned by the admitted storage port is trusted downstream. External
IDs, URLs and dictionaries never become Dify file references by themselves.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Protocol

type JsonValue = None | bool | int | float | str | list[JsonValue] | dict[str, JsonValue]
type JsonObject = dict[str, JsonValue]


class ExternalIOError(ValueError):
    """A bounded input/output operation failed without replaying remote work."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True, kw_only=True)
class FileScope:
    """Admitted owner; lease_id is absent for production non-test materialization."""

    tenant_id: str
    app_id: str | None
    actor_id: str
    invocation_id: str
    actor_role: Literal["account", "end_user"] = "account"
    lease_id: str | None = None
    granted_upload_file_ids: frozenset[str] = frozenset()
    granted_tool_file_ids: frozenset[str] = frozenset()
    io_deadline: datetime | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class FileReference:
    """Reference requiring owner authorization; never contains an external URL."""

    file_id: str
    kind: Literal["upload", "tool", "datasource"] = "upload"


@dataclass(frozen=True, slots=True, kw_only=True)
class FileBlob:
    """Authorized bytes; data is excluded from diagnostic representations."""

    filename: str
    media_type: str
    data: bytes = field(repr=False)


@dataclass(frozen=True, slots=True, kw_only=True)
class StoredFile:
    """Durable trusted value returned by storage, not by a remote agent."""

    file_id: str
    value: JsonObject
    size: int
    media_type: str


@dataclass(frozen=True, slots=True, kw_only=True)
class FileWriteReservation:
    """Server-owned planned upload; its cleanup intent precedes storage I/O."""

    file_id: str
    storage_key: str = field(repr=False)
    existing: StoredFile | None = None


class InputFileReaderPort(Protocol):
    def read_authorized(self, scope: FileScope, reference: FileReference, *, max_bytes: int) -> FileBlob:
        """Authorize complete owner chain and return bounded bytes or raise ExternalIOError."""
        ...


class OutputFileStorePort(Protocol):
    def store(self, scope: FileScope, blob: FileBlob, *, artifact_id: str, part_index: int) -> StoredFile:
        """Check deletion/lease gate, persist bytes and provenance, return trusted File.

        Must deduplicate (scope.invocation_id, artifact_id, part_index), honor
        parent/test expiry and forbid rematerialization after deletion. Storage
        failures do not publish partial output sets to the workflow.
        """
        ...


class OutputFileMaterializerPort(Protocol):
    def materialize(
        self, scope: FileScope, part: JsonObject, *, artifact_id: str, part_index: int, max_bytes: int | None = None
    ) -> StoredFile:
        """Safely fetch/decode a validated file Part and durably store it under owner scope."""
        ...


class FileLifecyclePort(Protocol):
    """Parent/test deletion and unique materialization binding, owned by persistence.

    All operations verify tenant/app-or-test/invocation ownership. record_stored
    atomically checks lease/tombstone and a unique (invocation,artifact,part)
    key, returning the existing winner on concurrent duplication. Revoked or
    expired scopes must fail even if an old stored binding is still readable.
    """

    def ensure_access(self, scope: FileScope) -> None: ...

    def ensure_input_access(self, scope: FileScope, reference: FileReference) -> None:
        """Check the consumer and any BYOA temporary producer before/after storage I/O.

        Ordinary shared originals keep the existing file-access policy. A
        revoked temporary source must not be laundered through a new grant.
        """
        ...

    def find_stored(self, scope: FileScope, *, artifact_id: str, part_index: int) -> StoredFile | None: ...

    def prepare_stored(
        self, scope: FileScope, blob: FileBlob, *, artifact_id: str, part_index: int, file_id: str, storage_key: str
    ) -> FileWriteReservation:
        """Persist a unique planned receipt before upload; re-entry reuses the owned plan."""
        ...

    def abort_stored(self, scope: FileScope, *, artifact_id: str, part_index: int, file_id: str) -> None:
        """Acknowledge failed writer I/O has ended, after attempting owned compensation."""
        ...

    def record_stored(self, scope: FileScope, *, artifact_id: str, part_index: int, file: StoredFile) -> StoredFile: ...


@dataclass(frozen=True, slots=True, kw_only=True)
class OutputField:
    """Frozen output declaration. default is significant only when has_default is true.

    integer is an internal JSON-schema validation alias, not another public
    BYOA output type. The Console surface continues to expose its frozen types.
    """

    name: str
    kind: Literal["string", "number", "integer", "boolean", "object", "array", "file"]
    required: bool = True
    children: tuple["OutputField", ...] = ()
    item: "OutputField | None" = None
    has_default: bool = False
    default: JsonValue = None


@dataclass(frozen=True, slots=True, kw_only=True)
class OutputMappingResult:
    """Only declared validated values, ready for one atomic downstream publication."""

    values: JsonObject
    defaults_applied: tuple[str, ...] = ()
