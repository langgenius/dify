"""Authenticated streaming gateway between Sandbox CLI and Home archive store."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterable, AsyncIterator, Awaitable
from dataclasses import dataclass
import logging
from typing import Protocol

from dify_agent.agent_stub.server.tokens.home_snapshot import (
    HOME_SNAPSHOT_SCOPE_READ,
    HOME_SNAPSHOT_SCOPE_WRITE,
    HomeSnapshotTransferScope,
    HomeSnapshotTransferTokenCodec,
    HomeSnapshotTransferTokenError,
)
from dify_agent.runtime_backend.errors import (
    HomeArchiveConflictError,
    HomeArchiveStoreError,
    HomeSnapshotNotFoundError,
)

_ARCHIVE_READ_SIZE = 1024 * 1024
logger = logging.getLogger(__name__)


class AsyncArchiveFile(Protocol):
    """Opened archive stream that its caller must always close or finalize."""

    def read(self, size: int | None = None, /) -> Awaitable[bytes]: ...

    def write(self, data: bytes, /) -> Awaitable[int]: ...

    def close(self) -> Awaitable[None]: ...


class HomeArchiveStore(Protocol):
    """Open immutable archive streams with normalized storage failures.

    Writers must use conditional create-only semantics. An existing object must
    raise ``HomeArchiveConflictError``; providers may surface that conflict from
    ``open_writer()``, ``AsyncArchiveFile.write()``, or
    ``AsyncArchiveFile.close()``. A missing reader object must raise
    ``HomeSnapshotNotFoundError``. All other storage I/O failures must raise
    ``HomeArchiveStoreError``.

    A successful open transfers stream ownership to the caller. The caller must
    close readers and close/finalize writers on success, failure, or cancellation.
    """

    def open_writer(self, snapshot_ref: str, /) -> Awaitable[AsyncArchiveFile]: ...

    def open_reader(self, snapshot_ref: str, /) -> Awaitable[AsyncArchiveFile]: ...


class HomeSnapshotGatewayError(RuntimeError):
    status_code: int
    detail: str

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(slots=True)
class HomeSnapshotGatewayService:
    """Authorize one immutable object and relay bytes without archive parsing."""

    token_codec: HomeSnapshotTransferTokenCodec
    archive_store: HomeArchiveStore

    async def upload(self, *, authorization: str | None, chunks: AsyncIterable[bytes]) -> None:
        principal = self._authorize(authorization, required_scope=HOME_SNAPSHOT_SCOPE_WRITE)
        try:
            writer = await self.archive_store.open_writer(principal.snapshot_ref)
        except HomeArchiveConflictError as exc:
            raise HomeSnapshotGatewayError(409, str(exc)) from exc
        except HomeArchiveStoreError as exc:
            raise HomeSnapshotGatewayError(502, str(exc)) from exc

        primary_error: BaseException | None = None
        try:
            async for chunk in chunks:
                if not chunk:
                    continue
                written = await writer.write(chunk)
                if written != len(chunk):
                    raise HomeArchiveStoreError("Home Snapshot store performed a short write")
        except HomeArchiveConflictError as exc:
            primary_error = exc
            raise HomeSnapshotGatewayError(409, str(exc)) from exc
        except HomeArchiveStoreError as exc:
            primary_error = exc
            raise HomeSnapshotGatewayError(502, str(exc)) from exc
        except BaseException as exc:
            primary_error = exc
            raise
        finally:
            try:
                await writer.close()
            except HomeArchiveConflictError as exc:
                if primary_error is None:
                    raise HomeSnapshotGatewayError(409, str(exc)) from exc
                logger.warning("Home Snapshot archive writer conflicted after upload failed", exc_info=True)
            except HomeArchiveStoreError as exc:
                if primary_error is None:
                    raise HomeSnapshotGatewayError(502, str(exc)) from exc
                logger.warning("failed to close Home Snapshot archive writer after upload failed", exc_info=True)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if primary_error is None:
                    raise HomeSnapshotGatewayError(502, str(exc)) from exc
                logger.warning("failed to close Home Snapshot archive writer after upload failed", exc_info=True)

    async def download(
        self,
        *,
        authorization: str | None,
    ) -> AsyncIterator[bytes]:
        principal = self._authorize(authorization, required_scope=HOME_SNAPSHOT_SCOPE_READ)
        try:
            reader = await self.archive_store.open_reader(principal.snapshot_ref)
        except HomeSnapshotNotFoundError as exc:
            raise HomeSnapshotGatewayError(404, str(exc)) from exc
        except HomeArchiveStoreError as exc:
            raise HomeSnapshotGatewayError(502, str(exc)) from exc
        return self._stream_reader(reader)

    async def _stream_reader(self, reader: AsyncArchiveFile) -> AsyncIterator[bytes]:
        primary_error: BaseException | None = None
        try:
            while chunk := await reader.read(_ARCHIVE_READ_SIZE):
                yield chunk
        except BaseException as exc:
            primary_error = exc
            raise
        finally:
            try:
                await reader.close()
            except BaseException:
                if primary_error is None:
                    raise
                logger.warning("failed to close Home Snapshot archive reader after download failed", exc_info=True)

    def _authorize(
        self,
        authorization: str | None,
        *,
        required_scope: HomeSnapshotTransferScope,
    ):
        try:
            return self.token_codec.decode_authorization_header(
                authorization,
                required_scope=required_scope,
            )
        except HomeSnapshotTransferTokenError as exc:
            raise HomeSnapshotGatewayError(401, str(exc)) from exc


__all__ = [
    "AsyncArchiveFile",
    "HomeArchiveStore",
    "HomeSnapshotGatewayError",
    "HomeSnapshotGatewayService",
]
