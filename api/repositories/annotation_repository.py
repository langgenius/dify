"""Bounded, tenant-scoped annotation persistence returning detached records."""

from collections.abc import Sequence
from itertools import batched
from typing import override

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session, sessionmaker

from libs.helper import escape_like_pattern
from libs.pagination import paginate_query
from models.dataset import DatasetCollectionBinding
from models.enums import AppStatus
from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, Message, MessageAnnotation
from repositories.app.console_repository import find_console_app
from services.annotation_command_service import AnnotationDeletionResult, AnnotationWriteResult, AnnotationWriteStore
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
from services.errors.message import MessageNotExistsError


class AnnotationRepository(AnnotationQuery, AnnotationWriteStore):
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
                data=tuple(self._record(annotation) for annotation in result.items),
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
            return tuple(self._record(annotation) for annotation in annotations)

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

    @override
    def upsert(
        self,
        *,
        tenant_id: str,
        app_id: str,
        account_id: str,
        message_id: str | None,
        question: str | None,
        answer: str | None,
    ) -> AnnotationWriteResult:
        with self._session_factory.begin() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            if answer is None:
                raise ValueError("Either 'answer' or 'content' must be provided")
            if message_id:
                message = session.scalar(select(Message).where(Message.id == message_id, Message.app_id == app_id))
                if message is None:
                    raise MessageNotExistsError("Message Not Exists.")
                question = question or message.query or ""
                annotation = session.scalar(
                    select(MessageAnnotation)
                    .where(MessageAnnotation.message_id == message.id, MessageAnnotation.app_id == app_id)
                    .limit(1)
                )
                if annotation is None:
                    annotation = MessageAnnotation(
                        app_id=app_id,
                        conversation_id=message.conversation_id,
                        message_id=message.id,
                        question=question,
                        content=answer,
                        account_id=account_id,
                    )
                else:
                    annotation.question = question
                    annotation.content = answer
            else:
                if not question:
                    raise ValueError("'question' is required when 'message_id' is not provided")
                annotation = MessageAnnotation(app_id=app_id, question=question, content=answer, account_id=account_id)
            session.add(annotation)
            session.flush()
            return AnnotationWriteResult(
                annotation=self._record(annotation), collection_binding_id=self._binding_id(session, app_id=app_id)
            )

    @override
    def update(
        self, *, tenant_id: str, app_id: str, annotation_id: str, question: str | None, answer: str | None
    ) -> AnnotationWriteResult:
        with self._session_factory.begin() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            annotation = self._require_annotation(session, app_id=app_id, annotation_id=annotation_id)
            if question is None:
                raise ValueError("'question' is required")
            if answer is None:
                raise ValueError("'answer' is required")
            annotation.question = question
            annotation.content = answer
            session.flush()
            return AnnotationWriteResult(
                annotation=self._record(annotation), collection_binding_id=self._binding_id(session, app_id=app_id)
            )

    @override
    def delete(self, *, tenant_id: str, app_id: str, annotation_id: str) -> str | None:
        with self._session_factory.begin() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            annotation = self._require_annotation(session, app_id=app_id, annotation_id=annotation_id)
            session.execute(
                delete(AppAnnotationHitHistory).where(
                    AppAnnotationHitHistory.app_id == app_id, AppAnnotationHitHistory.annotation_id == annotation_id
                )
            )
            session.delete(annotation)
            return self._binding_id(session, app_id=app_id)

    @override
    def delete_many(self, *, tenant_id: str, app_id: str, annotation_ids: Sequence[str]) -> AnnotationDeletionResult:
        with self._session_factory.begin() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            matching_ids: list[str] = []
            for batch in batched(dict.fromkeys(annotation_ids), 500):
                matching_ids.extend(
                    session.scalars(
                        select(MessageAnnotation.id).where(
                            MessageAnnotation.app_id == app_id, MessageAnnotation.id.in_(batch)
                        )
                    )
                )
            self._delete_annotations(session, app_id=app_id, annotation_ids=matching_ids)
            return AnnotationDeletionResult(
                annotation_ids=tuple(matching_ids), collection_binding_id=self._binding_id(session, app_id=app_id)
            )

    @override
    def clear(self, *, tenant_id: str, app_id: str) -> AnnotationDeletionResult:
        with self._session_factory.begin() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            annotation_ids = tuple(
                session.scalars(select(MessageAnnotation.id).where(MessageAnnotation.app_id == app_id))
            )
            self._delete_annotations(session, app_id=app_id, annotation_ids=annotation_ids)
            return AnnotationDeletionResult(
                annotation_ids=annotation_ids, collection_binding_id=self._binding_id(session, app_id=app_id)
            )

    @staticmethod
    def _delete_annotations(session: Session, *, app_id: str, annotation_ids: Sequence[str]) -> None:
        # Bound SQL parameters without splitting the annotation/history transaction.
        for batch in batched(annotation_ids, 500):
            session.execute(
                delete(AppAnnotationHitHistory).where(
                    AppAnnotationHitHistory.app_id == app_id, AppAnnotationHitHistory.annotation_id.in_(batch)
                )
            )
            session.execute(
                delete(MessageAnnotation).where(MessageAnnotation.app_id == app_id, MessageAnnotation.id.in_(batch))
            )

    @staticmethod
    def _record(annotation: MessageAnnotation) -> AnnotationRecord:
        return AnnotationRecord(
            id=annotation.id,
            question=annotation.question,
            content=annotation.content,
            hit_count=annotation.hit_count,
            created_at=annotation.created_at,
        )

    @staticmethod
    def _binding_id(session: Session, *, app_id: str) -> str | None:
        return session.scalar(
            select(AppAnnotationSetting.collection_binding_id).where(AppAnnotationSetting.app_id == app_id).limit(1)
        )

    @staticmethod
    def _require_annotation(session: Session, *, app_id: str, annotation_id: str) -> MessageAnnotation:
        annotation = session.scalar(
            select(MessageAnnotation).where(MessageAnnotation.id == annotation_id, MessageAnnotation.app_id == app_id)
        )
        if annotation is None:
            raise AnnotationNotFoundError(f"Annotation {annotation_id} is unavailable for app {app_id}")
        return annotation

    @staticmethod
    def _require_app(session: Session, *, tenant_id: str, app_id: str) -> None:
        if (
            session.scalar(
                select(App.id).where(App.id == app_id, App.tenant_id == tenant_id, App.status == AppStatus.NORMAL)
            )
            is None
        ):
            raise AnnotationAppNotFoundError(f"App {app_id} is unavailable in workspace {tenant_id}")
