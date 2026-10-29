"""Grant execution-local file access only for validated knowledge retrieval results."""

from collections.abc import Sequence

from sqlalchemy.orm import Session

from core.app.file_access import (
    get_current_file_access_scope,
    grant_retriever_segment_access,
    grant_upload_file_access,
)
from models.dataset import DocumentSegment
from models.model import UploadFile
from repositories.knowledge.dataset_read_repository import get_segment_attachment_files, is_retrieved_segment_owned


def authorize_retrieved_segment(
    segment: DocumentSegment, *, tenant_id: str, dataset_ids: Sequence[str], session: Session
) -> Sequence[UploadFile] | None:
    """Authorize the owner chain and attachments before content links are signed.

    A valid segment with no attachments returns an empty sequence; an invalid
    retrieval result returns None and must not be included in the response.
    """
    scope = get_current_file_access_scope()
    if scope is not None and scope.tenant_id != tenant_id:
        return None
    if not is_retrieved_segment_owned(segment, tenant_id=tenant_id, dataset_ids=dataset_ids, session=session):
        return None
    attachments = get_segment_attachment_files(segment, session=session)
    grant_retriever_segment_access([segment.id])
    grant_upload_file_access(file.id for file in attachments)
    return attachments
