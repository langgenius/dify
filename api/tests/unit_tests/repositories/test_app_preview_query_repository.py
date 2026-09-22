"""Preview reads enforce app ownership without adding execution or dataset ACL policy."""

from dataclasses import replace
from datetime import datetime
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from models.account import Tenant, TenantStatus
from models.dataset import Dataset
from models.enums import CustomizeTokenStrategy
from models.model import App, AppMode, IconType, Site
from repositories.app_preview_query_repository import AppPreviewQueryRepository
from services.app_definition_query_service import AppSiteConfiguration
from services.app_preview_query_service import AppPreviewDataset, AppPreviewRef

_APP_ID = "11111111-1111-1111-1111-111111111111"
_TENANT_ID = "22222222-2222-2222-2222-222222222222"
_DECOY_APP_ID = "33333333-3333-3333-3333-333333333333"
_DECOY_TENANT_ID = "44444444-4444-4444-4444-444444444444"
_DATASET_ID = "55555555-5555-5555-5555-555555555555"
_DECOY_DATASET_ID = "66666666-6666-6666-6666-666666666666"
_CREATOR_ID = "77777777-7777-7777-7777-777777777777"
_CREATED_AT = datetime(2024, 1, 2, 3, 4, 5)


def _add_app(session: Session, *, app_id: str, tenant_id: str) -> None:
    session.add(
        App(
            id=app_id,
            tenant_id=tenant_id,
            name="Preview",
            mode=AppMode.CHAT,
            enable_site=False,
            enable_api=False,
            is_public=False,
        )
    )


def _add_site(session: Session, *, app_id: str, title: str) -> None:
    session.add(
        Site(
            app_id=app_id,
            title=title,
            default_language="zh-Hans",
            customize_token_strategy=CustomizeTokenStrategy.UUID,
            icon_type=IconType.IMAGE,
            icon=_DATASET_ID,
            icon_background="#ffffff",
            description="Preview description",
            copyright="Copyright",
            privacy_policy="https://example.com/privacy",
            input_placeholder="Ask a question",
            custom_disclaimer="Disclaimer",
            chat_color_theme="#000000",
            chat_color_theme_inverted=True,
            prompt_public=True,
            show_workflow_steps=True,
            use_icon_as_answer_icon=True,
        )
    )


def _add_dataset(session: Session, *, dataset_id: str, tenant_id: str) -> None:
    session.add(
        Dataset(
            id=dataset_id,
            tenant_id=tenant_id,
            name="Knowledge",
            description="Knowledge description",
            permission="only_me",
            data_source_type="upload_file",
            indexing_technique="high_quality",
            created_by=_CREATOR_ID,
            created_at=_CREATED_AT,
        )
    )


@pytest.fixture
def preview_ref(sqlite_session_factory: sessionmaker[Session]) -> AppPreviewRef:
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="Owner")
        tenant.id = _TENANT_ID
        decoy_tenant = Tenant(name="Other owner")
        decoy_tenant.id = _DECOY_TENANT_ID
        session.add_all([tenant, decoy_tenant])
        _add_app(session, app_id=_APP_ID, tenant_id=_TENANT_ID)
        _add_app(session, app_id=_DECOY_APP_ID, tenant_id=_DECOY_TENANT_ID)
        _add_site(session, app_id=_APP_ID, title="Preview Site")
        _add_site(session, app_id=_DECOY_APP_ID, title="Decoy Site")
        _add_dataset(session, dataset_id=_DATASET_ID, tenant_id=_TENANT_ID)
        _add_dataset(session, dataset_id=_DECOY_DATASET_ID, tenant_id=_DECOY_TENANT_ID)
    return AppPreviewRef(app_id=_APP_ID, tenant_id=_TENANT_ID)


def test_get_app_returns_owner_without_requiring_publication_or_trial_registration(
    sqlite_session_factory: sessionmaker[Session], preview_ref: AppPreviewRef
) -> None:
    repository = AppPreviewQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_app(app_id=_APP_ID) == preview_ref


@pytest.mark.parametrize("state", ["missing", "not-normal"])
def test_get_app_does_not_substitute_another_normal_app(
    sqlite_session_factory: sessionmaker[Session], preview_ref: AppPreviewRef, state: str
) -> None:
    app_id = preview_ref.app_id
    if state == "missing":
        app_id = str(uuid4())
    else:
        with sqlite_session_factory.begin() as session:
            # Legacy databases can contain statuses outside the current enum.
            session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :app_id"), {"app_id": app_id})
    repository = AppPreviewQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_app(app_id=_DECOY_APP_ID) == AppPreviewRef(app_id=_DECOY_APP_ID, tenant_id=_DECOY_TENANT_ID)
    assert repository.get_app(app_id=app_id) is None


def test_get_site_returns_detached_configuration_for_disabled_site_app(
    sqlite_session_factory: sessionmaker[Session], preview_ref: AppPreviewRef
) -> None:
    repository = AppPreviewQueryRepository(session_factory=sqlite_session_factory)

    result = repository.get_site(app=preview_ref)

    assert result is not None
    assert result.owner_status == "normal"
    assert result.configuration == AppSiteConfiguration(
        title="Preview Site",
        chat_color_theme="#000000",
        chat_color_theme_inverted=True,
        icon_type="image",
        icon=_DATASET_ID,
        icon_background="#ffffff",
        description="Preview description",
        copyright="Copyright",
        privacy_policy="https://example.com/privacy",
        input_placeholder="Ask a question",
        custom_disclaimer="Disclaimer",
        default_language="zh-Hans",
        prompt_public=True,
        show_workflow_steps=True,
        use_icon_as_answer_icon=True,
    )


@pytest.mark.parametrize("state", ["missing-app", "wrong-tenant", "not-normal", "missing-site"])
def test_get_site_requires_complete_admitted_app_scope(
    sqlite_session_factory: sessionmaker[Session], preview_ref: AppPreviewRef, state: str
) -> None:
    if state == "wrong-tenant":
        preview_ref = replace(preview_ref, tenant_id=_DECOY_TENANT_ID)
    else:
        statements = {
            "missing-app": "DELETE FROM apps WHERE id = :app_id",
            "not-normal": "UPDATE apps SET status = 'disabled' WHERE id = :app_id",
            "missing-site": "DELETE FROM sites WHERE app_id = :app_id",
        }
        with sqlite_session_factory.begin() as session:
            session.execute(text(statements[state]), {"app_id": preview_ref.app_id})
    repository = AppPreviewQueryRepository(session_factory=sqlite_session_factory)
    decoy_site = repository.get_site(app=AppPreviewRef(app_id=_DECOY_APP_ID, tenant_id=_DECOY_TENANT_ID))

    assert decoy_site is not None
    assert decoy_site.configuration.title == "Decoy Site"
    assert repository.get_site(app=preview_ref) is None


@pytest.mark.parametrize("owner_state", ["missing", "archive", "normal"])
def test_get_site_preserves_owner_state_for_service_policy(
    sqlite_session_factory: sessionmaker[Session], preview_ref: AppPreviewRef, owner_state: str
) -> None:
    with sqlite_session_factory.begin() as session:
        owner = session.get(Tenant, preview_ref.tenant_id)
        assert owner is not None
        if owner_state == "missing":
            session.delete(owner)
        else:
            owner.status = TenantStatus(owner_state)

    result = AppPreviewQueryRepository(session_factory=sqlite_session_factory).get_site(app=preview_ref)

    assert result is not None
    assert result.configuration.title == "Preview Site"
    assert result.owner_status == (None if owner_state == "missing" else owner_state)


def test_get_site_does_not_filter_legacy_empty_site_status(
    sqlite_session_factory: sessionmaker[Session], preview_ref: AppPreviewRef
) -> None:
    with sqlite_session_factory.begin() as session:
        session.execute(text("UPDATE sites SET status = '' WHERE app_id = :app_id"), {"app_id": preview_ref.app_id})

    result = AppPreviewQueryRepository(session_factory=sqlite_session_factory).get_site(app=preview_ref)

    assert result is not None
    assert result.configuration.title == "Preview Site"


def test_get_datasets_filters_requested_ids_and_owner_without_acl_or_app_binding(
    sqlite_session_factory: sessionmaker[Session], preview_ref: AppPreviewRef
) -> None:
    with sqlite_session_factory.begin() as session:
        _add_dataset(session, dataset_id=str(uuid4()), tenant_id=_TENANT_ID)
    repository = AppPreviewQueryRepository(session_factory=sqlite_session_factory)

    result = repository.get_datasets(app=preview_ref, ids=[_DATASET_ID, _DECOY_DATASET_ID, _DATASET_ID, str(uuid4())])

    assert result == (
        AppPreviewDataset(
            id=_DATASET_ID,
            name="Knowledge",
            description="Knowledge description",
            permission="only_me",
            data_source_type="upload_file",
            indexing_technique="high_quality",
            created_by=_CREATOR_ID,
            created_at=_CREATED_AT,
        ),
    )
    assert repository.get_datasets(app=preview_ref, ids=[]) == ()
    assert repository.get_datasets(app=preview_ref, ids=[str(uuid4())]) == ()


@pytest.mark.parametrize("state", ["missing-app", "wrong-tenant", "not-normal"])
@pytest.mark.parametrize("empty_ids", [True, False])
def test_get_datasets_requires_available_admitted_app_even_for_empty_ids(
    sqlite_session_factory: sessionmaker[Session], preview_ref: AppPreviewRef, state: str, empty_ids: bool
) -> None:
    if state == "wrong-tenant":
        preview_ref = replace(preview_ref, tenant_id=_DECOY_TENANT_ID)
    else:
        statement = (
            "DELETE FROM apps WHERE id = :app_id"
            if state == "missing-app"
            else "UPDATE apps SET status = 'disabled' WHERE id = :app_id"
        )
        with sqlite_session_factory.begin() as session:
            session.execute(text(statement), {"app_id": preview_ref.app_id})
    repository = AppPreviewQueryRepository(session_factory=sqlite_session_factory)
    decoy_datasets = repository.get_datasets(
        app=AppPreviewRef(app_id=_DECOY_APP_ID, tenant_id=_DECOY_TENANT_ID), ids=[_DECOY_DATASET_ID]
    )

    assert decoy_datasets is not None
    assert len(decoy_datasets) == 1
    ids: list[str] = [] if empty_ids else [_DATASET_ID, _DECOY_DATASET_ID]
    assert repository.get_datasets(app=preview_ref, ids=ids) is None


def test_get_datasets_preserves_nullable_columns(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        _add_app(session, app_id=_APP_ID, tenant_id=_TENANT_ID)
        session.add(
            Dataset(id=_DATASET_ID, tenant_id=_TENANT_ID, name="No optional configuration", created_by=_CREATOR_ID)
        )

    result = AppPreviewQueryRepository(session_factory=sqlite_session_factory).get_datasets(
        app=AppPreviewRef(app_id=_APP_ID, tenant_id=_TENANT_ID), ids=[_DATASET_ID]
    )

    assert result is not None
    assert len(result) == 1
    assert result[0].description is None
    assert result[0].data_source_type is None
    assert result[0].indexing_technique is None


def test_get_datasets_returns_every_requested_match_without_a_page_limit(
    sqlite_session_factory: sessionmaker[Session], preview_ref: AppPreviewRef
) -> None:
    ids = [str(uuid4()) for _ in range(25)]
    with sqlite_session_factory.begin() as session:
        for dataset_id in ids:
            _add_dataset(session, dataset_id=dataset_id, tenant_id=preview_ref.tenant_id)

    result = AppPreviewQueryRepository(session_factory=sqlite_session_factory).get_datasets(app=preview_ref, ids=ids)

    assert result is not None
    assert {dataset.id for dataset in result} == set(ids)
    assert len(result) == 25


@pytest.mark.parametrize("method", ["app", "site", "datasets"])
@pytest.mark.parametrize("exists", [True, False])
def test_preview_queries_release_connections_on_found_and_missing_results(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    preview_ref: AppPreviewRef,
    method: Literal["app", "site", "datasets"],
    exists: bool,
) -> None:
    if not exists:
        preview_ref = replace(preview_ref, app_id=str(uuid4()))
    repository = AppPreviewQueryRepository(session_factory=sqlite_session_factory)
    assert isinstance(sqlite_engine.pool, QueuePool)
    assert sqlite_engine.pool.checkedout() == 0

    result: object
    match method:
        case "app":
            result = repository.get_app(app_id=preview_ref.app_id)
        case "site":
            result = repository.get_site(app=preview_ref)
        case "datasets":
            result = repository.get_datasets(app=preview_ref, ids=[_DATASET_ID])

    assert (result is not None) == exists
    assert sqlite_engine.pool.checkedout() == 0


def test_preview_queries_leave_caller_transaction_open_and_uncommitted(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session], preview_ref: AppPreviewRef
) -> None:
    repository = AppPreviewQueryRepository(session_factory=sqlite_session_factory)
    assert isinstance(sqlite_engine.pool, QueuePool)
    with sqlite_session_factory() as caller:
        app = caller.get(App, _APP_ID)
        assert app is not None
        app.name = "Pending caller change"
        assert sqlite_engine.pool.checkedout() == 1

        assert repository.get_app(app_id=_APP_ID) == preview_ref
        assert repository.get_site(app=preview_ref) is not None
        assert repository.get_datasets(app=preview_ref, ids=[_DATASET_ID]) is not None

        assert caller.in_transaction()
        assert app in caller.dirty
        assert sqlite_engine.pool.checkedout() == 1
        caller.rollback()

    with sqlite_session_factory() as session:
        assert session.scalar(select(App.name).where(App.id == _APP_ID)) == "Preview"
    assert sqlite_engine.pool.checkedout() == 0
