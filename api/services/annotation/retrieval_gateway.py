"""Vector adapter; its inputs are resolved before any embedding or backend I/O."""

from core.rag.datasource.vdb.vector_factory import Vector
from models.annotation_reply import AnnotationMatch, AnnotationSearch


class AnnotationVectorRetrieval:
    def search(self, context: AnnotationSearch, query: str) -> AnnotationMatch | None:
        vector = Vector(
            context.dataset,
            attributes=["doc_id", "annotation_id", "app_id"],
            session=None,
            configuration=context.configuration,
        )
        documents = vector.search_by_vector(
            query=query,
            top_k=1,
            score_threshold=context.score_threshold,
            filter={"group_id": [context.dataset.id]},
        )
        if not documents or not documents[0].metadata:
            return None
        metadata = documents[0].metadata
        return AnnotationMatch(annotation_id=metadata["annotation_id"], score=metadata["score"])
