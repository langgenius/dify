"""Short, tenant-scoped transactions for annotation reply configuration and hits."""

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from models.annotation_reply import AnnotationMatch, AnnotationReply, AnnotationSearch
from models.dataset import Dataset, DatasetCollectionBinding
from models.enums import ConversationFromSource
from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, Message, MessageAnnotation
from repositories.knowledge.vector_configuration_repository import resolve_vector_configuration


class AnnotationReplyRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def prepare(self, *, tenant_id: str, app_id: str) -> AnnotationSearch | None:
        with self._sessions() as session:
            setting = session.scalar(
                select(AppAnnotationSetting)
                .join(App, App.id == AppAnnotationSetting.app_id)
                .where(App.id == app_id, App.tenant_id == tenant_id)
            )
            if setting is None:
                return None
            binding = session.get(DatasetCollectionBinding, setting.collection_binding_id)
            if binding is None:
                return None
            dataset = Dataset(
                id=app_id,
                tenant_id=tenant_id,
                indexing_technique=IndexTechniqueType.HIGH_QUALITY,
                embedding_model_provider=binding.provider_name,
                embedding_model=binding.model_name,
                collection_binding_id=binding.id,
            )
            return AnnotationSearch(
                dataset,
                resolve_vector_configuration(dataset, session=session),
                setting.id,
                setting.score_threshold if setting.score_threshold is not None else 1,
            )

    def record_hit(
        self,
        search: AnnotationSearch,
        match: AnnotationMatch,
        *,
        message_id: str,
        query: str,
        user_id: str,
        from_source: ConversationFromSource,
    ) -> AnnotationReply | None:
        with self._sessions.begin() as session:
            # Revalidate the configuration and ownership after the external search.
            setting = session.scalar(
                select(AppAnnotationSetting)
                .join(App, App.id == AppAnnotationSetting.app_id)
                .where(
                    App.id == search.dataset.id,
                    App.tenant_id == search.dataset.tenant_id,
                    AppAnnotationSetting.id == search.setting_id,
                    AppAnnotationSetting.collection_binding_id == search.dataset.collection_binding_id,
                )
            )
            message_exists = session.scalar(
                select(Message.id).where(Message.id == message_id, Message.app_id == search.dataset.id)
            )
            if setting is None or message_exists is None:
                return None
            annotation = session.scalar(
                select(MessageAnnotation)
                .where(MessageAnnotation.id == match.annotation_id, MessageAnnotation.app_id == search.dataset.id)
                .with_for_update()
            )
            if annotation is None:
                return None
            annotation.hit_count += 1
            session.add(
                AppAnnotationHitHistory(
                    annotation_id=annotation.id,
                    app_id=search.dataset.id,
                    account_id=user_id,
                    question=query,
                    source=from_source,
                    score=match.score,
                    message_id=message_id,
                    annotation_question=annotation.question_text,
                    annotation_content=annotation.content,
                )
            )
            return AnnotationReply(annotation.id, annotation.content)
