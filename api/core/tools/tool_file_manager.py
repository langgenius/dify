import base64
import hashlib
import hmac
import logging
import os
import time
import urllib.parse
from collections.abc import Generator
from mimetypes import guess_extension, guess_type
from typing import Protocol
from uuid import uuid4

import httpx
from sqlalchemy import select

from configs import dify_config
from core.db.session_factory import session_factory
from core.file import remote_fetcher
from core.workflow.file_reference import build_file_reference
from extensions.ext_storage import storage
from graphon.file import File, FileTransferMethod, get_file_type_by_mime_type

# init tool_file_parser
from graphon.file.tool_file_parser import set_tool_file_manager_factory
from models.model import MessageFile
from models.tools import ToolFile

logger = logging.getLogger(__name__)


class ToolFileStorage(Protocol):
    """Storage operations required by ``ToolFileManager``."""

    def save(self, filename: str, data: bytes) -> None:
        """Persist ``data`` under a writable ``filename`` key.

        Preconditions: ``filename`` names a key accepted by the backend and
        ``data`` is the complete byte payload. Postconditions: successful calls
        make the payload available under that key. Side effects: writes storage.
        Failure invariant: backend errors propagate, and this protocol makes no
        atomic-write guarantee; a failed write may leave partial stored data.
        """
        ...

    def load_once(self, filename: str) -> bytes:
        """Read the complete payload stored under ``filename``.

        Preconditions: ``filename`` names an existing key accepted by the backend.
        Postconditions: successful calls return the stored bytes without mutation.
        Side effects: reads storage only. Failure invariant: missing-key/backend
        errors propagate and do not modify the stored object.
        """
        ...

    def load_stream(self, filename: str) -> Generator:
        """Read the payload under ``filename`` as a lazy byte stream.

        Preconditions: ``filename`` names an existing key accepted by the backend.
        Postconditions: successful iteration yields the stored bytes without mutation.
        Side effects: reads storage only. Failure invariant: backend errors propagate
        during iteration and do not modify the stored object.
        """
        ...


class ToolFileManager:
    def __init__(self, *, storage_service: ToolFileStorage | None = None) -> None:
        """Bind a storage service for all file operations.

        Preconditions: an explicitly supplied service implements ``ToolFileStorage``.
        Postconditions: this manager uses that service, or the configured global
        storage when no service is supplied. Construction performs no I/O.
        Failure behavior: construction does not catch or transform errors.
        """
        self._storage_service: ToolFileStorage = storage_service if storage_service is not None else storage

    @staticmethod
    def _build_graph_file_reference(tool_file: ToolFile) -> File:
        extension = resolve_extension(filename=tool_file.name, mimetype=tool_file.mimetype)
        return File(
            file_type=get_file_type_by_mime_type(tool_file.mimetype),
            transfer_method=FileTransferMethod.TOOL_FILE,
            remote_url=tool_file.original_url,
            reference=build_file_reference(record_id=str(tool_file.id)),
            filename=tool_file.name,
            extension=extension,
            mime_type=tool_file.mimetype,
            size=tool_file.size,
            storage_key=tool_file.file_key,
        )

    @staticmethod
    def sign_file(tool_file_id: str, extension: str) -> str:
        """
        sign file to get a temporary url for plugin access
        """
        # Use internal URL for plugin/tool file access in Docker environments
        base_url = dify_config.INTERNAL_FILES_URL or dify_config.FILES_URL
        file_preview_url = f"{base_url}/files/tools/{tool_file_id}{extension}"

        timestamp = str(int(time.time()))
        nonce = os.urandom(16).hex()
        data_to_sign = f"file-preview|{tool_file_id}|{timestamp}|{nonce}"
        sign = hmac.new(
            dify_config.SECRET_KEY.encode(),
            data_to_sign.encode(),
            hashlib.sha256,
        ).digest()
        encoded_sign = base64.urlsafe_b64encode(sign).decode()

        return f"{file_preview_url}?timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}"

    def create_file_by_raw(
        self,
        *,
        user_id: str,
        tenant_id: str,
        conversation_id: str | None,
        file_binary: bytes,
        mimetype: str,
        filename: str | None = None,
    ) -> ToolFile:
        """Persist raw file bytes and return the committed tool-file row.

        Preconditions: the identifiers describe the file owner and ``file_binary``
        contains the complete payload. Postconditions: bytes are written through
        this manager's storage service and the matching row is persisted. Failures
        propagate; a database failure after storage succeeds can leave orphaned bytes.
        """
        extension = resolve_extension(filename=filename, mimetype=mimetype)
        unique_name = uuid4().hex
        unique_filename = f"{unique_name}{extension}"
        # default just as before
        present_filename = unique_filename
        if filename is not None:
            has_extension = len(filename.split(".")) > 1
            # Add extension flexibly
            present_filename = filename if has_extension else f"{filename}{extension}"
        filepath = f"tools/{tenant_id}/{unique_filename}"
        self._storage_service.save(filepath, file_binary)

        with session_factory.create_session() as session:
            tool_file = ToolFile(
                user_id=user_id,
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                file_key=filepath,
                mimetype=mimetype,
                name=present_filename,
                size=len(file_binary),
                original_url=None,
            )

            session.add(tool_file)
            session.commit()
            session.refresh(tool_file)

        return tool_file

    def create_file_by_url(
        self,
        user_id: str,
        tenant_id: str,
        file_url: str,
        conversation_id: str | None = None,
    ) -> ToolFile:
        """Download a remote file, persist its bytes, and return its row.

        Preconditions: ``file_url`` is an input accepted by the existing remote
        fetcher. Postconditions: downloaded bytes and their metadata row are stored
        using this manager's storage service. Fetch, storage, and database failures
        propagate (timeouts retain the existing ``ValueError`` behavior); a database
        failure after storage succeeds can leave orphaned bytes.
        """
        # try to download image
        try:
            response = remote_fetcher.make_request("GET", file_url)
            response.raise_for_status()
            blob = response.content
        except httpx.TimeoutException as caught_error:
            raise ValueError(f"timeout when downloading file from {file_url}") from caught_error

        mimetype = (
            guess_type(file_url)[0]
            or response.headers.get("Content-Type", "").split(";")[0].strip()
            or "application/octet-stream"
        )
        url_filename = os.path.basename(urllib.parse.urlparse(file_url).path)
        extension = resolve_extension(filename=url_filename, mimetype=mimetype)
        unique_name = uuid4().hex
        filename = f"{unique_name}{extension}"
        filepath = f"tools/{tenant_id}/{filename}"
        self._storage_service.save(filepath, blob)
        with session_factory.create_session() as session:
            tool_file = ToolFile(
                user_id=user_id,
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                file_key=filepath,
                mimetype=mimetype,
                original_url=file_url,
                name=filename,
                size=len(blob),
            )

            session.add(tool_file)
            session.commit()
            session.refresh(tool_file)

        return tool_file

    def get_file_binary(self, id: str) -> tuple[bytes, str] | None:
        """Read bytes and MIME type using any string ``id`` as a lookup key.

        Preconditions: ``id`` is a string; the referenced row need not exist.
        Postconditions: a missing tool-file row returns ``None``; otherwise the
        stored bytes and row MIME type are returned. Side effects: database and
        storage access are read-only; persistent state is unchanged on success.
        Failure behavior: database or storage errors propagate unchanged without
        changing persistent state.
        """
        with session_factory.create_session() as session:
            tool_file: ToolFile | None = session.scalar(select(ToolFile).where(ToolFile.id == id).limit(1))

        if not tool_file:
            return None

        blob = self._storage_service.load_once(tool_file.file_key)

        return blob, tool_file.mimetype

    def get_file_binary_by_message_file_id(self, id: str) -> tuple[bytes, str] | None:
        """Read bytes and MIME type using any string ``id`` as a message lookup key.

        Preconditions: ``id`` is a string; the referenced message need not exist.
        Postconditions: a missing message, a message without a URL, or a missing
        referenced tool-file row returns ``None``; otherwise its bytes and MIME type
        are returned. Side effects: database and storage access are read-only;
        persistent state is unchanged on success. Failure behavior: database or
        storage errors propagate unchanged without changing persistent state.
        """
        with session_factory.create_session() as session:
            message_file: MessageFile | None = session.scalar(select(MessageFile).where(MessageFile.id == id).limit(1))

            # Check if message_file is not None
            if message_file is not None:
                # get tool file id
                if message_file.url is not None:
                    tool_file_id = message_file.url.split("/")[-1]
                    # trim extension
                    tool_file_id = tool_file_id.split(".")[0]
                else:
                    tool_file_id = None
            else:
                tool_file_id = None

            tool_file: ToolFile | None = session.scalar(select(ToolFile).where(ToolFile.id == tool_file_id).limit(1))

        if not tool_file:
            return None

        blob = self._storage_service.load_once(tool_file.file_key)

        return blob, tool_file.mimetype

    def get_file_generator_by_tool_file_id(self, tool_file_id: str) -> tuple[Generator | None, File | None]:
        """Return a file stream and graph reference using any string key.

        Preconditions: ``tool_file_id`` is a string; the referenced row need not
        exist. Postconditions: a missing tool-file row returns ``(None, None)``;
        otherwise a lazy stream and metadata built from the persisted row are
        returned. Side effects: database and storage access are read-only; persistent
        state is unchanged on success. Failure behavior: database errors propagate,
        and storage errors may propagate while opening or consuming the stream;
        failures do not change persistent state.
        """
        with session_factory.create_session() as session:
            tool_file: ToolFile | None = session.scalar(select(ToolFile).where(ToolFile.id == tool_file_id).limit(1))

        if not tool_file:
            return None, None

        stream = self._storage_service.load_stream(tool_file.file_key)

        return stream, self._build_graph_file_reference(tool_file)


def _factory() -> ToolFileManager:
    return ToolFileManager()


def resolve_extension(*, filename: str | None, mimetype: str) -> str:
    filename_extension = os.path.splitext(filename or "")[1].lower()
    if filename_extension:
        return filename_extension
    return guess_extension(mimetype) or ".bin"


set_tool_file_manager_factory(_factory)
