import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from extensions.ext_database import db
from models.dataset import Dataset, DatasetCollectionBinding
from models.enums import CollectionBindingType, ConversationFromSource
from models.model import App, AppAnnotationSetting, Message, MessageAnnotation
from services.annotation_service import AppAnnotationService
from services.dataset_service import DatasetCollectionBindingService

logger = logging.getLogger(__name__)


class AnnotationReplyFeature:
    def query(
        self,
        app_record: App,
        message: Message,
        query: str,
        user_id: str,
        invoke_from: InvokeFrom,
        *,
        session: Session | None = None,
    ) -> MessageAnnotation | None:
        """Return the closest annotation reply and record a hit in ``session``.

        The caller may provide its transaction so the setting lookup, annotation
        lookup, and hit-history write share one session. Runtime callers that do
        not provide one continue to use Flask-SQLAlchemy's scoped session.
        Vector-search failures are logged and return ``None``; transaction
        cleanup remains the caller's responsibility.
        """
        if session is None:
            session = db.session()

        stmt = select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_record.id)
        annotation_setting = session.scalar(stmt)

        if not annotation_setting:
            return None

        collection_binding_detail = session.get(DatasetCollectionBinding, annotation_setting.collection_binding_id)

        if not collection_binding_detail:
            return None

        try:
            score_threshold = annotation_setting.score_threshold or 1
            embedding_provider_name = collection_binding_detail.provider_name
            embedding_model_name = collection_binding_detail.model_name

            dataset_collection_binding = DatasetCollectionBindingService.get_dataset_collection_binding(
                embedding_provider_name, embedding_model_name, session, CollectionBindingType.ANNOTATION
            )

            dataset = Dataset(
                id=app_record.id,
                tenant_id=app_record.tenant_id,
                indexing_technique=IndexTechniqueType.HIGH_QUALITY,
                embedding_model_provider=embedding_provider_name,
                embedding_model=embedding_model_name,
                collection_binding_id=dataset_collection_binding.id,
            )

            vector = Vector(dataset, attributes=["doc_id", "annotation_id", "app_id"])

            documents = vector.search_by_vector(
                query=query, top_k=1, score_threshold=score_threshold, filter={"group_id": [dataset.id]}
            )

            if documents and documents[0].metadata:
                annotation_id = documents[0].metadata["annotation_id"]
                score = documents[0].metadata["score"]
                annotation = AppAnnotationService.get_annotation_by_id(annotation_id, session=session)
                if annotation:
                    if invoke_from in {InvokeFrom.SERVICE_API, InvokeFrom.WEB_APP}:
                        from_source = ConversationFromSource.API
                    else:
                        from_source = ConversationFromSource.CONSOLE

                    # insert annotation history
                    AppAnnotationService.add_annotation_history(
                        annotation.id,
                        app_record.id,
                        annotation.question_text,
                        annotation.content,
                        query,
                        user_id,
                        message.id,
                        from_source,
                        score,
                        session=session,
                    )

                    return annotation
        except Exception as e:
            logger.warning("Query annotation failed, exception: %s.", str(e))
            return None

        return None
