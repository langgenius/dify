"""Adapt detached annotation inputs to the existing vector runtime.

The annotation transaction is closed before backend initialization or embedding.
TODO: Migrate the embedding cache and backend-owned legacy sessions separately;
this boundary does not change their internal database/provider access.
"""

import json
import logging

from sqlalchemy.orm import Session, sessionmaker

from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.models.document import Document
from models.dataset import Dataset
from services.annotation_command_service import AnnotationSettingNotFoundError
from services.annotation_reply_service import AnnotationIndexBinding, AnnotationIndexEntry, AnnotationMatchCandidate

logger = logging.getLogger(__name__)


class AnnotationVectorIndex:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def search(
        self, *, tenant_id: str, app_id: str, binding: AnnotationIndexBinding, query: str, score_threshold: float
    ) -> AnnotationMatchCandidate | None:
        documents = self._vector(tenant_id=tenant_id, app_id=app_id, binding=binding).search_by_vector(
            query=query, top_k=1, score_threshold=score_threshold, filter={"group_id": [app_id]}
        )
        if not documents or not documents[0].metadata:
            return None
        metadata = documents[0].metadata
        annotation_id = metadata.get("annotation_id")
        score = metadata.get("score")
        if not isinstance(annotation_id, str) or not isinstance(score, (int, float)):
            return None
        return AnnotationMatchCandidate(annotation_id=annotation_id, score=float(score))

    def add(
        self, *, tenant_id: str, app_id: str, binding: AnnotationIndexBinding, entries: tuple[AnnotationIndexEntry, ...]
    ) -> None:
        self._vector(tenant_id=tenant_id, app_id=app_id, binding=binding).create(
            [
                Document(
                    page_content=entry.question,
                    metadata={"annotation_id": entry.id, "app_id": app_id, "doc_id": entry.id},
                )
                for entry in entries
            ],
            duplicate_check=True,
        )

    def replace(
        self, *, tenant_id: str, app_id: str, binding: AnnotationIndexBinding, entry: AnnotationIndexEntry
    ) -> None:
        vector = self._vector(tenant_id=tenant_id, app_id=app_id, binding=binding)
        vector.delete_by_metadata_field("annotation_id", entry.id)
        vector.add_texts(
            [
                Document(
                    page_content=entry.question,
                    metadata={"annotation_id": entry.id, "app_id": app_id, "doc_id": entry.id},
                )
            ]
        )

    def remove(self, *, tenant_id: str, app_id: str, binding: AnnotationIndexBinding, annotation_id: str) -> None:
        self._vector(tenant_id=tenant_id, app_id=app_id, binding=binding).delete_by_metadata_field(
            "annotation_id", annotation_id
        )

    def rebuild(
        self, *, tenant_id: str, app_id: str, binding: AnnotationIndexBinding, entries: tuple[AnnotationIndexEntry, ...]
    ) -> None:
        vector = self._vector(tenant_id=tenant_id, app_id=app_id, binding=binding)
        try:
            vector.delete_by_metadata_field("app_id", app_id)
        except Exception:
            logger.exception("Cannot clear annotation index for app %s in tenant %s", app_id, tenant_id)
        vector.create(
            [
                Document(
                    page_content=entry.question,
                    metadata={"annotation_id": entry.id, "app_id": app_id, "doc_id": entry.id},
                )
                for entry in entries
            ]
        )

    def delete(self, *, tenant_id: str, app_id: str, binding: AnnotationIndexBinding | None) -> None:
        self._vector(tenant_id=tenant_id, app_id=app_id, binding=binding).delete()

    def _vector(self, *, tenant_id: str, app_id: str, binding: AnnotationIndexBinding | None) -> Vector:
        dataset, vector_type = self._prepare(tenant_id=tenant_id, app_id=app_id, binding=binding)
        return Vector(dataset, attributes=["doc_id", "annotation_id", "app_id"], session=None, vector_type=vector_type)

    def _prepare(self, *, tenant_id: str, app_id: str, binding: AnnotationIndexBinding | None) -> tuple[Dataset, str]:
        dataset = Dataset(
            id=app_id,
            tenant_id=tenant_id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            embedding_model_provider=binding.provider_name if binding is not None else None,
            embedding_model=binding.model_name if binding is not None else None,
        )
        # Backend selection may read the tenant whitelist, but construction can
        # connect to remote services and must happen after this session closes.
        with self._session_factory() as session:
            vector_type = Vector.resolve_vector_type(dataset, session=session)
        if vector_type == VectorType.QDRANT:
            if binding is None:
                raise AnnotationSettingNotFoundError(f"Annotation collection binding is unavailable for app {app_id}")
            # Qdrant alone uses shared binding collections. Pre-resolve its name
            # without collection_binding_id, which would reopen global db.session.
            # Other backends retain their existing app-ID-based collection names.
            dataset.index_struct = json.dumps(
                {"type": vector_type, "vector_store": {"class_prefix": binding.collection_name}}
            )
        return dataset, vector_type
