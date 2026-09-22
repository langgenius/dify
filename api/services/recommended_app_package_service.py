"""Resolve publicly listed Agent templates for direct creation or package download."""

from typing import BinaryIO, NamedTuple, Protocol
from uuid import UUID

from services.recommended_app_query_service import RecommendedAppNotFoundError


class RecommendedAgentPackageSource(NamedTuple):
    tenant_id: str
    agent_id: str
    version_id: UUID


class RecommendedAgentPackageQuery(Protocol):
    def get_package_source(self, app_id: str, version_id: UUID) -> RecommendedAgentPackageSource | None: ...


class AgentPackageDownload(Protocol):
    @property
    def archive(self) -> BinaryIO: ...

    @property
    def filename(self) -> str: ...

    def close(self) -> None: ...


class AgentPackageExporter(Protocol):
    def export(self, *, tenant_id: str, agent_id: str, version_id: UUID | None) -> AgentPackageDownload: ...


class RecommendedAppPackageService:
    def __init__(self, *, sources: RecommendedAgentPackageQuery, exporter: AgentPackageExporter) -> None:
        self._sources = sources
        self._exporter = exporter

    def get_source(self, *, app_id: str, version_id: UUID) -> RecommendedAgentPackageSource:
        source = self._sources.get_package_source(app_id, version_id)
        if source is None:
            raise RecommendedAppNotFoundError
        return source

    def download(self, *, app_id: str, version_id: UUID) -> AgentPackageDownload:
        source = self.get_source(app_id=app_id, version_id=version_id)
        # Resolve template admission and close the read session before export performs storage I/O.
        return self._exporter.export(tenant_id=source.tenant_id, agent_id=source.agent_id, version_id=source.version_id)
