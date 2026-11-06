"""Vector adapter; its inputs are resolved before any embedding or backend I/O."""

from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from models.annotation_reply import AnnotationMatch, AnnotationSearch
from models.dataset import Dataset


class AnnotationVectorRetrieval:
    def search(self, context: AnnotationSearch, query: str) -> AnnotationMatch | None:
        """Search resolved values without a DB session, returning the best match or None.

        The legacy vector API's Dataset is constructed only inside this adapter;
        embedding and backend errors propagate to the optional-reply service.
        """
        dataset = Dataset(
            id=context.app_id,
            tenant_id=context.tenant_id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            embedding_model_provider=context.embedding_model_provider,
            embedding_model=context.embedding_model,
            collection_binding_id=context.collection_binding_id,
        )
        vector = Vector(
            dataset,
            attributes=["doc_id", "annotation_id", "app_id"],
            session=None,
            configuration=context.configuration,
        )
        documents = vector.search_by_vector(
            query=query,
            top_k=1,
            score_threshold=context.score_threshold,
            filter={"group_id": [context.app_id]},
        )
        if not documents or not documents[0].metadata:
            return None
        metadata = documents[0].metadata
        return AnnotationMatch(annotation_id=metadata["annotation_id"], score=metadata["score"])
