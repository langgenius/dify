from packaging import version

from services.entities.dsl_entities import ImportStatus


def check_version_compatibility(imported_version: str, current_version: str) -> ImportStatus:
    """Determine DSL import status based on imported and current versions."""
    try:
        current_ver = version.parse(current_version)
        imported_ver = version.parse(imported_version)
    except version.InvalidVersion:
        return ImportStatus.FAILED

    if imported_ver > current_ver:
        return ImportStatus.PENDING
    if imported_ver.major < current_ver.major:
        return ImportStatus.PENDING
    if imported_ver.minor < current_ver.minor:
        return ImportStatus.COMPLETED_WITH_WARNINGS
    return ImportStatus.COMPLETED
