"""Preview reads enforce app ownership without adding execution or dataset ACL policy."""

import json
from dataclasses import asdict, replace
from datetime import datetime
from typing import Literal, override
from uuid import uuid4

import pytest
from sqlalchemy import Connection, Engine, ExecutionContext, event, select, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.tools.entities.tool_entities import ApiProviderSchemaType
from graphon.variables import StringVariable
from models.account import Account, Tenant, TenantStatus
from models.dataset import Dataset
from models.enums import CustomizeTokenStrategy
from models.model import App, AppMode, AppModelConfig, IconType, Site
from models.tools import ApiToolProvider, WorkflowToolProvider
from models.workflow import Workflow, WorkflowType
from repositories.app_preview_query_repository import AppPreviewQueryRepository
from services.app_definition_query_service import AppSiteConfiguration
from services.app_preview_details_service import AppPreviewAccount
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


@pytest.fixture
def detail_config(sqlite_session_factory: sessionmaker[Session], preview_ref: AppPreviewRef) -> AppModelConfig:
    config = AppModelConfig(
        app_id=preview_ref.app_id,
        opening_statement="Stored opening",
        agent_mode=json.dumps(
            {
                "enabled": True,
                "strategy": "react",
                "tools": [
                    {
                        "provider_type": "builtin",
                        "provider_id": "acme/search/search",
                        "tool_name": "search",
                        "tool_parameters": {"api_key": "encrypted-tool-secret"},
                    }
                ],
            }
        ),
    )
    account = Account(name="Viewer", email="preview@example.com")
    account.id = _CREATOR_ID
    with sqlite_session_factory.begin() as session:
        session.add_all([account, config])
        session.flush()
        app = session.get(App, preview_ref.app_id)
        assert app is not None
        app.app_model_config_id = config.id
    return config


def test_get_detail_returns_read_only_detached_values_before_mode_and_tool_enrichment(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    preview_ref: AppPreviewRef,
    detail_config: AppModelConfig,
) -> None:
    closed: list[Session] = []
    mutated: list[object] = []
    writes: list[str] = []

    class TrackedSession(Session):
        @override
        def close(self) -> None:
            mutated.extend(self.new)
            mutated.extend(self.dirty)
            mutated.extend(self.deleted)
            super().close()
            closed.append(self)

    def record_writes(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().split(maxsplit=1)[0].upper() in {"INSERT", "UPDATE", "DELETE"}:
            writes.append(statement)

    factory: sessionmaker[Session] = sessionmaker(bind=sqlite_engine, class_=TrackedSession, expire_on_commit=False)
    repository = AppPreviewQueryRepository(session_factory=factory)
    event.listen(sqlite_engine, "before_cursor_execute", record_writes)
    try:
        record = repository.get_detail(app=preview_ref, account_id=_CREATOR_ID)
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_writes)

    assert isinstance(sqlite_engine.pool, QueuePool)
    assert sqlite_engine.pool.checkedout() == 0
    assert closed
    assert all(not session.in_transaction() and not session.identity_map for session in closed)
    assert mutated == []
    assert writes == []
    assert record.detail.id == preview_ref.app_id
    assert record.detail.mode == AppMode.CHAT
    assert record.detail.site.title == "Preview Site"
    assert record.detail.model_config is not None
    assert record.detail.model_config["opening_statement"] == "Stored opening"
    assert record.detail.model_config["agent_mode"] == json.loads(detail_config.agent_mode or "{}")
    assert record.detail.deleted_tools == ()
    assert record.existing_api_provider_ids == frozenset()

    def serialize_date(value: object) -> str:
        assert isinstance(value, datetime), f"Non-data value escaped repository: {type(value)}"
        return value.isoformat()

    json.dumps(asdict(record.detail), default=serialize_date)
    with sqlite_session_factory() as session:
        assert session.scalar(select(App.mode).where(App.id == preview_ref.app_id)) == AppMode.CHAT
        assert session.scalar(select(AppModelConfig.agent_mode).where(AppModelConfig.id == detail_config.id)) == (
            detail_config.agent_mode
        )


def test_get_detail_resolves_only_configured_api_providers_owned_by_app_tenant(
    sqlite_session_factory: sessionmaker[Session], preview_ref: AppPreviewRef, detail_config: AppModelConfig
) -> None:
    owner_provider, viewer_provider, unconfigured_provider = [
        ApiToolProvider(
            name=name,
            icon="icon",
            schema="{}",
            schema_type_str=ApiProviderSchemaType.OPENAPI,
            user_id=_CREATOR_ID,
            tenant_id=tenant_id,
            description=name,
            tools_str="[]",
            credentials_str="{}",
        )
        for name, tenant_id in [
            ("Owner provider", preview_ref.tenant_id),
            ("Viewer provider", _DECOY_TENANT_ID),
            ("Unconfigured provider", preview_ref.tenant_id),
        ]
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all([owner_provider, viewer_provider, unconfigured_provider])
        config = session.get(AppModelConfig, detail_config.id)
        assert config is not None
        config.agent_mode = json.dumps(
            {
                "enabled": False,
                "tools": [
                    {
                        "provider_type": "api",
                        "provider_id": provider_id,
                        "tool_name": "search",
                        "tool_parameters": {},
                    }
                    for provider_id in [owner_provider.id, viewer_provider.id, owner_provider.id, str(uuid4())]
                ],
            }
        )

    record = AppPreviewQueryRepository(session_factory=sqlite_session_factory).get_detail(
        app=preview_ref, account_id=_CREATOR_ID
    )

    assert record.existing_api_provider_ids == frozenset({owner_provider.id})
    assert record.detail.deleted_tools == ()


@pytest.mark.parametrize(
    "stored_environment",
    [
        pytest.param("{invalid-json", id="unparsed-invalid-json"),
        pytest.param(
            '{"secret":{"id":"secret","name":"api_key","value_type":"secret",'
            '"value":"encrypted-workflow-secret","selector":[]}}',
            id="undecrypted-secret",
        ),
    ],
)
def test_get_workflow_returns_detached_data_and_raw_environment_after_session_closes(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    preview_ref: AppPreviewRef,
    stored_environment: str,
) -> None:
    author = Account(name="Author", email="author@example.com")
    author.id = _CREATOR_ID
    updater = Account(name="Updater", email="updater@example.com")
    stored_features = json.dumps(
        {
            "opening_statement": "Workflow opening",
            "file_upload": {"image": {"enabled": True, "number_limits": 3, "transfer_methods": ["local_file"]}},
        }
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([author, updater])
        session.flush()
        workflow = Workflow(
            tenant_id=preview_ref.tenant_id,
            app_id=preview_ref.app_id,
            type=WorkflowType.CHAT,
            version="published",
            graph='{"nodes":[],"edges":[]}',
            features=stored_features,
            created_by=author.id,
            updated_by=updater.id,
            marked_name="Release",
            marked_comment="Preview snapshot",
        )
        workflow.created_at = _CREATED_AT
        workflow.updated_at = _CREATED_AT
        workflow._environment_variables = stored_environment
        workflow.conversation_variables = [
            StringVariable(id="topic", name="topic", value="sqlite", selector=["conversation", "topic"])
        ]
        session.add(workflow)
        session.flush()
        app = session.get(App, preview_ref.app_id)
        assert app is not None
        app.workflow_id = workflow.id
        session.add(
            WorkflowToolProvider(
                name="preview-workflow",
                label="Preview workflow",
                icon="icon",
                app_id=preview_ref.app_id,
                version="1.0.0",
                user_id=author.id,
                tenant_id=preview_ref.tenant_id,
                description="Workflow provider",
                parameter_configuration="[]",
            )
        )

    closed: list[Session] = []
    mutated: list[object] = []

    class TrackedSession(Session):
        @override
        def close(self) -> None:
            mutated.extend(self.new)
            mutated.extend(self.dirty)
            mutated.extend(self.deleted)
            super().close()
            closed.append(self)

    factory: sessionmaker[Session] = sessionmaker(bind=sqlite_engine, class_=TrackedSession, expire_on_commit=False)
    record = AppPreviewQueryRepository(session_factory=factory).get_workflow(app=preview_ref)

    assert isinstance(sqlite_engine.pool, QueuePool)
    assert sqlite_engine.pool.checkedout() == 0
    assert closed
    assert all(not session.in_transaction() and not session.identity_map for session in closed)
    assert mutated == []
    assert record.tenant_id == preview_ref.tenant_id
    assert record.environment_variables_json == stored_environment
    result = record.workflow
    assert result.environment_variables == ()
    assert result.id == workflow.id
    assert result.graph == {"nodes": [], "edges": []}
    assert result.features == {
        "opening_statement": "Workflow opening",
        "file_upload": {
            "enabled": True,
            "number_limits": 3,
            "allowed_file_upload_methods": ["local_file"],
            "allowed_file_types": ["image"],
            "allowed_file_extensions": [],
        },
    }
    assert result.hash == workflow.unique_hash
    assert result.version == "published"
    assert result.marked_name == "Release"
    assert result.marked_comment == "Preview snapshot"
    assert result.created_by == AppPreviewAccount(id=author.id, name="Author", email="author@example.com")
    assert result.updated_by == AppPreviewAccount(id=updater.id, name="Updater", email="updater@example.com")
    assert result.created_at == _CREATED_AT
    assert result.updated_at == _CREATED_AT
    assert result.tool_published is True
    assert len(result.conversation_variables) == 1
    assert result.conversation_variables[0]["name"] == "topic"
    assert result.conversation_variables[0]["value"] == "sqlite"
    assert result.conversation_variables[0]["value_type"] == "string"
    assert result.rag_pipeline_variables == ()

    def serialize_date(value: object) -> str:
        assert isinstance(value, datetime), f"Non-data value escaped repository: {type(value)}"
        return value.isoformat()

    json.dumps(asdict(record), default=serialize_date)
    with sqlite_session_factory() as session:
        assert session.scalar(select(Workflow._features).where(Workflow.id == workflow.id)) == stored_features
        assert (
            session.scalar(select(Workflow._environment_variables).where(Workflow.id == workflow.id))
            == stored_environment
        )
