"""Reply worker snapshots and commit boundaries against real SQLite persistence."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import partial
from typing import Literal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account
from models.dataset import DatasetCollectionBinding
from models.enums import CollectionBindingType
from models.model import App, AppAnnotationSetting, AppMode, MessageAnnotation
from repositories.annotation_repository import AnnotationRepository
from services.annotation_command_service import AnnotationSettingNotFoundError
from services.annotation_query import AnnotationAppNotFoundError
from services.annotation_reply_service import (
    AnnotationReplyChangedError,
    AnnotationReplyDisablePlan,
    AnnotationReplyEnablePlan,
)

CREATED_AT = datetime(2026, 1, 1)


@dataclass(frozen=True)
class Scope:
    app: App
    other_app: App
    foreign_app: App
    account: Account


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> AnnotationRepository:
    return AnnotationRepository(session_factory=sqlite_session_factory)


@pytest.fixture
def scope(sqlite_session: Session) -> Scope:
    tenant_id = str(uuid4())
    apps = [
        App(tenant_id=workspace, name="Annotations", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        for workspace in (tenant_id, tenant_id, str(uuid4()))
    ]
    account = Account(name="Author", email="annotation-reply@example.com")
    sqlite_session.add_all([*apps, account])
    sqlite_session.commit()
    return Scope(apps[0], apps[1], apps[2], account)


def _binding(session: Session) -> DatasetCollectionBinding:
    binding = DatasetCollectionBinding(
        provider_name="embedding-provider",
        model_name="embedding-model",
        type=CollectionBindingType.ANNOTATION,
        collection_name=f"collection_{uuid4().hex}",
    )
    binding.created_at = CREATED_AT
    session.add(binding)
    return binding


def _setting(session: Session, scope: Scope, *, app_id: str, binding_id: str) -> AppAnnotationSetting:
    setting = AppAnnotationSetting(
        app_id=app_id,
        collection_binding_id=binding_id,
        score_threshold=0.5,
        created_user_id=scope.account.id,
        updated_user_id=scope.account.id,
    )
    setting.created_at = CREATED_AT
    setting.updated_at = CREATED_AT
    session.add(setting)
    return setting


def _enable_plan(repository: AnnotationRepository, scope: Scope) -> AnnotationReplyEnablePlan:
    return repository.prepare_enable_reply(
        tenant_id=scope.app.tenant_id,
        app_id=scope.app.id,
        provider_name="embedding-provider",
        model_name="embedding-model",
    )


def _disable_plan(repository: AnnotationRepository, scope: Scope) -> AnnotationReplyDisablePlan:
    plan = repository.prepare_disable_reply(tenant_id=scope.app.tenant_id, app_id=scope.app.id)
    assert plan is not None
    return plan


def test_prepare_enable_allocates_binding_without_writes_and_only_reads_owned_annotations(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope
) -> None:
    annotations = [
        MessageAnnotation(app_id=scope.app.id, question="Question", content="Answer", account_id=scope.account.id),
        MessageAnnotation(app_id=scope.app.id, question="", content="Fallback answer", account_id=scope.account.id),
        MessageAnnotation(app_id=scope.app.id, question="", content="", account_id=scope.account.id),
        MessageAnnotation(
            app_id=scope.other_app.id, question="Other app", content="Answer", account_id=scope.account.id
        ),
        MessageAnnotation(
            app_id=scope.foreign_app.id, question="Foreign", content="Answer", account_id=scope.account.id
        ),
    ]
    sqlite_session.add_all(annotations)
    sqlite_session.commit()

    plan = _enable_plan(repository, scope)

    assert plan.revision is None
    assert plan.previous_binding is None
    assert plan.binding_is_new
    assert str(UUID(plan.binding.id)) == plan.binding.id
    assert plan.binding.collection_name.startswith("Vector_index_")
    assert {entry.id: entry.question for entry in plan.annotations} == {
        annotations[0].id: "Question",
        annotations[1].id: "Fallback answer",
        annotations[2].id: "",
    }
    assert sqlite_session.scalar(select(func.count()).select_from(DatasetCollectionBinding)) == 0
    assert sqlite_session.scalar(select(func.count()).select_from(AppAnnotationSetting)) == 0


def test_prepare_reuses_oldest_matching_annotation_binding(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope
) -> None:
    wrong_type, wrong_provider, wrong_model, oldest, newer = [_binding(sqlite_session) for _ in range(5)]
    wrong_type.type = CollectionBindingType.DATASET
    wrong_provider.provider_name = "other-provider"
    wrong_model.model_name = "other-model"
    oldest.created_at = CREATED_AT + timedelta(days=1)
    newer.created_at = CREATED_AT + timedelta(days=2)
    sqlite_session.commit()

    plan = _enable_plan(repository, scope)

    assert not plan.binding_is_new
    assert plan.binding.id == oldest.id
    assert plan.binding.collection_name == oldest.collection_name
    assert sqlite_session.scalar(select(func.count()).select_from(DatasetCollectionBinding)) == 5


def test_prepare_enable_snapshots_existing_setting_and_previous_binding(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope
) -> None:
    previous_binding = _binding(sqlite_session)
    previous_binding.model_name = "previous-model"
    setting = _setting(sqlite_session, scope, app_id=scope.app.id, binding_id=previous_binding.id)
    decoy_binding = _binding(sqlite_session)
    decoy_binding.model_name = "decoy-model"
    _setting(sqlite_session, scope, app_id=scope.other_app.id, binding_id=decoy_binding.id)
    sqlite_session.commit()

    plan = _enable_plan(repository, scope)

    assert plan.revision is not None
    assert plan.revision.id == setting.id
    assert plan.revision.collection_binding_id == previous_binding.id
    assert plan.previous_binding is not None
    assert plan.previous_binding.id == previous_binding.id
    assert plan.annotations == ()
    assert plan.binding_is_new


@pytest.mark.parametrize("invalid_binding", ["missing", "wrong_type"])
def test_prepare_enable_rejects_invalid_previous_binding_even_without_annotations(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, invalid_binding: str
) -> None:
    binding_id = str(uuid4())
    if invalid_binding == "wrong_type":
        binding = _binding(sqlite_session)
        binding.type = CollectionBindingType.DATASET
        binding_id = binding.id
    _setting(sqlite_session, scope, app_id=scope.app.id, binding_id=binding_id)
    sqlite_session.commit()

    with pytest.raises(AnnotationSettingNotFoundError, match=binding_id):
        _enable_plan(repository, scope)
    assert sqlite_session.scalar(select(func.count()).select_from(AppAnnotationSetting)) == 1


@pytest.mark.parametrize("operation", ["enable", "disable"])
@pytest.mark.parametrize("invalid_scope", ["foreign", "missing", "disabled"])
def test_prepare_checks_app_owner_id_and_status_with_valid_decoy(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    operation: str,
    invalid_scope: str,
) -> None:
    binding = _binding(sqlite_session)
    _setting(sqlite_session, scope, app_id=scope.other_app.id, binding_id=binding.id)
    target_id = scope.app.id
    if invalid_scope == "foreign":
        target_id = scope.foreign_app.id
    elif invalid_scope == "missing":
        target_id = str(uuid4())
    else:
        sqlite_session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": scope.app.id})
    sqlite_session.commit()

    prepare = (
        partial(
            repository.prepare_enable_reply,
            tenant_id=scope.app.tenant_id,
            app_id=target_id,
            provider_name="embedding-provider",
            model_name="embedding-model",
        )
        if operation == "enable"
        else partial(repository.prepare_disable_reply, tenant_id=scope.app.tenant_id, app_id=target_id)
    )
    with pytest.raises(AnnotationAppNotFoundError, match=target_id):
        prepare()


def test_complete_enable_persists_planned_binding_and_new_setting_atomically(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope
) -> None:
    plan = _enable_plan(repository, scope)

    repository.complete_enable_reply(plan=plan, account_id=scope.account.id, score_threshold=0.0)

    setting = sqlite_session.scalar(select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == scope.app.id))
    assert setting is not None
    assert setting.collection_binding_id == plan.binding.id
    assert setting.score_threshold == 0.0
    assert setting.created_user_id == scope.account.id
    assert setting.updated_user_id == scope.account.id
    binding = sqlite_session.get(DatasetCollectionBinding, plan.binding.id)
    assert binding is not None
    assert binding.provider_name == plan.binding.provider_name
    assert binding.model_name == plan.binding.model_name
    assert binding.collection_name == plan.binding.collection_name
    assert binding.type == CollectionBindingType.ANNOTATION


def test_complete_enable_updates_existing_setting_and_reuses_binding(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope
) -> None:
    binding = _binding(sqlite_session)
    setting = _setting(sqlite_session, scope, app_id=scope.app.id, binding_id=binding.id)
    sqlite_session.commit()
    plan = _enable_plan(repository, scope)
    assert plan.previous_binding is None

    repository.complete_enable_reply(plan=plan, account_id=scope.account.id, score_threshold=0.75)

    sqlite_session.refresh(setting)
    assert plan.revision is not None
    assert setting.id == plan.revision.id
    assert setting.score_threshold == 0.75
    assert setting.created_at == CREATED_AT
    assert setting.updated_at > CREATED_AT
    assert sqlite_session.scalar(select(func.count()).select_from(DatasetCollectionBinding)) == 1


@pytest.mark.parametrize("mutation", ["binding", "replacement", "deleted"])
@pytest.mark.parametrize("operation", ["enable", "disable"])
def test_completion_rejects_changed_setting_snapshot(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    mutation: str,
    operation: str,
) -> None:
    binding = _binding(sqlite_session)
    setting = _setting(sqlite_session, scope, app_id=scope.app.id, binding_id=binding.id)
    sqlite_session.commit()
    enable_plan = _enable_plan(repository, scope)
    disable_plan = _disable_plan(repository, scope)
    if mutation == "binding":
        setting.collection_binding_id = str(uuid4())
    else:
        sqlite_session.delete(setting)
        if mutation == "replacement":
            _setting(sqlite_session, scope, app_id=scope.app.id, binding_id=binding.id)
    sqlite_session.commit()

    if operation == "disable" and mutation == "deleted":
        repository.complete_disable_reply(plan=disable_plan)
    else:
        complete = (
            partial(
                repository.complete_enable_reply, plan=enable_plan, account_id=scope.account.id, score_threshold=0.7
            )
            if operation == "enable"
            else partial(repository.complete_disable_reply, plan=disable_plan)
        )
        with pytest.raises(AnnotationReplyChangedError, match=scope.app.id):
            complete()
    sqlite_session.expire_all()
    remaining = sqlite_session.scalar(select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == scope.app.id))
    if mutation == "deleted":
        assert remaining is None
    else:
        assert remaining is not None
        assert remaining.score_threshold == 0.5


@pytest.mark.parametrize("operation", ["enable", "disable"])
def test_threshold_update_during_indexing_does_not_invalidate_index_target(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, operation: str
) -> None:
    binding = _binding(sqlite_session)
    setting = _setting(sqlite_session, scope, app_id=scope.app.id, binding_id=binding.id)
    sqlite_session.commit()
    enable_plan = _enable_plan(repository, scope)
    disable_plan = _disable_plan(repository, scope)
    repository.update_setting(
        tenant_id=scope.app.tenant_id,
        app_id=scope.app.id,
        setting_id=setting.id,
        account_id=scope.account.id,
        score_threshold=0.9,
    )

    if operation == "enable":
        repository.complete_enable_reply(plan=enable_plan, account_id=scope.account.id, score_threshold=0.7)
        sqlite_session.refresh(setting)
        assert setting.score_threshold == 0.7
        assert setting.collection_binding_id == binding.id
    else:
        repository.complete_disable_reply(plan=disable_plan)
        sqlite_session.expire_all()
        assert (
            sqlite_session.scalar(select(AppAnnotationSetting.id).where(AppAnnotationSetting.app_id == scope.app.id))
            is None
        )


def test_enable_cannot_replace_setting_created_during_indexing(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope
) -> None:
    plan = _enable_plan(repository, scope)
    current_binding = _binding(sqlite_session)
    current_setting = _setting(sqlite_session, scope, app_id=scope.app.id, binding_id=current_binding.id)
    sqlite_session.commit()

    with pytest.raises(AnnotationReplyChangedError, match=scope.app.id):
        repository.complete_enable_reply(plan=plan, account_id=scope.account.id, score_threshold=0.7)

    sqlite_session.refresh(current_setting)
    assert current_setting.collection_binding_id == current_binding.id
    assert sqlite_session.get(DatasetCollectionBinding, plan.binding.id) is None


@pytest.mark.parametrize("mutation", ["missing", "type", "model", "provider", "collection"])
def test_enable_rejects_binding_removed_or_changed_while_indexing(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, mutation: str
) -> None:
    binding = _binding(sqlite_session)
    sqlite_session.commit()
    plan = _enable_plan(repository, scope)
    if mutation == "missing":
        sqlite_session.delete(binding)
    elif mutation == "type":
        binding.type = CollectionBindingType.DATASET
    elif mutation == "model":
        binding.model_name = "changed-model"
    elif mutation == "provider":
        binding.provider_name = "changed-provider"
    else:
        binding.collection_name = "changed-collection"
    sqlite_session.commit()

    with pytest.raises(AnnotationReplyChangedError, match=plan.binding.id):
        repository.complete_enable_reply(plan=plan, account_id=scope.account.id, score_threshold=0.7)

    assert sqlite_session.scalar(select(func.count()).select_from(AppAnnotationSetting)) == 0
    if mutation == "missing":
        assert sqlite_session.get(DatasetCollectionBinding, plan.binding.id) is None


@pytest.mark.parametrize("mutation", ["owner", "status", "deleted"])
@pytest.mark.parametrize("operation", ["enable", "disable"])
def test_completion_revalidates_app_before_writing(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    mutation: str,
    operation: str,
) -> None:
    binding = _binding(sqlite_session)
    setting = _setting(sqlite_session, scope, app_id=scope.app.id, binding_id=binding.id)
    _setting(sqlite_session, scope, app_id=scope.other_app.id, binding_id=binding.id)
    sqlite_session.commit()
    enable_plan = _enable_plan(repository, scope)
    disable_plan = _disable_plan(repository, scope)
    if mutation == "owner":
        scope.app.tenant_id = str(uuid4())
    elif mutation == "status":
        sqlite_session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": scope.app.id})
    else:
        sqlite_session.delete(scope.app)
    sqlite_session.commit()

    complete = (
        partial(repository.complete_enable_reply, plan=enable_plan, account_id=scope.account.id, score_threshold=0.7)
        if operation == "enable"
        else partial(repository.complete_disable_reply, plan=disable_plan)
    )
    with pytest.raises(AnnotationAppNotFoundError, match=enable_plan.app_id):
        complete()

    sqlite_session.refresh(setting)
    assert setting.score_threshold == 0.5
    assert sqlite_session.scalar(select(func.count()).select_from(AppAnnotationSetting)) == 2


def test_prepare_disable_ignores_other_app_setting_and_annotations(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope
) -> None:
    binding = _binding(sqlite_session)
    _setting(sqlite_session, scope, app_id=scope.other_app.id, binding_id=binding.id)
    sqlite_session.add(
        MessageAnnotation(app_id=scope.other_app.id, question="Other", content="Answer", account_id=scope.account.id)
    )
    sqlite_session.commit()
    assert repository.prepare_disable_reply(tenant_id=scope.app.tenant_id, app_id=scope.app.id) is None

    _setting(sqlite_session, scope, app_id=scope.app.id, binding_id=binding.id)
    sqlite_session.commit()
    plan = _disable_plan(repository, scope)
    assert not plan.has_annotations
    assert plan.binding is not None
    assert plan.binding.id == binding.id


@pytest.mark.parametrize("missing_binding", [True, False])
def test_disable_preserves_annotations_and_other_app_settings_and_allows_redelivery(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, missing_binding: bool
) -> None:
    binding = _binding(sqlite_session)
    _setting(sqlite_session, scope, app_id=scope.app.id, binding_id=str(uuid4()) if missing_binding else binding.id)
    other_setting = _setting(sqlite_session, scope, app_id=scope.other_app.id, binding_id=binding.id)
    annotation = MessageAnnotation(
        app_id=scope.app.id, question="Question", content="Answer", account_id=scope.account.id
    )
    sqlite_session.add(annotation)
    sqlite_session.commit()
    plan = _disable_plan(repository, scope)
    assert plan.has_annotations
    assert (plan.binding is None) == missing_binding

    repository.complete_disable_reply(plan=plan)
    repository.complete_disable_reply(plan=plan)

    assert sqlite_session.get(AppAnnotationSetting, plan.revision.id) is None
    assert sqlite_session.get(AppAnnotationSetting, other_setting.id) is not None
    assert sqlite_session.get(MessageAnnotation, annotation.id) is not None
    assert sqlite_session.get(DatasetCollectionBinding, binding.id) is not None


@pytest.mark.parametrize("operation", ["INSERT", "UPDATE", "DELETE"])
def test_final_sql_failure_rolls_back_setting_and_any_new_binding(
    repository: AnnotationRepository,
    sqlite_session: Session,
    sqlite_engine: Engine,
    scope: Scope,
    operation: Literal["INSERT", "UPDATE", "DELETE"],
) -> None:
    binding = _binding(sqlite_session)
    binding.model_name = "previous-model"
    if operation != "INSERT":
        _setting(sqlite_session, scope, app_id=scope.app.id, binding_id=binding.id)
    sqlite_session.commit()
    enable_plan = _enable_plan(repository, scope)
    disable_plan = _disable_plan(repository, scope) if operation == "DELETE" else None
    with sqlite_engine.begin() as connection:
        connection.execute(
            text(
                f"CREATE TRIGGER reject_reply_completion BEFORE {operation} ON app_annotation_settings "
                "BEGIN SELECT RAISE(ABORT, 'annotation reply completion rejected'); END"
            )
        )

    complete = (
        partial(repository.complete_disable_reply, plan=disable_plan)
        if disable_plan is not None
        else partial(
            repository.complete_enable_reply, plan=enable_plan, account_id=scope.account.id, score_threshold=0.7
        )
    )
    with pytest.raises(IntegrityError, match="annotation reply completion rejected"):
        complete()

    assert sqlite_session.get(DatasetCollectionBinding, enable_plan.binding.id) is None
    assert sqlite_session.scalar(select(func.count()).select_from(DatasetCollectionBinding)) == 1
    setting = sqlite_session.scalar(select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == scope.app.id))
    if operation == "INSERT":
        assert setting is None
    else:
        assert setting is not None
        assert setting.score_threshold == 0.5
        assert setting.collection_binding_id == binding.id
