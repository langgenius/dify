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
from repositories.knowledge.dataset_read_repository import (
    get_attachment_files_by_segment,
    get_owned_retrieved_segment_ids,
)


class RetrievedSegmentAccess:
    """Owner chains and attachments of the segments of one retrieval, read together.

    Reading them per segment costs two queries for every retrieved segment. This reads the owner
    chains of all of them once and the attachments of the valid ones once, and grants nothing yet:
    ``authorize`` grants one segment at a time, so a caller that signs content between segments
    works with the same grants as when each segment was read on its own.
    """

    def __init__(
        self, segments: Sequence[DocumentSegment], *, tenant_id: str, dataset_ids: Sequence[str], session: Session
    ) -> None:
        self._attachments: dict[str, list[UploadFile]] = {}
        scope = get_current_file_access_scope()
        if scope is not None and scope.tenant_id != tenant_id:
            return
        owned_ids = get_owned_retrieved_segment_ids(
            segments, tenant_id=tenant_id, dataset_ids=dataset_ids, session=session
        )
        self._attachments = get_attachment_files_by_segment(
            [segment for segment in segments if segment.id in owned_ids], session=session
        )

    def authorize(self, segment: DocumentSegment) -> Sequence[UploadFile] | None:
        """Authorize the owner chain and attachments before content links are signed.

        A valid segment with no attachments returns an empty sequence; an invalid
        retrieval result returns None and must not be included in the response.
        """
        attachments = self._attachments.get(segment.id)
        if attachments is None:
            return None
        grant_retriever_segment_access([segment.id])
        grant_upload_file_access(file.id for file in attachments)
        return attachments
