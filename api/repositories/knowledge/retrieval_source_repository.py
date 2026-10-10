"""Minimal document reads for retrieval source citations in a caller-owned session."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, load_only

from models.dataset import Document


def get_retrieval_source_documents(
    *, tenant_id: str, dataset_ids: Sequence[str], document_ids: Sequence[str], session: Session
) -> Sequence[Document]:
    """Read citation fields without loading document processing payloads.

    Other document fields are intentionally unavailable; this read must not grow
    implicit per-document queries when response assembly changes.
    """
    if not dataset_ids or not document_ids:
        return []
    return session.scalars(
        select(Document)
        .where(
            Document.tenant_id == tenant_id,
            Document.dataset_id.in_(set(dataset_ids)),
            Document.id.in_(set(document_ids)),
        )
        .options(
            load_only(
                Document.id,
                Document.tenant_id,
                Document.dataset_id,
                Document.name,
                Document.data_source_type,
                Document.doc_metadata,
                raiseload=True,
            )
        )
    ).all()
