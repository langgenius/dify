"""Bounded, tenant-scoped annotation persistence returning detached records."""

from collections.abc import Sequence
from itertools import batched
from typing import override
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import delete, exists, func, or_, select
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from libs.helper import escape_like_pattern
from libs.pagination import paginate_query
from models.dataset import Dataset, DatasetCollectionBinding
from models.enums import AppStatus, CollectionBindingType
from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, Message, MessageAnnotation
from repositories.app.console_repository import find_console_app
from services.annotation_command_service import (
    AnnotationDeletionResult,
    AnnotationIndexWritePlan,
    AnnotationSettingNotFoundError,
    AnnotationWriteResult,
    AnnotationWriteStore,
)
from services.annotation_import_service import (
    AnnotationImportChangedError,
    AnnotationImportEntry,
    AnnotationImportPlan,
    AnnotationImportRecord,
    AnnotationImportStore,
)
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
from services.annotation_reply_service import (
    AnnotationIndexBinding,
    AnnotationIndexEntry,
    AnnotationReplyChangedError,
    AnnotationReplyDisablePlan,
    AnnotationReplyEnablePlan,
    AnnotationReplyRevision,
    AnnotationReplyStore,
)
from services.errors.message import MessageNotExistsError


class AnnotationRepository(AnnotationQuery, AnnotationWriteStore, AnnotationReplyStore, AnnotationImportStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def require_app(self, *, tenant_id: str, app_id: str) -> None:
        with self._session_factory() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)

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
            return self._setting_record(session, setting)

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
    def create(
        self, *, tenant_id: str, app_id: str, account_id: str, question: str, answer: str
    ) -> AnnotationWriteResult:
        with self._session_factory.begin() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            annotation = MessageAnnotation(app_id=app_id, question=question, content=answer, account_id=account_id)
            session.add(annotation)
            session.flush()
            return AnnotationWriteResult(
                annotation=self._record(annotation), collection_binding_id=self._binding_id(session, app_id=app_id)
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

    @override
    def update_setting(
        self, *, tenant_id: str, app_id: str, setting_id: str, account_id: str, score_threshold: float
    ) -> AnnotationSettingRecord:
        with self._session_factory.begin() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            setting = session.scalar(
                select(AppAnnotationSetting).where(
                    AppAnnotationSetting.app_id == app_id, AppAnnotationSetting.id == setting_id
                )
            )
            if setting is None:
                raise AnnotationSettingNotFoundError(f"Annotation setting {setting_id} is unavailable for app {app_id}")
            setting.score_threshold = score_threshold
            setting.updated_user_id = account_id
            setting.updated_at = naive_utc_now()
            session.flush()
            return self._setting_record(session, setting)

    @override
    def prepare_index_write(
        self, *, tenant_id: str, app_id: str, annotation_id: str, collection_binding_id: str
    ) -> AnnotationIndexWritePlan | None:
        with self._session_factory() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            annotation = session.scalar(
                select(MessageAnnotation).where(
                    MessageAnnotation.id == annotation_id, MessageAnnotation.app_id == app_id
                )
            )
            if annotation is None or self._binding_id(session, app_id=app_id) != collection_binding_id:
                return None
            binding = self._annotation_binding(session, binding_id=collection_binding_id)
            if binding is None:
                raise AnnotationSettingNotFoundError(
                    f"Annotation collection binding {collection_binding_id} is unavailable for app {app_id}"
                )
            return AnnotationIndexWritePlan(
                binding=self._index_binding(binding), question=annotation.question or "", content=annotation.content
            )

    @override
    def prepare_index_delete(
        self, *, tenant_id: str, app_id: str, annotation_id: str, collection_binding_id: str
    ) -> AnnotationIndexBinding | None:
        with self._session_factory() as session:
            # Disabling the app must not prevent already queued index cleanup.
            # After app deletion, a separate cleanup path must retain the owner reference.
            if session.scalar(select(App.id).where(App.id == app_id, App.tenant_id == tenant_id)) is None:
                raise AnnotationAppNotFoundError(f"App {app_id} is unavailable in workspace {tenant_id}")
            # SQL deletion precedes dispatch; an existing ID may now belong to
            # another app or a restored row and must not have its index removed.
            if session.get(MessageAnnotation, annotation_id) is not None:
                return None
            # The queued collection may no longer be the app's active setting.
            binding = self._annotation_binding(session, binding_id=collection_binding_id)
            if binding is None:
                raise AnnotationSettingNotFoundError(
                    f"Annotation collection binding {collection_binding_id} is unavailable for app {app_id}"
                )
            return self._index_binding(binding)

    @override
    def prepare_enable_reply(
        self, *, tenant_id: str, app_id: str, provider_name: str, model_name: str
    ) -> AnnotationReplyEnablePlan:
        with self._session_factory() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            binding = session.scalar(
                select(DatasetCollectionBinding)
                .where(
                    DatasetCollectionBinding.provider_name == provider_name,
                    DatasetCollectionBinding.model_name == model_name,
                    DatasetCollectionBinding.type == CollectionBindingType.ANNOTATION,
                )
                .order_by(DatasetCollectionBinding.created_at)
                .limit(1)
            )
            target = (
                self._index_binding(binding)
                if binding is not None
                else AnnotationIndexBinding(
                    id=str(uuid4()),
                    provider_name=provider_name,
                    model_name=model_name,
                    collection_name=Dataset.gen_collection_name_by_id(str(uuid4())),
                )
            )
            setting = session.scalar(select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).limit(1))
            previous_binding = None
            if setting is not None and setting.collection_binding_id != target.id:
                previous = self._annotation_binding(session, binding_id=setting.collection_binding_id)
                if previous is None:
                    raise AnnotationSettingNotFoundError(
                        f"Annotation collection binding {setting.collection_binding_id} is unavailable for app {app_id}"
                    )
                previous_binding = self._index_binding(previous)
            annotations = session.scalars(select(MessageAnnotation).where(MessageAnnotation.app_id == app_id))
            return AnnotationReplyEnablePlan(
                tenant_id=tenant_id,
                app_id=app_id,
                revision=self._reply_revision(setting) if setting is not None else None,
                binding=target,
                binding_is_new=binding is None,
                previous_binding=previous_binding,
                annotations=tuple(
                    AnnotationIndexEntry(id=annotation.id, question=annotation.question_text)
                    for annotation in annotations
                ),
            )

    @override
    def complete_enable_reply(
        self, *, plan: AnnotationReplyEnablePlan, account_id: str, score_threshold: float
    ) -> None:
        with self._session_factory.begin() as session:
            self._lock_app(session, tenant_id=plan.tenant_id, app_id=plan.app_id)
            setting = self._require_reply_revision(
                session, app_id=plan.app_id, revision=plan.revision, allow_missing=False
            )
            binding = session.get(DatasetCollectionBinding, plan.binding.id)
            if binding is None:
                if not plan.binding_is_new:
                    raise AnnotationReplyChangedError(
                        f"Annotation collection binding {plan.binding.id} disappeared during indexing"
                    )
                binding = DatasetCollectionBinding(
                    provider_name=plan.binding.provider_name,
                    model_name=plan.binding.model_name,
                    collection_name=plan.binding.collection_name,
                    type=CollectionBindingType.ANNOTATION,
                )
                binding.id = plan.binding.id
                session.add(binding)
            elif binding.type != CollectionBindingType.ANNOTATION or self._index_binding(binding) != plan.binding:
                raise AnnotationReplyChangedError(
                    f"Annotation collection binding {plan.binding.id} changed during indexing"
                )
            if setting is None:
                session.add(
                    AppAnnotationSetting(
                        app_id=plan.app_id,
                        score_threshold=score_threshold,
                        collection_binding_id=plan.binding.id,
                        created_user_id=account_id,
                        updated_user_id=account_id,
                    )
                )
            else:
                setting.score_threshold = score_threshold
                setting.collection_binding_id = plan.binding.id
                setting.updated_user_id = account_id
                setting.updated_at = naive_utc_now()

    @override
    def prepare_disable_reply(self, *, tenant_id: str, app_id: str) -> AnnotationReplyDisablePlan | None:
        with self._session_factory() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            setting = session.scalar(select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).limit(1))
            if setting is None:
                return None
            binding = self._annotation_binding(session, binding_id=setting.collection_binding_id)
            return AnnotationReplyDisablePlan(
                tenant_id=tenant_id,
                app_id=app_id,
                revision=self._reply_revision(setting),
                binding=self._index_binding(binding) if binding is not None else None,
                has_annotations=bool(session.scalar(select(exists().where(MessageAnnotation.app_id == app_id)))),
            )

    @override
    def complete_disable_reply(self, *, plan: AnnotationReplyDisablePlan) -> None:
        with self._session_factory.begin() as session:
            self._lock_app(session, tenant_id=plan.tenant_id, app_id=plan.app_id)
            setting = self._require_reply_revision(
                session, app_id=plan.app_id, revision=plan.revision, allow_missing=True
            )
            if setting is not None:
                session.delete(setting)

    @override
    def prepare_import(
        self,
        *,
        tenant_id: str,
        app_id: str,
        job_id: str,
        account_id: str,
        records: Sequence[AnnotationImportRecord],
    ) -> AnnotationImportPlan | None:
        entries = tuple(
            AnnotationImportEntry(
                id=str(uuid5(NAMESPACE_URL, f"dify/annotation-import/{tenant_id}/{app_id}/{job_id}/{index}")),
                question=record["question"],
                answer=record["answer"],
            )
            for index, record in enumerate(records)
        )
        with self._session_factory() as session:
            self._require_app(session, tenant_id=tenant_id, app_id=app_id)
            if self._import_already_completed(session, app_id=app_id, account_id=account_id, entries=entries):
                return None
            setting = session.scalar(select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).limit(1))
            binding = None
            if setting is not None:
                binding = self._annotation_binding(session, binding_id=setting.collection_binding_id)
                if binding is None:
                    raise AnnotationSettingNotFoundError(
                        f"Annotation collection binding {setting.collection_binding_id} is unavailable for app {app_id}"
                    )
            return AnnotationImportPlan(
                tenant_id=tenant_id,
                app_id=app_id,
                account_id=account_id,
                revision=self._reply_revision(setting) if setting is not None else None,
                binding=self._index_binding(binding) if binding is not None else None,
                entries=entries,
            )

    @override
    def complete_import(self, *, plan: AnnotationImportPlan) -> None:
        with self._session_factory.begin() as session:
            self._lock_app(session, tenant_id=plan.tenant_id, app_id=plan.app_id)
            if self._import_already_completed(
                session, app_id=plan.app_id, account_id=plan.account_id, entries=plan.entries
            ):
                return
            try:
                self._require_reply_revision(session, app_id=plan.app_id, revision=plan.revision, allow_missing=False)
            except AnnotationReplyChangedError as error:
                raise AnnotationImportChangedError(str(error)) from error
            if plan.binding is not None:
                binding = self._annotation_binding(session, binding_id=plan.binding.id)
                if binding is None or self._index_binding(binding) != plan.binding:
                    raise AnnotationImportChangedError(
                        f"Annotation collection binding {plan.binding.id} changed during import"
                    )
            for entry in plan.entries:
                annotation = MessageAnnotation(
                    app_id=plan.app_id,
                    account_id=plan.account_id,
                    question=entry.question,
                    content=entry.answer,
                )
                annotation.id = entry.id
                session.add(annotation)

    @staticmethod
    def _import_already_completed(
        session: Session, *, app_id: str, account_id: str, entries: Sequence[AnnotationImportEntry]
    ) -> bool:
        # The row IDs survive a lost Redis completion acknowledgement. Do not
        # compare content: users may have edited successfully imported rows.
        # TODO: A durable job receipt is needed to distinguish a new batch from
        # a completed batch whose rows have all subsequently been deleted.
        found = 0
        for batch in batched(tuple(entry.id for entry in entries), 500):
            annotations = session.execute(
                select(MessageAnnotation.app_id, MessageAnnotation.account_id).where(MessageAnnotation.id.in_(batch))
            )
            for annotation in annotations:
                if annotation.app_id != app_id or annotation.account_id != account_id:
                    raise AnnotationImportChangedError(f"Imported annotations have changed ownership for app {app_id}")
                found += 1
        if found and found != len(entries):
            raise AnnotationImportChangedError(f"Some imported annotations have been removed from app {app_id}")
        return bool(entries) and found == len(entries)

    @staticmethod
    def _index_binding(binding: DatasetCollectionBinding) -> AnnotationIndexBinding:
        return AnnotationIndexBinding(
            id=binding.id,
            provider_name=binding.provider_name,
            model_name=binding.model_name,
            collection_name=binding.collection_name,
        )

    @staticmethod
    def _annotation_binding(session: Session, *, binding_id: str) -> DatasetCollectionBinding | None:
        return session.scalar(
            select(DatasetCollectionBinding).where(
                DatasetCollectionBinding.id == binding_id,
                DatasetCollectionBinding.type == CollectionBindingType.ANNOTATION,
            )
        )

    @staticmethod
    def _reply_revision(setting: AppAnnotationSetting) -> AnnotationReplyRevision:
        return AnnotationReplyRevision(
            id=setting.id,
            collection_binding_id=setting.collection_binding_id,
        )

    @classmethod
    def _require_reply_revision(
        cls, session: Session, *, app_id: str, revision: AnnotationReplyRevision | None, allow_missing: bool
    ) -> AppAnnotationSetting | None:
        setting = session.scalar(
            select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).limit(1).with_for_update()
        )
        if setting is None and allow_missing:
            return None
        current = cls._reply_revision(setting) if setting is not None else None
        if current != revision:
            raise AnnotationReplyChangedError(f"Annotation reply settings for app {app_id} changed during indexing")
        return setting

    @staticmethod
    def _lock_app(session: Session, *, tenant_id: str, app_id: str) -> None:
        # A setting may not exist yet, so lock the parent to serialize worker
        # completions for this app, including concurrent first-time enables.
        found_app_id = session.scalar(
            select(App.id)
            .where(App.id == app_id, App.tenant_id == tenant_id, App.status == AppStatus.NORMAL)
            .with_for_update()
        )
        if found_app_id is None:
            raise AnnotationAppNotFoundError(f"App {app_id} is unavailable in workspace {tenant_id}")

    @staticmethod
    def _setting_record(session: Session, setting: AppAnnotationSetting) -> AnnotationSettingRecord:
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
