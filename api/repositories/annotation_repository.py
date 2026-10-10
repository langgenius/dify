"""Bounded, tenant-scoped annotation reads returning detached records."""

from typing import override

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, sessionmaker

from libs.helper import escape_like_pattern
from libs.pagination import paginate_query
from models.dataset import DatasetCollectionBinding
from models.enums import AppStatus
from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, MessageAnnotation
from repositories.app.console_repository import find_console_app
from services.annotation_query import (
    AnnotationAppNotFoundError,
    AnnotationEmbeddingModel,
    AnnotationHitHistoryRecord,
    AnnotationNotFoundError,
    AnnotationPage,
    AnnotationQuery,
    AnnotationRecord,
    AnnotationSettingRecord,
)


class AnnotationRepository(AnnotationQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def count(self, *, tenant_id: str, app_id: str) -> int:
        with self._session_factory() as session:
            # Only count previously used Console's hidden-app gate; the other
            # annotation reads retain their tenant/app/status-only visibility.
            if find_console_app(session, workspace_id=tenant_id, app_id=app_id) is None:
                raise AnnotationAppNotFoundError(f"App {app_id} is unavailable in workspace {tenant_id}")
            return (
                session.scalar(
                    select(func.count()).select_from(MessageAnnotation).where(MessageAnnotation.app_id == app_id)
                )
                or 0
            )

    @override
    def get_page(
        self, *, tenant_id: str, app_id: str, page: int, limit: int, keyword: str
    ) -> AnnotationPage[AnnotationRecord]:
        with self._session_factory() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            statement = select(MessageAnnotation).where(MessageAnnotation.app_id == app_id)
            if keyword:
                pattern = f"%{escape_like_pattern(keyword)}%"
                statement = statement.where(
                    or_(
                        MessageAnnotation.question.ilike(pattern, escape="\\"),
                        MessageAnnotation.content.ilike(pattern, escape="\\"),
                    )
                )
            statement = statement.order_by(MessageAnnotation.created_at.desc(), MessageAnnotation.id.desc())
            result = paginate_query(statement, session=session, page=page, per_page=limit, max_per_page=100)
            return AnnotationPage(
                data=tuple(
                    AnnotationRecord(
                        id=annotation.id,
                        question=annotation.question,
                        content=annotation.content,
                        hit_count=annotation.hit_count,
                        created_at=annotation.created_at,
                    )
                    for annotation in result.items
                ),
                page=result.page,
                limit=result.per_page,
                total=result.total,
            )

    @override
    def get_all(self, *, tenant_id: str, app_id: str) -> tuple[AnnotationRecord, ...]:
        with self._session_factory() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            annotations = session.scalars(
                select(MessageAnnotation)
                .where(MessageAnnotation.app_id == app_id)
                .order_by(MessageAnnotation.created_at.desc())
            )
            return tuple(
                AnnotationRecord(
                    id=annotation.id,
                    question=annotation.question,
                    content=annotation.content,
                    hit_count=annotation.hit_count,
                    created_at=annotation.created_at,
                )
                for annotation in annotations
            )

    @override
    def get_setting(self, *, tenant_id: str, app_id: str) -> AnnotationSettingRecord:
        with self._session_factory() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            setting = session.scalar(select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).limit(1))
            if setting is None:
                return AnnotationSettingRecord(enabled=False, id=None, score_threshold=None, embedding_model=None)
            binding = session.get(DatasetCollectionBinding, setting.collection_binding_id)
            return AnnotationSettingRecord(
                enabled=True,
                id=setting.id,
                score_threshold=setting.score_threshold,
                embedding_model=AnnotationEmbeddingModel(
                    embedding_provider_name=binding.provider_name if binding is not None else None,
                    embedding_model_name=binding.model_name if binding is not None else None,
                ),
            )

    @override
    def get_hit_history_page(
        self, *, tenant_id: str, app_id: str, annotation_id: str, page: int, limit: int
    ) -> AnnotationPage[AnnotationHitHistoryRecord]:
        with self._session_factory() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            annotation = session.scalar(
                select(MessageAnnotation.id).where(
                    MessageAnnotation.id == annotation_id, MessageAnnotation.app_id == app_id
                )
            )
            if annotation is None:
                raise AnnotationNotFoundError(f"Annotation {annotation_id} is unavailable for app {app_id}")
            statement = (
                select(AppAnnotationHitHistory)
                .where(AppAnnotationHitHistory.app_id == app_id, AppAnnotationHitHistory.annotation_id == annotation_id)
                .order_by(AppAnnotationHitHistory.created_at.desc())
            )
            result = paginate_query(statement, session=session, page=page, per_page=limit, max_per_page=100)
            return AnnotationPage(
                data=tuple(
                    AnnotationHitHistoryRecord(
                        id=history.id,
                        source=history.source,
                        score=history.score,
                        question=history.question,
                        created_at=history.created_at,
                        annotation_question=history.annotation_question,
                        annotation_content=history.annotation_content,
                    )
                    for history in result.items
                ),
                page=result.page,
                limit=result.per_page,
                total=result.total,
            )

    @staticmethod
    def _require_app(session: Session, *, tenant_id: str, app_id: str) -> None:
        if (
            session.scalar(
                select(App.id).where(App.id == app_id, App.tenant_id == tenant_id, App.status == AppStatus.NORMAL)
            )
            is None
        ):
            raise AnnotationAppNotFoundError(f"App {app_id} is unavailable in workspace {tenant_id}")
