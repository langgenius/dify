from sqlalchemy import select
from sqlalchemy.orm import Session

from models import ToolFile, UploadFile

from .models import File


def get_upload_file(*, session: Session, file: File):
    if file.related_id is None:
        raise ValueError("Missing file related_id")
    stmt = select(UploadFile).filter(
        UploadFile.id == file.related_id,
        UploadFile.tenant_id == file.tenant_id,
    )
    record = session.scalar(stmt)
    if not record:
        raise ValueError(f"upload file {file.related_id} not found")
    return record


def get_tool_file(*, session: Session, file: File):
    if file.related_id is None:
        raise ValueError("Missing file related_id")
    stmt = select(ToolFile).filter(
        ToolFile.id == file.related_id,
        ToolFile.tenant_id == file.tenant_id,
    )
    record = session.scalar(stmt)
    if not record:
        raise ValueError(f"tool file {file.related_id} not found")
    return record
