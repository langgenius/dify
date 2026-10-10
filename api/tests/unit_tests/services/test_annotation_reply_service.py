"""Reply execution with real SQLite persistence and vector backend selection."""

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import Connection, event, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import ORMExecuteState, Session, SessionTransaction, sessionmaker

from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from extensions.ext_redis import RedisClientWrapper
from models.dataset import DatasetCollectionBinding, Whitelist
from models.enums import CollectionBindingType
from models.model import App, AppAnnotationSetting, MessageAnnotation
from repositories.annotation_reply_job_repository import RedisAnnotationReplyJobRepository
from repositories.annotation_repository import AnnotationRepository
from services.annotation_command_service import AnnotationSettingNotFoundError
from services.annotation_query import AnnotationAppNotFoundError
from services.annotation_reply_index import AnnotationVectorIndex
from services.annotation_reply_service import AnnotationIndexBinding, AnnotationReplyService
from tasks.annotation.disable_annotation_reply_task import disable_annotation_reply_task
from tasks.annotation.enable_annotation_reply_task import enable_annotation_reply_task
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_app

PROVIDER = "annotation-provider"
MODEL = "annotation-embedding"
INVALID_BACKEND = "annotation-test-uninstalled-vector-backend"


@dataclass(frozen=True)
class _Harness:
    factory: sessionmaker[Session]
    service: AnnotationReplyService
    index: AnnotationVectorIndex
    app: App
    foreign_app: App
    account_id: str

    def enable(self, *, app_id: str) -> None:
        self.service.execute_enable(
            tenant_id=self.app.tenant_id,
            app_id=app_id,
            account_id=self.account_id,
            score_threshold=0.75,
            embedding_provider_name=PROVIDER,
            embedding_model_name=MODEL,
        )


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Harness]:
    app = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()))
    foreign_app = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()))
    with sqlite_session_factory.begin() as session:
        session.add_all([app, foreign_app])
    index = AnnotationVectorIndex(session_factory=sqlite_session_factory)
    service = AnnotationReplyService(
        annotations=AnnotationRepository(session_factory=sqlite_session_factory),
        index=index,
        jobs=RedisAnnotationReplyJobRepository(redis=RedisClientWrapper()),
        enable_task=enable_annotation_reply_task.delay,
        disable_task=disable_annotation_reply_task.delay,
    )
    with config_overrides_context(VECTOR_STORE=INVALID_BACKEND, VECTOR_STORE_WHITELIST_ENABLE=False):
        yield _Harness(sqlite_session_factory, service, index, app, foreign_app, str(uuid4()))


@pytest.fixture
def binding(harness: _Harness) -> DatasetCollectionBinding:
    binding = DatasetCollectionBinding(
        provider_name=PROVIDER,
        model_name=MODEL,
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
        created_user_id=str(uuid4()),
        updated_user_id=str(uuid4()),
    )
    with harness.factory.begin() as session:
        session.add(setting)
    return setting


@pytest.fixture
def annotation(harness: _Harness) -> MessageAnnotation:
    annotation = MessageAnnotation(
        app_id=harness.app.id,
        account_id=harness.account_id,
        question="A question",
        content="An answer",
    )
    with harness.factory.begin() as session:
        session.add(annotation)
    return annotation


def test_enabling_empty_app_creates_binding_and_setting_without_vector_backend(harness: _Harness) -> None:
    harness.enable(app_id=harness.app.id)

    with harness.factory() as session:
        setting = session.scalars(select(AppAnnotationSetting)).one()
        binding = session.scalars(select(DatasetCollectionBinding)).one()
        assert setting.app_id == harness.app.id
        assert setting.collection_binding_id == binding.id
        assert setting.score_threshold == 0.75
        assert setting.created_user_id == setting.updated_user_id == harness.account_id
        assert binding.provider_name == PROVIDER
        assert binding.model_name == MODEL
        assert binding.type == CollectionBindingType.ANNOTATION
        assert binding.collection_name


def test_enabling_empty_app_reuses_matching_annotation_binding(
    harness: _Harness, binding: DatasetCollectionBinding
) -> None:
    with harness.factory.begin() as session:
        session.add(
            DatasetCollectionBinding(
                provider_name=PROVIDER,
                model_name=MODEL,
                type=CollectionBindingType.DATASET,
                collection_name="ordinary_dataset_collection",
            )
        )

    harness.enable(app_id=harness.app.id)
    harness.enable(app_id=harness.app.id)

    with harness.factory() as session:
        [setting] = session.scalars(select(AppAnnotationSetting)).all()
        assert setting.collection_binding_id == binding.id
        assert len(session.scalars(select(DatasetCollectionBinding)).all()) == 2


def test_reenabling_empty_app_updates_setting_without_replacing_identity_or_creator(
    harness: _Harness, setting: AppAnnotationSetting
) -> None:
    harness.enable(app_id=harness.app.id)

    with harness.factory() as session:
        [stored] = session.scalars(select(AppAnnotationSetting)).all()
        assert stored.id == setting.id
        assert stored.created_user_id == setting.created_user_id
        assert stored.collection_binding_id == setting.collection_binding_id
        assert stored.score_threshold == 0.75
        assert stored.updated_user_id == harness.account_id


def test_disabling_empty_app_preserves_binding_and_is_idempotent(
    harness: _Harness, setting: AppAnnotationSetting
) -> None:
    harness.service.execute_disable(tenant_id=harness.app.tenant_id, app_id=harness.app.id)
    harness.service.execute_disable(tenant_id=harness.app.tenant_id, app_id=harness.app.id)

    with harness.factory() as session:
        assert session.get(AppAnnotationSetting, setting.id) is None
        assert session.get(DatasetCollectionBinding, setting.collection_binding_id) is not None


def test_disabling_app_without_setting_does_not_create_one(harness: _Harness) -> None:
    harness.service.execute_disable(tenant_id=harness.app.tenant_id, app_id=harness.app.id)

    with harness.factory() as session:
        assert session.scalars(select(AppAnnotationSetting)).all() == []
        assert session.scalars(select(DatasetCollectionBinding)).all() == []


@pytest.mark.parametrize("operation", ["enable", "disable"])
@pytest.mark.parametrize("unavailable", ["missing", "foreign", "disabled"])
def test_execution_rechecks_app_identity_tenant_and_status(
    harness: _Harness,
    operation: Literal["enable", "disable"],
    unavailable: Literal["missing", "foreign", "disabled"],
) -> None:
    app_id = str(uuid4()) if unavailable == "missing" else harness.foreign_app.id
    if unavailable == "disabled":
        app_id = harness.app.id
        with harness.factory.begin() as session:
            session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": app_id})
            session.add(make_app(app_id=str(uuid4()), tenant_id=harness.app.tenant_id))

    if operation == "enable":
        with pytest.raises(AnnotationAppNotFoundError):
            harness.enable(app_id=app_id)
    else:
        with pytest.raises(AnnotationAppNotFoundError):
            harness.service.execute_disable(tenant_id=harness.app.tenant_id, app_id=app_id)

    with harness.factory() as session:
        assert session.scalars(select(AppAnnotationSetting)).all() == []
        assert session.scalars(select(DatasetCollectionBinding)).all() == []


def test_index_failure_does_not_enable_reply_or_persist_new_binding(
    harness: _Harness, annotation: MessageAnnotation
) -> None:
    with pytest.raises(ValueError, match="not supported"):
        harness.enable(app_id=harness.app.id)

    with harness.factory() as session:
        assert session.scalars(select(AppAnnotationSetting)).all() == []
        assert session.scalars(select(DatasetCollectionBinding)).all() == []
        assert session.get_one(MessageAnnotation, annotation.id).question == annotation.question


def test_index_failure_preserves_existing_setting(
    harness: _Harness, setting: AppAnnotationSetting, annotation: MessageAnnotation
) -> None:
    with pytest.raises(ValueError, match="not supported"):
        harness.enable(app_id=harness.app.id)

    with harness.factory() as session:
        stored = session.get_one(AppAnnotationSetting, setting.id)
        assert stored.score_threshold == setting.score_threshold
        assert stored.collection_binding_id == setting.collection_binding_id
        assert stored.updated_user_id == setting.updated_user_id
        assert stored.updated_at == setting.updated_at
        assert session.get(MessageAnnotation, annotation.id) is not None


def test_index_delete_failure_does_not_prevent_disabling_reply(
    harness: _Harness,
    setting: AppAnnotationSetting,
    annotation: MessageAnnotation,
    caplog: pytest.LogCaptureFixture,
) -> None:
    harness.service.execute_disable(tenant_id=harness.app.tenant_id, app_id=harness.app.id)

    assert f"Cannot delete annotation index for app {harness.app.id}" in caplog.text
    assert "not supported" in caplog.text
    with harness.factory() as session:
        assert session.get(AppAnnotationSetting, setting.id) is None
        assert session.get(MessageAnnotation, annotation.id) is not None
        assert session.get(DatasetCollectionBinding, setting.collection_binding_id) is not None


def test_annotation_session_closes_before_backend_selection(harness: _Harness, annotation: MessageAnnotation) -> None:
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
                harness.enable(app_id=harness.app.id)
        assert observed_boundaries == [True]
        assert all(not session.in_transaction() and not session.identity_map for session in sessions)
    finally:
        event.remove(harness.factory, "after_begin", track_session)
        event.remove(harness.factory, "do_orm_execute", observe_whitelist_query)
    with harness.factory() as session:
        assert session.get(MessageAnnotation, annotation.id) is not None


def test_setting_write_failure_rolls_back_new_binding(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(
            text(
                "CREATE TRIGGER reject_annotation_setting BEFORE INSERT ON app_annotation_settings "
                "BEGIN SELECT RAISE(ABORT, 'setting write rejected'); END"
            )
        )

    with pytest.raises(IntegrityError, match="setting write rejected"):
        harness.enable(app_id=harness.app.id)

    with harness.factory() as session:
        assert session.scalars(select(AppAnnotationSetting)).all() == []
        assert session.scalars(select(DatasetCollectionBinding)).all() == []


@pytest.mark.parametrize("backend", [VectorType.QDRANT, VectorType.WEAVIATE, VectorType.PGVECTOR])
def test_detached_vector_input_preserves_owner_embedding_and_backend_collection_convention(
    harness: _Harness, binding: DatasetCollectionBinding, backend: VectorType
) -> None:
    with config_overrides_context(VECTOR_STORE=backend):
        dataset, resolved_backend = harness.index._prepare(
            tenant_id=harness.app.tenant_id,
            app_id=harness.app.id,
            binding=AnnotationIndexBinding(
                binding.id, binding.provider_name, binding.model_name, binding.collection_name
            ),
        )

    assert resolved_backend == backend
    assert dataset.id == harness.app.id
    assert dataset.tenant_id == harness.app.tenant_id
    assert dataset.embedding_model_provider == binding.provider_name
    assert dataset.embedding_model == binding.model_name
    assert dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY
    assert dataset.collection_binding_id is None
    if backend == VectorType.QDRANT:
        assert dataset.index_struct_dict == {
            "type": VectorType.QDRANT,
            "vector_store": {"class_prefix": binding.collection_name},
        }
    else:
        assert dataset.index_struct_dict is None


@pytest.mark.parametrize("backend", [VectorType.WEAVIATE, VectorType.PGVECTOR])
def test_missing_binding_preserves_app_local_vector_cleanup_input(harness: _Harness, backend: VectorType) -> None:
    with config_overrides_context(VECTOR_STORE=backend):
        dataset, resolved_backend = harness.index._prepare(
            tenant_id=harness.app.tenant_id, app_id=harness.app.id, binding=None
        )

    assert resolved_backend == backend
    assert dataset.id == harness.app.id
    assert dataset.tenant_id == harness.app.tenant_id
    assert dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY
    assert dataset.embedding_model_provider is None
    assert dataset.embedding_model is None
    assert dataset.collection_binding_id is None
    assert dataset.index_struct_dict is None


def test_missing_binding_rejects_qdrant_cleanup_without_a_shared_collection(harness: _Harness) -> None:
    with config_overrides_context(VECTOR_STORE=VectorType.QDRANT):
        with pytest.raises(AnnotationSettingNotFoundError, match=harness.app.id):
            harness.index._prepare(tenant_id=harness.app.tenant_id, app_id=harness.app.id, binding=None)


@pytest.mark.parametrize("whitelist", ["tenant", "foreign", "other-category"])
def test_vector_whitelist_remains_scoped_to_tenant_and_category(
    harness: _Harness,
    binding: DatasetCollectionBinding,
    whitelist: Literal["tenant", "foreign", "other-category"],
) -> None:
    with harness.factory.begin() as session:
        session.add(
            Whitelist(
                tenant_id=harness.foreign_app.tenant_id if whitelist == "foreign" else harness.app.tenant_id,
                category="other" if whitelist == "other-category" else "vector_db",
            )
        )
    with config_overrides_context(VECTOR_STORE=VectorType.QDRANT, VECTOR_STORE_WHITELIST_ENABLE=True):
        dataset, resolved_backend = harness.index._prepare(
            tenant_id=harness.app.tenant_id,
            app_id=harness.app.id,
            binding=AnnotationIndexBinding(
                binding.id, binding.provider_name, binding.model_name, binding.collection_name
            ),
        )

    assert dataset.tenant_id == harness.app.tenant_id
    if whitelist == "tenant":
        assert resolved_backend == VectorType.TIDB_ON_QDRANT
        assert dataset.index_struct_dict is None
    else:
        assert resolved_backend == VectorType.QDRANT
        assert dataset.index_struct_dict == {
            "type": VectorType.QDRANT,
            "vector_store": {"class_prefix": binding.collection_name},
        }
