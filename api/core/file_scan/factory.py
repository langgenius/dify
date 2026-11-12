from collections.abc import Mapping
from typing import Any

from core.file_scan.base import FileScanner
from core.file_scan.entities import ScanProviderType
from core.file_scan.scanners.api import CustomEndpointScanner
from core.file_scan.scanners.clamav import ClamAVScanner
from core.file_scan.scanners.cloudmersive import CloudmersiveScanner
from core.file_scan.scanners.metadefender import MetaDefenderScanner
from core.file_scan.scanners.scanii import ScaniiScanner

SCANNER_CLASSES: Mapping[ScanProviderType, type[FileScanner]] = {
    ScanProviderType.CLAMAV: ClamAVScanner,
    ScanProviderType.CLOUDMERSIVE: CloudmersiveScanner,
    ScanProviderType.SCANII: ScaniiScanner,
    ScanProviderType.METADEFENDER: MetaDefenderScanner,
    ScanProviderType.API: CustomEndpointScanner,
}
"""Every scanner, in the order the console lists them. Add a scanner by adding a class here."""


def scanner_class(provider_type: ScanProviderType) -> type[FileScanner]:
    return SCANNER_CLASSES[provider_type]


def create_scanner(
    provider_type: ScanProviderType, *, credentials: Mapping[str, str], config: Mapping[str, Any]
) -> FileScanner:
    return SCANNER_CLASSES[provider_type](credentials, config)
