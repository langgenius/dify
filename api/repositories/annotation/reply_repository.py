"""Short, tenant-scoped transactions for annotation reply configuration and hits."""

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.datasource.vdb.vector_type import VectorType
from models.annotation_reply import AnnotationMatch, AnnotationReply, AnnotationSearch
from models.dataset import DatasetCollectionBinding
from models.enums import ConversationFromSource
from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, Message, MessageAnnotation
from models.vector import VectorConfiguration
from repositories.knowledge.vector_configuration_repository import resolve_vector_type_for_tenant


class AnnotationReplyRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def prepare(self, *, tenant_id: str, app_id: str) -> AnnotationSearch | None:
        """Read a tenant-owned app's settings into plain search values, then close the session.

        Return None when the settings or binding are absent. Resolve backend
        configuration before returning; configuration failures propagate.
        """
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
            vector_type = resolve_vector_type_for_tenant(tenant_id=tenant_id, session=session)
            return AnnotationSearch(
                tenant_id=tenant_id,
                app_id=app_id,
                embedding_model_provider=binding.provider_name,
                embedding_model=binding.model_name,
                collection_binding_id=binding.id,
                configuration=VectorConfiguration(
                    vector_type=vector_type,
                    collection_name=binding.collection_name if vector_type == VectorType.QDRANT else None,
                ),
                setting_id=setting.id,
                score_threshold=setting.score_threshold if setting.score_threshold is not None else 1,
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
        """Atomically record a hit for the still-owned settings, message, and annotation.

        Accept a previously prepared search and match. Return None without writes
        if settings, binding, or ownership no longer match; otherwise lock the annotation and
        commit its count and history together. Any write failure rolls both back.
        """
        with self._sessions.begin() as session:
            # Revalidate the configuration and ownership after the external search.
            setting = session.scalar(
                select(AppAnnotationSetting)
                .join(App, App.id == AppAnnotationSetting.app_id)
                .where(
                    App.id == search.app_id,
                    App.tenant_id == search.tenant_id,
                    AppAnnotationSetting.id == search.setting_id,
                    AppAnnotationSetting.collection_binding_id == search.collection_binding_id,
                )
            )
            message_exists = session.scalar(
                select(Message.id).where(Message.id == message_id, Message.app_id == search.app_id)
            )
            if setting is None or message_exists is None:
                return None
            annotation = session.scalar(
                select(MessageAnnotation)
                .where(MessageAnnotation.id == match.annotation_id, MessageAnnotation.app_id == search.app_id)
                .with_for_update()
            )
            if annotation is None:
                return None
            annotation.hit_count += 1
            session.add(
                AppAnnotationHitHistory(
                    annotation_id=annotation.id,
                    app_id=search.app_id,
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
