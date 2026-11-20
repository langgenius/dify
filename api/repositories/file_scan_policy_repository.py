"""SQLAlchemy writes for file-scan policies."""

from sqlalchemy import delete
from sqlalchemy.orm import Session

from models.file_scan import FileScanPolicy


def delete_file_scan_policy(
    session: Session,
    *,
    tenant_id: str,
    scope_type: str,
    scope_id: str,
) -> None:
    """Delete one resource's policy inside the caller's transaction."""
    session.execute(
        delete(FileScanPolicy).where(
            FileScanPolicy.tenant_id == tenant_id,
            FileScanPolicy.scope_type == scope_type,
            FileScanPolicy.scope_id == scope_id,
        )
    )
