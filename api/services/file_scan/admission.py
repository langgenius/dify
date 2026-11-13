"""Adapters that let lower layers ask for a scan without importing the scan services."""

from services.file_scan.entities import SCOPE_DATASET, ScanScope
from services.file_scan.file_scan_service import FileScanService


def reject_dataset_upload_file(*, tenant_id: str, dataset_id: str, upload_file_id: str) -> str | None:
    """Scan one uploaded file under a dataset's policy.

    Returns ``None`` when the file may be processed, otherwise the sentence to store as the
    document's error.
    """
    outcome = FileScanService().scan_upload_file(
        tenant_id=tenant_id, upload_file_id=upload_file_id, scope=ScanScope(SCOPE_DATASET, dataset_id)
    )
    return None if outcome.allowed else outcome.describe()
