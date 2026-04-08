from enum import StrEnum

from packaging import version
from pydantic import BaseModel, Field

from core.plugin.entities.plugin import PluginDependency


class ImportMode(StrEnum):
    YAML_CONTENT = "yaml-content"
    YAML_URL = "yaml-url"


class ImportStatus(StrEnum):
    COMPLETED = "completed"
    COMPLETED_WITH_WARNINGS = "completed-with-warnings"
    PENDING = "pending"
    FAILED = "failed"


class CheckDependenciesResult(BaseModel):
    leaked_dependencies: list[PluginDependency] = Field(default_factory=list)


def check_version_compatibility(imported_version: str, current_dsl_version: str) -> ImportStatus:
    """Determine import status based on version comparison"""
    try:
        current_ver = version.parse(current_dsl_version)
        imported_ver = version.parse(imported_version)
    except version.InvalidVersion:
        return ImportStatus.FAILED

    # If imported version is newer than current, always return PENDING
    if imported_ver > current_ver:
        return ImportStatus.PENDING

    # If imported version is older than current's major, return PENDING
    if imported_ver.major < current_ver.major:
        return ImportStatus.PENDING

    # If imported version is older than current's minor, return COMPLETED_WITH_WARNINGS
    if imported_ver.minor < current_ver.minor:
        return ImportStatus.COMPLETED_WITH_WARNINGS

    # If imported version equals or is older than current's micro, return COMPLETED
    return ImportStatus.COMPLETED
