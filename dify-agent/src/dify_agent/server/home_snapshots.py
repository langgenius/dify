"""Stateless application facade for deployment-owned Home Snapshots."""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass

from dify_agent.protocol.home_snapshot import CreateHomeSnapshotRequest, CreateHomeSnapshotResponse
from dify_agent.runtime_backend import (
    CreateHomeSnapshotRequest as DriverCreateHomeSnapshotRequest,
    HomeSnapshotDriver,
    HomeSnapshotFile,
    HomeSnapshotSource,
)
from dify_agent.runtime_backend.errors import HomeSnapshotCreateError, HomeSnapshotNotFoundError


class HomeSnapshotServiceError(RuntimeError):
    """Application error carrying the private route's stable code and status."""

    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class HomeSnapshotService:
    """Translate private API DTOs into stateless Home driver operations.

    The service performs backend I/O but has no database, snapshot catalog, or
    ref mapping. Dify API persists returned refs and decides lifecycle timing;
    the injected driver owns deployment credentials and physical side effects.
    Invalid source data and backend failures are mapped to stable
    ``HomeSnapshotServiceError`` responses.
    """

    driver: HomeSnapshotDriver

    async def create(self, request: CreateHomeSnapshotRequest) -> CreateHomeSnapshotResponse:
        """Decode source files, create one immutable Home, and return its native ref.

        Invalid base64 raises a 400 ``HomeSnapshotServiceError`` without driver
        I/O. Driver creation may allocate remote resources and maps
        ``HomeSnapshotCreateError`` to a 502 service error.
        """
        try:
            files = tuple(
                HomeSnapshotFile(path=item.path, content=base64.b64decode(item.content_base64, validate=True))
                for item in request.files
            )
        except (binascii.Error, ValueError) as exc:
            raise HomeSnapshotServiceError(
                "invalid_home_snapshot_source", "file content_base64 is invalid", status_code=400
            ) from exc
        try:
            snapshot_ref = await self.driver.create(
                DriverCreateHomeSnapshotRequest(
                    tenant_id=request.tenant_id,
                    agent_id=request.agent_id,
                    agent_config_version_id=request.agent_config_version_id,
                    source_digest=request.source_digest,
                    source=HomeSnapshotSource(files=files),
                )
            )
            return CreateHomeSnapshotResponse(snapshot_ref=snapshot_ref)
        except HomeSnapshotCreateError as exc:
            raise HomeSnapshotServiceError("home_snapshot_create_failed", str(exc), status_code=502) from exc

    async def delete(self, snapshot_ref: str) -> None:
        """Delete one backend Home ref without retaining state in this service.

        Not-found is idempotent success. Other driver runtime failures become a
        502 ``HomeSnapshotServiceError`` for the private Dify API caller.
        """
        try:
            await self.driver.delete(snapshot_ref)
        except HomeSnapshotNotFoundError:
            return
        except RuntimeError as exc:
            raise HomeSnapshotServiceError("home_snapshot_delete_failed", str(exc), status_code=502) from exc


__all__ = ["HomeSnapshotService", "HomeSnapshotServiceError"]
