import logging

from sqlalchemy import select

from core.app.entities.app_invoke_entities import InvokeFrom
from core.rag.datasource.vdb.vector_factory import Vector
from extensions.ext_database import db
from models.dataset import Dataset
from models.model import App, AppAnnotationSetting, Message, MessageAnnotation
from services.annotation_service import AppAnnotationService
from services.dataset_service import DatasetCollectionBindingService

logger = logging.getLogger(__name__)


class AnnotationReplyFeature:
    def query(
        self, app_record: App, message: Message, query: str, user_id: str, invoke_from: InvokeFrom
    ) -> MessageAnnotation | None:
        """
        Query app annotations to reply
        :param app_record: app record
        :param message: message
        :param query: query
        :param user_id: user id
        :param invoke_from: invoke from
        :return:
        """
        stmt = select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_record.id)
        annotation_setting = db.session.scalar(stmt)

        if not annotation_setting:
            return None

        collection_binding_detail = annotation_setting.collection_binding_detail

        if not collection_binding_detail:
            return None

        try:
            score_threshold = annotation_setting.score_threshold or 1
            embedding_provider_name = collection_binding_detail.provider_name
            embedding_model_name = collection_binding_detail.model_name

            dataset_collection_binding = DatasetCollectionBindingService.get_dataset_collection_binding(
                embedding_provider_name, embedding_model_name, "annotation"
            )

            dataset = Dataset(
                id=app_record.id,
                tenant_id=app_record.tenant_id,
                indexing_technique="high_quality",
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
                annotation = AppAnnotationService.get_annotation_by_id(annotation_id)
                if annotation:
                    if invoke_from in {InvokeFrom.SERVICE_API, InvokeFrom.WEB_APP}:
                        from_source = "api"
                    else:
                        from_source = "console"

                    # insert annotation history
                    AppAnnotationService.add_annotation_history(
                        annotation.id,
                        app_record.id,
                        annotation.question,
                        annotation.content,
                        query,
                        user_id,
                        message.id,
                        from_source,
                        score,
                    )

                    return annotation
        except Exception as e:
            logger.warning("Query annotation failed, exception: %s.", str(e))
            return None

        return None
