"""Application boundary for Console API-based extension management."""

from collections.abc import Sequence
from datetime import datetime
from typing import NamedTuple, Protocol

from machinery.context import RequestContext

_MIN_API_KEY_LENGTH = 5


class APIBasedExtensionRecord(NamedTuple):
    """One API-based extension of a workspace.

    The store persists and returns ``api_key`` as ciphertext; the application service
    hands callers the plaintext key.
    """

    id: str
    name: str
    api_endpoint: str
    api_key: str
    created_at: datetime


class APIBasedExtensionInput(NamedTuple):
    """Field values for creating an extension; ``api_key`` is plaintext."""

    name: str
    api_endpoint: str
    api_key: str


class APIBasedExtensionUpdate(NamedTuple):
    """Field edits for an extension; a ``None`` ``api_key`` keeps the stored key."""

    name: str
    api_endpoint: str
    api_key: str | None


class APIBasedExtensionStore(Protocol):
    """Persistence for API-based extensions, always scoped by workspace."""

    def list_extensions(self, workspace_id: str) -> Sequence[APIBasedExtensionRecord]: ...

    def find_extension(self, workspace_id: str, extension_id: str) -> APIBasedExtensionRecord | None: ...

    def name_exists(self, workspace_id: str, name: str, *, exclude_id: str | None = None) -> bool: ...

    def create_extension(self, workspace_id: str, extension: APIBasedExtensionInput) -> APIBasedExtensionRecord:
        """Insert a new extension; ``extension.api_key`` is already ciphertext."""
        ...

    def update_extension(
        self, workspace_id: str, extension_id: str, extension: APIBasedExtensionInput
    ) -> APIBasedExtensionRecord:
        """Overwrite all editable fields; raise ``APIBasedExtensionNotFoundError`` if absent from this scope."""
        ...

    def delete_extension(self, workspace_id: str, extension_id: str) -> None:
        """Delete the extension; raise ``APIBasedExtensionNotFoundError`` if absent from this scope."""
        ...


class APIBasedExtensionSecretCipher(Protocol):
    """Workspace-scoped encryption for stored API keys."""

    def encrypt(self, workspace_id: str, value: str) -> str: ...

    def decrypt(self, workspace_id: str, value: str) -> str: ...


class APIBasedExtensionEndpointProbe(Protocol):
    """Verifies that an extension endpoint answers the ``ping`` extension point."""

    def ping(self, api_endpoint: str, api_key: str) -> None:
        """Return normally when the endpoint answers ``pong``; raise ``APIBasedExtensionConnectionError`` otherwise."""
        ...


class APIBasedExtensionError(Exception):
    """Base class for framework-neutral API-based extension failures."""


class APIBasedExtensionNotFoundError(APIBasedExtensionError):
    def __init__(self) -> None:
        super().__init__("API based extension is not found")


class APIBasedExtensionNameConflictError(APIBasedExtensionError):
    def __init__(self) -> None:
        super().__init__("name must be unique, it is already existed")


class APIBasedExtensionInvalidError(APIBasedExtensionError):
    """A field value does not satisfy the extension contract."""


class APIBasedExtensionConnectionError(APIBasedExtensionError):
    def __init__(self, reason: str) -> None:
        super().__init__(f"connection error: {reason}")


class APIBasedExtensionApplicationService:
    """Owns the extension rules: non-empty fields, a workspace-unique name, a key of at least five
    characters, an endpoint that answers ``ping``, and keys stored only as ciphertext."""

    def __init__(
        self,
        *,
        extensions: APIBasedExtensionStore,
        secrets: APIBasedExtensionSecretCipher,
        probe: APIBasedExtensionEndpointProbe,
    ) -> None:
        self._extensions = extensions
        self._secrets = secrets
        self._probe = probe

    def list_extensions(self, context: RequestContext) -> tuple[APIBasedExtensionRecord, ...]:
        workspace_id = context.active_workspace_id
        return tuple(
            self._with_plaintext_key(workspace_id, record) for record in self._extensions.list_extensions(workspace_id)
        )

    def get_extension(self, context: RequestContext, extension_id: str) -> APIBasedExtensionRecord:
        workspace_id = context.active_workspace_id
        return self._with_plaintext_key(workspace_id, self._require_extension(workspace_id, extension_id))

    def create_extension(self, context: RequestContext, extension: APIBasedExtensionInput) -> APIBasedExtensionRecord:
        workspace_id = context.active_workspace_id
        self._validate(workspace_id, extension, exclude_id=None)
        stored = self._extensions.create_extension(
            workspace_id,
            extension._replace(api_key=self._secrets.encrypt(workspace_id, extension.api_key)),
        )
        return stored._replace(api_key=extension.api_key)

    def update_extension(
        self, context: RequestContext, extension_id: str, update: APIBasedExtensionUpdate
    ) -> APIBasedExtensionRecord:
        workspace_id = context.active_workspace_id
        current = self._require_extension(workspace_id, extension_id)
        api_key = update.api_key if update.api_key is not None else self._secrets.decrypt(workspace_id, current.api_key)
        extension = APIBasedExtensionInput(name=update.name, api_endpoint=update.api_endpoint, api_key=api_key)
        self._validate(workspace_id, extension, exclude_id=extension_id)
        stored = self._extensions.update_extension(
            workspace_id,
            extension_id,
            extension._replace(api_key=self._secrets.encrypt(workspace_id, api_key)),
        )
        return stored._replace(api_key=api_key)

    def delete_extension(self, context: RequestContext, extension_id: str) -> None:
        # The store raises APIBasedExtensionNotFoundError itself, so no separate existence read is needed.
        self._extensions.delete_extension(context.active_workspace_id, extension_id)

    def _require_extension(self, workspace_id: str, extension_id: str) -> APIBasedExtensionRecord:
        record = self._extensions.find_extension(workspace_id, extension_id)
        if record is None:
            raise APIBasedExtensionNotFoundError
        return record

    def _with_plaintext_key(self, workspace_id: str, record: APIBasedExtensionRecord) -> APIBasedExtensionRecord:
        return record._replace(api_key=self._secrets.decrypt(workspace_id, record.api_key))

    def _validate(self, workspace_id: str, extension: APIBasedExtensionInput, *, exclude_id: str | None) -> None:
        if not extension.name:
            raise APIBasedExtensionInvalidError("name must not be empty")
        if self._extensions.name_exists(workspace_id, extension.name, exclude_id=exclude_id):
            raise APIBasedExtensionNameConflictError
        if not extension.api_endpoint:
            raise APIBasedExtensionInvalidError("api_endpoint must not be empty")
        if not extension.api_key:
            raise APIBasedExtensionInvalidError("api_key must not be empty")
        if len(extension.api_key) < _MIN_API_KEY_LENGTH:
            raise APIBasedExtensionInvalidError(f"api_key must be at least {_MIN_API_KEY_LENGTH} characters")
        self._probe.ping(extension.api_endpoint, extension.api_key)
