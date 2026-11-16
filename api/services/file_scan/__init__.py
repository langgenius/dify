"""Malware scanning of stored files, shared by every product module.

A module adopts scanning in three steps:

1. Pick a scope type (``ScanScope("dataset", dataset_id)``) and expose
   ``FileScanPolicyService`` behind its own settings route, guarded by its own permissions.
2. Call ``FileScanService().scan_upload_file(...)`` before it first reads an uploaded file, and
   stop when ``outcome.allowed`` is false.
3. Call ``FileScanPolicyService().delete_scope(...)`` when the resource is deleted.
"""

from services.file_scan.entities import ScanErrorCode, ScanOutcome, ScanPolicy, ScanScope
from services.file_scan.errors import (
    FileScanBlockedError,
    FileScanError,
    FileScanProviderInUseError,
    FileScanProviderNotFoundError,
    FileScanValidationError,
)
from services.file_scan.file_scan_service import FileScanService
from services.file_scan.policy_service import FileScanPolicyService
from services.file_scan.provider_service import FileScanProviderService

__all__ = [
    "FileScanBlockedError",
    "FileScanError",
    "FileScanPolicyService",
    "FileScanProviderInUseError",
    "FileScanProviderNotFoundError",
    "FileScanProviderService",
    "FileScanService",
    "FileScanValidationError",
    "ScanErrorCode",
    "ScanOutcome",
    "ScanPolicy",
    "ScanScope",
]
