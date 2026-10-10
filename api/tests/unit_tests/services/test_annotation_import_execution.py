"""CSV import execution against real SQLite and vector backend selection."""

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import Connection, event, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import ORMExecuteState, Session, SessionTransaction, sessionmaker

from extensions.ext_application_services import _get_annotation_import_quota
from extensions.ext_redis import RedisClientWrapper
from models.dataset import DatasetCollectionBinding, Whitelist
from models.enums import CollectionBindingType
from models.model import App, AppAnnotationSetting, MessageAnnotation
from repositories.annotation_import_job_repository import RedisAnnotationImportJobRepository
from repositories.annotation_repository import AnnotationRepository
from services.annotation_command_service import AnnotationSettingNotFoundError
from services.annotation_import_service import (
    AnnotationImportChangedError,
    AnnotationImportLimits,
    AnnotationImportPlan,
    AnnotationImportRecord,
    AnnotationImportService,
)
from services.annotation_query import AnnotationAppNotFoundError
from services.annotation_reply_index import AnnotationVectorIndex
from tasks.annotation.batch_import_annotations_task import batch_import_annotations_task
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_app

INVALID_BACKEND = "annotation-test-uninstalled-vector-backend"
RECORDS: tuple[AnnotationImportRecord, ...] = (
    {"question": "Which answer?", "answer": "The first answer"},
    {"question": "Which answer?", "answer": "The second answer"},
)


@dataclass(frozen=True)
class _Harness:
    factory: sessionmaker[Session]
    repository: AnnotationRepository
    service: AnnotationImportService
    app: App
    foreign_app: App
    account_id: str
    job_id: str

    def execute(self, *, records: Sequence[AnnotationImportRecord]) -> None:
        self.service.execute_import(
            tenant_id=self.app.tenant_id,
            app_id=self.app.id,
            job_id=self.job_id,
            account_id=self.account_id,
            records=records,
        )

    def prepare(self) -> AnnotationImportPlan:
        plan = self.repository.prepare_import(
            tenant_id=self.app.tenant_id,
            app_id=self.app.id,
            job_id=self.job_id,
            account_id=self.account_id,
            records=RECORDS,
        )
        assert plan is not None
        return plan


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Harness]:
    app = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()))
    foreign_app = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()))
    with sqlite_session_factory.begin() as session:
        session.add_all([app, foreign_app])
    repository = AnnotationRepository(session_factory=sqlite_session_factory)
    service = AnnotationImportService(
        annotations=repository,
        index=AnnotationVectorIndex(session_factory=sqlite_session_factory),
        jobs=RedisAnnotationImportJobRepository(redis=RedisClientWrapper()),
        publish=batch_import_annotations_task.delay,
        quota=_get_annotation_import_quota,
        limits=AnnotationImportLimits(
            min_records=1, max_records=1000, requests_per_minute=10, requests_per_hour=100, max_concurrent=3
        ),
    )
    with config_overrides_context(VECTOR_STORE=INVALID_BACKEND, VECTOR_STORE_WHITELIST_ENABLE=False):
        yield _Harness(sqlite_session_factory, repository, service, app, foreign_app, str(uuid4()), str(uuid4()))


@pytest.fixture
def binding(harness: _Harness) -> DatasetCollectionBinding:
    binding = DatasetCollectionBinding(
        provider_name="annotation-provider",
        model_name="annotation-embedding",
        type=CollectionBindingType.ANNOTATION,
        collection_name="shared_annotation_collection",
    )
    with harness.factory.begin() as session:
        session.add(binding)
    return binding


@pytest.fixture
def setting(harness: _Harness, binding: DatasetCollectionBinding) -> AppAnnotationSetting:
    setting = AppAnnotationSetting(
        app_id=harness.app.id,
        score_threshold=0.4,
        collection_binding_id=binding.id,
        created_user_id=harness.account_id,
        updated_user_id=harness.account_id,
    )
    with harness.factory.begin() as session:
        session.add(setting)
    return setting


def test_disabled_reply_imports_exact_content_and_keeps_duplicate_questions(harness: _Harness) -> None:
    harness.execute(records=RECORDS)

    with harness.factory() as session:
        annotations = session.scalars(select(MessageAnnotation)).all()
        assert len(annotations) == 2
        assert {(item.question, item.content) for item in annotations} == {
            (record["question"], record["answer"]) for record in RECORDS
        }
        assert {item.app_id for item in annotations} == {harness.app.id}
        assert {item.account_id for item in annotations} == {harness.account_id}
        assert all(item.message_id is None for item in annotations)
        assert session.scalars(select(AppAnnotationSetting)).all() == []


def test_committed_batch_redelivery_preserves_user_edits_and_skips_indexing(harness: _Harness) -> None:
    plan = harness.prepare()
    harness.execute(records=RECORDS)
    with harness.factory.begin() as session:
        session.get_one(MessageAnnotation, plan.entries[0].id).content = "Edited after import"
        # A subsequently broken reply setting must not re-index a committed job.
        session.add(
            AppAnnotationSetting(
                app_id=harness.app.id,
                score_threshold=0.4,
                collection_binding_id=str(uuid4()),
                created_user_id=harness.account_id,
                updated_user_id=harness.account_id,
            )
        )

    harness.execute(records=RECORDS)

    with harness.factory() as session:
        assert len(session.scalars(select(MessageAnnotation)).all()) == 2
        assert session.get_one(MessageAnnotation, plan.entries[0].id).content == "Edited after import"


def test_same_csv_in_different_jobs_creates_separate_batches(harness: _Harness) -> None:
    harness.execute(records=RECORDS)
    harness.service.execute_import(
        tenant_id=harness.app.tenant_id,
        app_id=harness.app.id,
        job_id=str(uuid4()),
        account_id=harness.account_id,
        records=RECORDS,
    )

    with harness.factory() as session:
        annotations = session.scalars(select(MessageAnnotation)).all()
        assert len({item.id for item in annotations}) == 4
        assert [item.content for item in annotations].count(RECORDS[0]["answer"]) == 2


def test_redelivery_does_not_recreate_partially_deleted_batch(harness: _Harness) -> None:
    plan = harness.prepare()
    harness.execute(records=RECORDS)
    with harness.factory.begin() as session:
        session.delete(session.get_one(MessageAnnotation, plan.entries[0].id))

    with pytest.raises(AnnotationImportChangedError, match="removed"):
        harness.execute(records=RECORDS)

    with harness.factory() as session:
        assert [item.id for item in session.scalars(select(MessageAnnotation)).all()] == [plan.entries[1].id]


@pytest.mark.parametrize("owner", ["app", "account"])
def test_redelivery_rejects_changed_annotation_ownership(harness: _Harness, owner: Literal["app", "account"]) -> None:
    plan = harness.prepare()
    harness.execute(records=RECORDS)
    with harness.factory.begin() as session:
        annotation = session.get_one(MessageAnnotation, plan.entries[0].id)
        if owner == "app":
            annotation.app_id = harness.foreign_app.id
        else:
            annotation.account_id = str(uuid4())

    with pytest.raises(AnnotationImportChangedError, match="ownership"):
        harness.execute(records=RECORDS)

    with harness.factory() as session:
        assert len(session.scalars(select(MessageAnnotation)).all()) == 2


def test_complete_rechecks_committed_batch_and_preserves_its_edits(harness: _Harness) -> None:
    first = harness.prepare()
    second = harness.prepare()
    assert first.entries == second.entries
    harness.repository.complete_import(plan=first)
    with harness.factory.begin() as session:
        session.get_one(MessageAnnotation, first.entries[0].id).question = "Edited question"

    harness.repository.complete_import(plan=second)

    with harness.factory() as session:
        assert len(session.scalars(select(MessageAnnotation)).all()) == 2
        assert session.get_one(MessageAnnotation, first.entries[0].id).question == "Edited question"


@pytest.mark.parametrize("unavailable", ["missing", "foreign", "disabled"])
def test_prepare_rechecks_app_identity_tenant_and_status(
    harness: _Harness, unavailable: Literal["missing", "foreign", "disabled"]
) -> None:
    app_id = str(uuid4()) if unavailable == "missing" else harness.foreign_app.id
    if unavailable == "disabled":
        app_id = harness.app.id
        with harness.factory.begin() as session:
            session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": app_id})
            session.add(make_app(app_id=str(uuid4()), tenant_id=harness.app.tenant_id))

    with pytest.raises(AnnotationAppNotFoundError):
        harness.service.execute_import(
            tenant_id=harness.app.tenant_id,
            app_id=app_id,
            job_id=harness.job_id,
            account_id=harness.account_id,
            records=RECORDS,
        )

    with harness.factory() as session:
        assert session.scalars(select(MessageAnnotation)).all() == []


@pytest.mark.parametrize("change", ["delete", "tenant", "status"])
def test_complete_rechecks_app_after_external_work(
    harness: _Harness, change: Literal["delete", "tenant", "status"]
) -> None:
    plan = harness.prepare()
    with harness.factory.begin() as session:
        app = session.get_one(App, harness.app.id)
        if change == "delete":
            session.delete(app)
        elif change == "tenant":
            app.tenant_id = harness.foreign_app.tenant_id
        else:
            session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": app.id})

    with pytest.raises(AnnotationAppNotFoundError):
        harness.repository.complete_import(plan=plan)

    with harness.factory() as session:
        assert session.scalars(select(MessageAnnotation)).all() == []


def test_reply_enabled_after_prepare_rejects_unindexed_batch(
    harness: _Harness, binding: DatasetCollectionBinding
) -> None:
    plan = harness.prepare()
    with harness.factory.begin() as session:
        session.add(
            AppAnnotationSetting(
                app_id=harness.app.id,
                score_threshold=0.4,
                collection_binding_id=binding.id,
                created_user_id=harness.account_id,
                updated_user_id=harness.account_id,
            )
        )

    with pytest.raises(AnnotationImportChangedError):
        harness.repository.complete_import(plan=plan)

    with harness.factory() as session:
        assert session.scalars(select(MessageAnnotation)).all() == []


@pytest.mark.parametrize("change", ["delete", "replace", "rebind"])
def test_changed_reply_setting_prevents_committing_stale_indexed_batch(
    harness: _Harness, setting: AppAnnotationSetting, change: Literal["delete", "replace", "rebind"]
) -> None:
    plan = harness.prepare()
    with harness.factory.begin() as session:
        stored = session.get_one(AppAnnotationSetting, setting.id)
        if change == "delete":
            session.delete(stored)
        elif change == "replace":
            session.delete(stored)
            session.add(
                AppAnnotationSetting(
                    app_id=harness.app.id,
                    score_threshold=setting.score_threshold,
                    collection_binding_id=setting.collection_binding_id,
                    created_user_id=harness.account_id,
                    updated_user_id=harness.account_id,
                )
            )
        else:
            stored.collection_binding_id = str(uuid4())

    with pytest.raises(AnnotationImportChangedError):
        harness.repository.complete_import(plan=plan)

    with harness.factory() as session:
        assert session.scalars(select(MessageAnnotation)).all() == []


@pytest.mark.parametrize("change", ["delete", "provider", "model", "collection", "type"])
def test_changed_binding_prevents_committing_stale_indexed_batch(
    harness: _Harness,
    setting: AppAnnotationSetting,
    change: Literal["delete", "provider", "model", "collection", "type"],
) -> None:
    plan = harness.prepare()
    with harness.factory.begin() as session:
        binding = session.get_one(DatasetCollectionBinding, setting.collection_binding_id)
        if change == "delete":
            session.delete(binding)
        elif change == "provider":
            binding.provider_name = "different-provider"
        elif change == "model":
            binding.model_name = "different-model"
        elif change == "collection":
            binding.collection_name = "different-collection"
        else:
            binding.type = CollectionBindingType.DATASET

    with pytest.raises(AnnotationImportChangedError, match="binding"):
        harness.repository.complete_import(plan=plan)

    with harness.factory() as session:
        assert session.scalars(select(MessageAnnotation)).all() == []


def test_threshold_change_does_not_discard_indexed_batch(harness: _Harness, setting: AppAnnotationSetting) -> None:
    plan = harness.prepare()
    with harness.factory.begin() as session:
        session.get_one(AppAnnotationSetting, setting.id).score_threshold = 0.9

    harness.repository.complete_import(plan=plan)

    with harness.factory() as session:
        assert len(session.scalars(select(MessageAnnotation)).all()) == 2
        assert session.get_one(AppAnnotationSetting, setting.id).score_threshold == 0.9


@pytest.mark.parametrize("missing", [True, False])
def test_prepare_rejects_missing_or_non_annotation_binding(
    harness: _Harness, setting: AppAnnotationSetting, missing: bool
) -> None:
    with harness.factory.begin() as session:
        binding = session.get_one(DatasetCollectionBinding, setting.collection_binding_id)
        if missing:
            session.delete(binding)
        else:
            binding.type = CollectionBindingType.DATASET

    with pytest.raises(AnnotationSettingNotFoundError, match="binding"):
        harness.execute(records=RECORDS)

    with harness.factory() as session:
        assert session.scalars(select(MessageAnnotation)).all() == []


def test_write_failure_rolls_back_the_whole_batch(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(
            text(
                "CREATE TRIGGER reject_second_annotation BEFORE INSERT ON message_annotations "
                "WHEN NEW.content = 'The second answer' "
                "BEGIN SELECT RAISE(ABORT, 'annotation write rejected'); END"
            )
        )

    with pytest.raises(IntegrityError, match="annotation write rejected"):
        harness.execute(records=RECORDS)

    with harness.factory() as session:
        assert session.scalars(select(MessageAnnotation)).all() == []


def test_backend_failure_happens_after_sessions_close_and_never_commits_annotations(
    harness: _Harness, setting: AppAnnotationSetting
) -> None:
    sessions: list[Session] = []
    observed_boundaries: list[bool] = []

    def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    def observe_whitelist_query(state: ORMExecuteState) -> None:
        if any(mapper.class_ is Whitelist for mapper in state.all_mappers):
            observed_boundaries.append(
                bool(sessions)
                and all(not session.in_transaction() and not session.identity_map for session in sessions)
            )

    event.listen(harness.factory, "after_begin", track_session)
    event.listen(harness.factory, "do_orm_execute", observe_whitelist_query)
    try:
        with config_overrides_context(VECTOR_STORE_WHITELIST_ENABLE=True):
            with pytest.raises(ValueError, match="not supported"):
                harness.execute(records=RECORDS)
        assert observed_boundaries == [True]
        assert all(not session.in_transaction() and not session.identity_map for session in sessions)
    finally:
        event.remove(harness.factory, "after_begin", track_session)
        event.remove(harness.factory, "do_orm_execute", observe_whitelist_query)

    with harness.factory() as session:
        assert session.scalars(select(MessageAnnotation)).all() == []
        assert session.get(AppAnnotationSetting, setting.id) is not None


def test_empty_batch_does_not_initialize_backend(harness: _Harness, setting: AppAnnotationSetting) -> None:
    harness.execute(records=())

    with harness.factory() as session:
        assert session.scalars(select(MessageAnnotation)).all() == []
        assert session.get(AppAnnotationSetting, setting.id) is not None


def test_large_committed_batch_is_deduplicated_across_query_chunks(harness: _Harness) -> None:
    records: list[AnnotationImportRecord] = [{"question": "Question", "answer": str(index)} for index in range(501)]
    harness.execute(records=records)
    harness.execute(records=records)

    with harness.factory() as session:
        annotations = session.scalars(select(MessageAnnotation)).all()
        assert len(annotations) == 501
        assert {item.content for item in annotations} == {str(index) for index in range(501)}
