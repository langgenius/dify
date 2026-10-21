"""Deployment gate for destructive upload-file cleanup."""

from configs import dify_config


class FilePhysicalCleanupDisabledError(RuntimeError):
    """Raised when a cleaner reaches storage I/O after the gate closes."""


def physical_file_cleanup_enabled() -> bool:
    return dify_config.ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP


def assert_physical_file_cleanup_enabled() -> None:
    if not physical_file_cleanup_enabled():
        raise FilePhysicalCleanupDisabledError("Upload-file physical cleanup is disabled by the deployment gate")
