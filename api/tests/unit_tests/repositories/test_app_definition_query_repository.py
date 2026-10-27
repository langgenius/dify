import json
from typing import Any
from uuid import NAMESPACE_URL, uuid5

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from core.app.apps.agent_app.errors import AgentAppGeneratorError, AgentAppNotPublishedError
from core.tools.entities.tool_entities import ApiProviderSchemaType
from machinery.context import AppRequestContext
from models.account import Account, Tenant, TenantStatus
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.enums import CustomizeTokenStrategy, TagType
from models.model import App, AppAnnotationSetting, AppMode, AppModelConfig, IconType, Site, Tag, TagBinding
from models.tools import ApiToolProvider
from models.workflow import Workflow, WorkflowKind, WorkflowType
from repositories.app.console_repository import ConsoleAppRepository
from repositories.app_definition_query_repository import (
    AppDefinitionQueryRepository,
    _get_public_agent_parameter_config,
)
from services.app_definition_query_service import (
    AppDefinitionSummary,
    AppParameterConfig,
    AppSiteConfiguration,
    AppToolIconSource,
)
from services.web_app_runtime_query_service import WebAppRuntimeRecord

_APP_ID = "11111111-1111-1111-1111-111111111111"
_TENANT_ID = "22222222-2222-2222-2222-222222222222"
_ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"
_WORKFLOW_ID = "44444444-4444-4444-4444-444444444444"
_PROVIDER_ID = "55555555-5555-5555-5555-555555555555"
_MISSING_PROVIDER_ID = "66666666-6666-6666-6666-666666666666"
_OTHER_TENANT_ID = "77777777-7777-7777-7777-777777777777"


def _persist_app(
    session: Session,
    *,
    mode: AppMode = AppMode.CHAT,
    created_by: str | None = None,
) -> App:
    app = App(
        id=_APP_ID,
        tenant_id=_TENANT_ID,
        name="Parameter app",
        description="",
        mode=mode,
        icon_type=None,
        icon=None,
        icon_background=None,
        enable_site=True,
        enable_api=True,
        is_public=True,
        max_active_requests=None,
        created_by=created_by,
    )
    session.add(app)
    session.flush()
    return app


def test_get_mode_returns_none_for_missing_app(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = AppDefinitionQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_mode(_APP_ID) is None


def test_get_mode_returns_app_mode(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        _persist_app(session, mode=AppMode.COMPLETION)

    repository = AppDefinitionQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_mode(_APP_ID) == AppMode.COMPLETION.value


def test_get_published_parameter_config_returns_none_for_missing_app(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = AppDefinitionQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_published_parameter_config(_APP_ID) is None


@pytest.mark.parametrize(
    ("mode", "ownership"),
    [
        (mode, ownership)
        for mode in (AppMode.CHAT, AppMode.WORKFLOW, AppMode.ADVANCED_CHAT)
        for ownership in ("owned", "foreign_app", "missing", "unset")
    ]
    + [(AppMode.WORKFLOW, "foreign_tenant"), (AppMode.ADVANCED_CHAT, "foreign_tenant")],
)
def test_parameter_config_readers_enforce_the_same_ownership(
    sqlite_session_factory: sessionmaker[Session], mode: AppMode, ownership: str
) -> None:
    with sqlite_session_factory.begin() as session:
        app = _persist_app(session, mode=mode)
        owner_id = _PROVIDER_ID if ownership == "foreign_app" else app.id
        if mode == AppMode.CHAT:
            config = AppModelConfig(app_id=owner_id, opening_statement="Owned config")
            app.app_model_config_id = config.id if ownership != "unset" else None
        else:
            config = Workflow(
                id=_WORKFLOW_ID,
                tenant_id=_OTHER_TENANT_ID if ownership == "foreign_tenant" else _TENANT_ID,
                app_id=owner_id,
                type=WorkflowType.WORKFLOW if mode == AppMode.WORKFLOW else WorkflowType.CHAT,
                version="1",
                graph='{"nodes": []}',
                _features='{"opening_statement": "Owned config"}',
                created_by=_ACCOUNT_ID,
            )
            app.workflow_id = config.id if ownership != "unset" else None
        if ownership != "missing":
            session.add(config)

    definition = AppDefinitionQueryRepository(session_factory=sqlite_session_factory).get_published_parameter_config(
        _APP_ID
    )
    description = ConsoleAppRepository(session_factory=sqlite_session_factory).describe(
        AppRequestContext(tenant_id=_TENANT_ID, app_id=_APP_ID), include_config=True
    )

    assert definition == description.config
    if ownership == "owned":
        assert definition is not None
        assert definition.features_dict["opening_statement"] == "Owned config"
    else:
        assert definition is None


@pytest.mark.parametrize(
    ("mode", "workflow_type"),
    [
        pytest.param(AppMode.WORKFLOW, WorkflowType.WORKFLOW, id="workflow"),
        pytest.param(AppMode.ADVANCED_CHAT, WorkflowType.CHAT, id="advanced-chat"),
    ],
)
def test_get_published_parameter_config_returns_workflow_features_and_legacy_input_form(
    sqlite_session_factory: sessionmaker[Session],
    mode: AppMode,
    workflow_type: WorkflowType,
) -> None:
    variable = {
        "variable": "query",
        "label": "Query",
        "type": "text-input",
        "required": True,
        "max_length": 48,
    }
    with sqlite_session_factory() as session:
        app = _persist_app(session, mode=mode)
        workflow = Workflow(
            id="44444444-4444-4444-4444-444444444444",
            tenant_id=_TENANT_ID,
            app_id=app.id,
            type=WorkflowType(workflow_type),
            kind=WorkflowKind.STANDARD,
            version="1",
            graph=json.dumps({"nodes": [{"id": "start", "data": {"type": "start", "variables": [variable]}}]}),
            _features=json.dumps({"opening_statement": "Hello from workflow"}),
            created_by=_ACCOUNT_ID,
            _environment_variables=[],
            _conversation_variables=[],
            _rag_pipeline_variables=[],
        )
        session.add(workflow)
        app.workflow_id = workflow.id
        session.commit()

    result = AppDefinitionQueryRepository(session_factory=sqlite_session_factory).get_published_parameter_config(
        _APP_ID
    )

    assert result == AppParameterConfig(
        features_dict={"opening_statement": "Hello from workflow"},
        user_input_form=[{"text-input": variable}],
    )


def test_get_published_parameter_config_returns_none_for_workflow_without_published_workflow(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        _persist_app(session, mode=AppMode.WORKFLOW)
        session.commit()

    repository = AppDefinitionQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_published_parameter_config(_APP_ID) is None


def test_get_published_parameter_config_returns_model_config_and_annotation_projection(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    user_input_form = [{"paragraph": {"variable": "details", "label": "Details", "required": False}}]
    with sqlite_session_factory() as session:
        app = _persist_app(session)
        app_model_config = AppModelConfig(
            app_id=app.id,
            opening_statement="Hello from model config",
            user_input_form=json.dumps(user_input_form),
        )
        session.add(app_model_config)
        session.flush()
        app.app_model_config_id = app_model_config.id
        session.commit()

    result = AppDefinitionQueryRepository(session_factory=sqlite_session_factory).get_published_parameter_config(
        _APP_ID
    )

    assert result is not None
    assert result.features_dict["opening_statement"] == "Hello from model config"
    assert result.features_dict["annotation_reply"] == {"enabled": False}
    assert result.user_input_form == user_input_form


def test_get_published_parameter_config_returns_none_for_app_without_published_model_config(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        _persist_app(session)
        session.commit()

    repository = AppDefinitionQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_published_parameter_config(_APP_ID) is None


def test_get_published_parameter_config_preserves_legacy_agent_model_config(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        app = _persist_app(session, mode=AppMode.AGENT)
        app_model_config = AppModelConfig(app_id=app.id, opening_statement="Legacy Agent config")
        session.add(app_model_config)
        session.flush()
        app.app_model_config_id = app_model_config.id
        session.commit()

    result = AppDefinitionQueryRepository(session_factory=sqlite_session_factory).get_published_parameter_config(
        _APP_ID
    )

    assert result is not None
    assert result.features_dict["opening_statement"] == "Legacy Agent config"


def test_get_public_parameter_config_reuses_standard_projection(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        app = _persist_app(session)
        app_model_config = AppModelConfig(app_id=app.id, opening_statement="Public config")
        session.add(app_model_config)
        session.flush()
        app.app_model_config_id = app_model_config.id
        session.commit()

    result = AppDefinitionQueryRepository(session_factory=sqlite_session_factory).get_published_parameter_config(
        _APP_ID, public_runtime=True
    )

    assert result is not None
    assert result.features_dict["opening_statement"] == "Public config"


def test_get_summary_returns_none_for_missing_app(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = AppDefinitionQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_summary(_APP_ID) is None


def test_get_summary_maps_app_mode_and_author(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        _persist_app(session, mode=AppMode.WORKFLOW, created_by=_ACCOUNT_ID)
        account = Account(name="Test Author", email="owner@example.com")
        account.id = _ACCOUNT_ID
        session.add(account)

    result = AppDefinitionQueryRepository(session_factory=sqlite_session_factory).get_summary(_APP_ID)

    assert result == AppDefinitionSummary(
        name="Parameter app",
        description="",
        tags=(),
        mode=AppMode.WORKFLOW.value,
        author_name="Test Author",
    )


def test_get_summary_returns_only_tenant_scoped_app_tags(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        app = _persist_app(session)
        visible = Tag(tenant_id=_TENANT_ID, type=TagType.APP, name="visible", created_by=_ACCOUNT_ID)
        visible_second = Tag(
            tenant_id=_TENANT_ID,
            type=TagType.APP,
            name="visible-second",
            created_by=_ACCOUNT_ID,
        )
        foreign_tag = Tag(
            tenant_id=_OTHER_TENANT_ID,
            type=TagType.APP,
            name="foreign-tag",
            created_by=_ACCOUNT_ID,
        )
        foreign_binding = Tag(
            tenant_id=_TENANT_ID,
            type=TagType.APP,
            name="foreign-binding",
            created_by=_ACCOUNT_ID,
        )
        knowledge = Tag(
            tenant_id=_TENANT_ID,
            type=TagType.KNOWLEDGE,
            name="knowledge",
            created_by=_ACCOUNT_ID,
        )
        session.add_all([visible, visible_second, foreign_tag, foreign_binding, knowledge])
        session.flush()
        session.add_all(
            [
                TagBinding(
                    tenant_id=_TENANT_ID,
                    tag_id=visible.id,
                    target_id=app.id,
                    created_by=_ACCOUNT_ID,
                ),
                TagBinding(
                    tenant_id=_TENANT_ID,
                    tag_id=visible_second.id,
                    target_id=app.id,
                    created_by=_ACCOUNT_ID,
                ),
                TagBinding(
                    tenant_id=_TENANT_ID,
                    tag_id=foreign_tag.id,
                    target_id=app.id,
                    created_by=_ACCOUNT_ID,
                ),
                TagBinding(
                    tenant_id=_OTHER_TENANT_ID,
                    tag_id=foreign_binding.id,
                    target_id=app.id,
                    created_by=_ACCOUNT_ID,
                ),
                TagBinding(
                    tenant_id=_TENANT_ID,
                    tag_id=knowledge.id,
                    target_id=app.id,
                    created_by=_ACCOUNT_ID,
                ),
            ]
        )

    result = AppDefinitionQueryRepository(session_factory=sqlite_session_factory).get_summary(_APP_ID)

    assert result is not None
    assert set(result.tags) == {"visible", "visible-second"}
    assert result.author_name is None


def test_get_site_configuration_returns_none_for_missing_site(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = AppDefinitionQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_site_configuration(_APP_ID) is None


def test_get_site_configuration_maps_site_fields(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        site = Site(
            app_id=_APP_ID,
            title="Test Site",
            icon_type=IconType.IMAGE,
            icon="11111111-1111-4111-8111-111111111111",
            icon_background="#ffffff",
            description="A test site",
            default_language="en-US",
            chat_color_theme="light",
            chat_color_theme_inverted=True,
            copyright="Copyright",
            privacy_policy="Privacy",
            input_placeholder="Ask anything",
            show_workflow_steps=False,
            use_icon_as_answer_icon=True,
            customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
            prompt_public=True,
        )
        site.custom_disclaimer = "Disclaimer"
        session.add(site)

    result = AppDefinitionQueryRepository(session_factory=sqlite_session_factory).get_site_configuration(_APP_ID)

    assert result == AppSiteConfiguration(
        title="Test Site",
        chat_color_theme="light",
        chat_color_theme_inverted=True,
        icon_type=IconType.IMAGE.value,
        icon="11111111-1111-4111-8111-111111111111",
        icon_background="#ffffff",
        description="A test site",
        copyright="Copyright",
        privacy_policy="Privacy",
        input_placeholder="Ask anything",
        custom_disclaimer="Disclaimer",
        default_language="en-US",
        prompt_public=True,
        show_workflow_steps=False,
        use_icon_as_answer_icon=True,
    )


@pytest.mark.parametrize(
    ("tenant_status", "expected_mode"),
    [
        (TenantStatus.NORMAL, AppMode.AGENT_CHAT.value),
        (TenantStatus.ARCHIVE, AppMode.CHAT.value),
    ],
)
def test_get_runtime_record_maps_app_tenant_site_and_compatible_mode(
    sqlite_session_factory: sessionmaker[Session],
    tenant_status: TenantStatus,
    expected_mode: str,
) -> None:
    tenant_custom_config = '{"remove_webapp_brand":true,"replace_webapp_logo":"logo-file"}'
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(
            name="Test Tenant",
            plan="pro",
            status=tenant_status,
            custom_config=tenant_custom_config,
        )
        tenant.id = _TENANT_ID
        session.add(tenant)
        app = _persist_app(session)
        app_model_config = AppModelConfig(
            app_id=app.id,
            agent_mode=json.dumps({"enabled": True, "strategy": "react"}),
        )
        session.add(app_model_config)
        session.flush()
        app.app_model_config_id = app_model_config.id
        session.add(
            Site(
                app_id=app.id,
                title="Test Site",
                icon_type=IconType.IMAGE,
                icon="11111111-1111-4111-8111-111111111111",
                icon_background="#ffffff",
                default_language="en-US",
                chat_color_theme="light",
                chat_color_theme_inverted=False,
                customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
                prompt_public=True,
                show_workflow_steps=True,
                use_icon_as_answer_icon=False,
            )
        )

    repository = AppDefinitionQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_runtime_record(_APP_ID) == WebAppRuntimeRecord(
        app_id=_APP_ID,
        tenant_id=_TENANT_ID,
        mode=expected_mode,
        enable_site=True,
        site=AppSiteConfiguration(
            title="Test Site",
            chat_color_theme="light",
            chat_color_theme_inverted=False,
            icon_type=IconType.IMAGE.value,
            icon="11111111-1111-4111-8111-111111111111",
            icon_background="#ffffff",
            description=None,
            copyright=None,
            privacy_policy=None,
            input_placeholder=None,
            custom_disclaimer="",
            default_language="en-US",
            prompt_public=True,
            show_workflow_steps=True,
            use_icon_as_answer_icon=False,
        ),
        plan="pro",
        tenant_status=tenant_status.value,
        tenant_custom_config_json=tenant_custom_config,
    )


def test_get_runtime_record_returns_none_for_missing_app(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = AppDefinitionQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_runtime_record(_APP_ID) is None


def _tool(provider_type: str, provider_id: str, tool_name: str) -> dict[str, object]:
    return {
        "provider_type": provider_type,
        "provider_id": provider_id,
        "tool_name": tool_name,
        "tool_parameters": {},
    }


def test_get_tool_icon_sources_returns_none_for_missing_app(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = AppDefinitionQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_tool_icon_sources(_APP_ID) is None


@pytest.mark.parametrize(
    ("mode", "workflow_type"),
    [
        pytest.param(AppMode.WORKFLOW, WorkflowType.WORKFLOW, id="workflow"),
        pytest.param(AppMode.ADVANCED_CHAT, WorkflowType.CHAT, id="advanced-chat"),
    ],
)
def test_get_tool_icon_sources_reads_workflow_tools(
    sqlite_session_factory: sessionmaker[Session],
    mode: AppMode,
    workflow_type: WorkflowType,
) -> None:
    with sqlite_session_factory() as session:
        app = _persist_app(session, mode=mode)
        workflow = Workflow(
            id=_WORKFLOW_ID,
            tenant_id=_TENANT_ID,
            app_id=app.id,
            type=WorkflowType(workflow_type),
            kind=WorkflowKind.STANDARD,
            version="1",
            graph=json.dumps(
                {
                    "nodes": [
                        {"id": "start", "data": {"type": "start"}},
                        {"id": "tool", "data": {"type": "tool", **_tool("builtin", "search", "search")}},
                    ]
                }
            ),
            _features="{}",
            created_by=_ACCOUNT_ID,
            _environment_variables=[],
            _conversation_variables=[],
            _rag_pipeline_variables=[],
        )
        session.add(workflow)
        app.workflow_id = workflow.id
        session.commit()

    result = AppDefinitionQueryRepository(session_factory=sqlite_session_factory).get_tool_icon_sources(_APP_ID)

    assert result == (AppToolIconSource("builtin", "search", "search", None),)


def test_get_tool_icon_sources_reads_model_config_and_api_provider_icons(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        app = _persist_app(session)
        tools = [
            _tool("builtin", "search", "search"),
            _tool("api", _PROVIDER_ID, "weather"),
            _tool("api", _MISSING_PROVIDER_ID, "missing"),
            _tool("workflow", "workflow-provider", "workflow-tool"),
            {"provider_type": "builtin", "provider_id": "legacy", "tool_name": "legacy"},
        ]
        app_model_config = AppModelConfig(
            app_id=app.id,
            agent_mode=json.dumps({"enabled": True, "strategy": "react", "tools": tools, "prompt": None}),
        )
        provider = ApiToolProvider(
            name="Weather",
            icon='{"background":"#fff","content":"W"}',
            schema="{}",
            schema_type_str=ApiProviderSchemaType.OPENAPI,
            user_id=_ACCOUNT_ID,
            tenant_id=_TENANT_ID,
            description="",
            tools_str="[]",
            credentials_str="{}",
        )
        provider.id = _PROVIDER_ID
        session.add_all([app_model_config, provider])
        session.flush()
        app.app_model_config_id = app_model_config.id
        session.commit()

    result = AppDefinitionQueryRepository(session_factory=sqlite_session_factory).get_tool_icon_sources(_APP_ID)

    assert result == (
        AppToolIconSource("builtin", "search", "search", None),
        AppToolIconSource("api", _PROVIDER_ID, "weather", '{"background":"#fff","content":"W"}'),
        AppToolIconSource("api", _MISSING_PROVIDER_ID, "missing", None),
        AppToolIconSource("workflow", "workflow-provider", "workflow-tool", None),
    )


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.WORKFLOW])
def test_get_tool_icon_sources_returns_empty_for_missing_published_config(
    sqlite_session_factory: sessionmaker[Session],
    mode: AppMode,
) -> None:
    with sqlite_session_factory() as session:
        _persist_app(session, mode=mode)
        session.commit()

    repository = AppDefinitionQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_tool_icon_sources(_APP_ID) == ()


def _stable_uuid(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


def _app_model(*, tenant_id: str, app_model_config: AppModelConfig | None = None) -> App:
    return App(
        id=_stable_uuid(f"app:{tenant_id}"),
        tenant_id=tenant_id,
        name="Agent App",
        mode=AppMode.AGENT,
        app_model_config_id=app_model_config.id if app_model_config else None,
    )


def _persist_agent(
    session: Session,
    *,
    tenant_id: str,
    agent_id: str,
    active_config_snapshot_id: str | None,
    active_config_is_published: bool,
    app_id: str | None = None,
) -> Agent:
    agent = Agent(
        id=agent_id,
        tenant_id=tenant_id,
        name="Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id=active_config_snapshot_id,
        active_config_is_published=active_config_is_published,
        app_id=app_id,
    )
    session.add(agent)
    session.commit()
    return agent


def _persist_snapshot(
    session: Session,
    *,
    snapshot_id: str,
    tenant_id: str,
    agent_id: str,
    config_snapshot: dict[str, Any],
    publish_visible: bool = True,
) -> AgentConfigSnapshot:
    snapshot = AgentConfigSnapshot(
        id=snapshot_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        version=1,
        home_snapshot_id=_stable_uuid(f"home-snapshot:{snapshot_id}"),
        config_snapshot=config_snapshot,
    )
    session.add(snapshot)
    if publish_visible:
        _persist_publish_revision(
            session,
            snapshot_id=snapshot_id,
            tenant_id=tenant_id,
            agent_id=agent_id,
            commit=False,
        )
    session.commit()
    return snapshot


def _persist_publish_revision(
    session: Session,
    *,
    snapshot_id: str,
    tenant_id: str,
    agent_id: str,
    commit: bool = True,
) -> None:
    session.add(
        AgentConfigRevision(
            tenant_id=tenant_id,
            agent_id=agent_id,
            current_snapshot_id=snapshot_id,
            revision=1,
            operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
        )
    )
    if commit:
        session.commit()


def test_get_public_parameter_config_loads_agent_snapshot(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant_id = _stable_uuid("tenant:repository")
    app_id = _stable_uuid("app:repository")
    agent_id = _stable_uuid("agent:repository")
    snapshot_id = _stable_uuid("snapshot:repository")
    with sqlite_session_factory() as session:
        session.add(
            App(
                id=app_id,
                tenant_id=tenant_id,
                name="Agent App",
                description="",
                mode=AppMode.AGENT,
                icon_type=None,
                icon=None,
                icon_background=None,
                enable_site=True,
                enable_api=True,
                max_active_requests=None,
            )
        )
        session.commit()
        _persist_agent(
            session,
            tenant_id=tenant_id,
            agent_id=agent_id,
            active_config_snapshot_id=snapshot_id,
            active_config_is_published=True,
            app_id=app_id,
        )
        _persist_snapshot(
            session,
            snapshot_id=snapshot_id,
            tenant_id=tenant_id,
            agent_id=agent_id,
            config_snapshot={"app_variables": [{"name": "topic", "type": "string", "required": True}]},
        )

    result = AppDefinitionQueryRepository(session_factory=sqlite_session_factory).get_published_parameter_config(
        app_id, public_runtime=True
    )

    assert result is not None
    assert result.user_input_form == [{"text-input": {"label": "topic", "variable": "topic", "required": True}}]


@pytest.mark.parametrize(
    "sqlite_session",
    [(Agent, AgentConfigSnapshot, AgentConfigRevision, AppAnnotationSetting, AppModelConfig)],
    indirect=True,
)
@pytest.mark.parametrize("foreign_model_config", [False, True])
def test_published_agent_app_parameters_use_soul_file_upload(
    sqlite_session: Session, foreign_model_config: bool
) -> None:
    tenant_id = _stable_uuid("tenant:one")
    agent_id = _stable_uuid("agent:one")
    snapshot_id = _stable_uuid("snapshot:one")
    app_model_config = AppModelConfig(
        app_id=_stable_uuid("foreign-app") if foreign_model_config else _stable_uuid(f"app:{tenant_id}"),
        opening_statement="Hi from legacy presentation config",
        file_upload=json.dumps({"enabled": False, "image": {"enabled": False}}),
    )
    sqlite_session.add(app_model_config)
    sqlite_session.commit()
    app_model = _app_model(tenant_id=tenant_id, app_model_config=app_model_config)
    _persist_agent(
        sqlite_session,
        tenant_id=tenant_id,
        agent_id=agent_id,
        active_config_snapshot_id=snapshot_id,
        active_config_is_published=True,
        app_id=app_model.id,
    )
    _persist_snapshot(
        sqlite_session,
        snapshot_id=snapshot_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        config_snapshot={
            "app_features": {
                "file_upload": {
                    "enabled": True,
                    "allowed_file_extensions": ["PNG"],
                    "allowed_file_types": ["image"],
                    "allowed_file_upload_methods": ["local_file"],
                    "image": {"enabled": True},
                    "number_limits": 2,
                }
            },
            "app_variables": [{"name": "topic", "type": "string", "required": True}],
        },
    )

    features_dict, user_input_form = _get_public_agent_parameter_config(
        app_model,
        session=sqlite_session,
    )
    parameters = get_parameters_from_feature_dict(features_dict=features_dict, user_input_form=user_input_form)

    assert parameters["opening_statement"] == (None if foreign_model_config else "Hi from legacy presentation config")
    assert parameters["file_upload"] == {
        "enabled": True,
        "allowed_file_extensions": ["PNG"],
        "allowed_file_types": ["image"],
        "allowed_file_upload_methods": ["local_file"],
        "image": {"enabled": True},
        "number_limits": 2,
    }
    assert parameters["user_input_form"] == [{"text-input": {"label": "topic", "variable": "topic", "required": True}}]


@pytest.mark.parametrize("sqlite_session", [(Agent, AgentConfigSnapshot, AgentConfigRevision)], indirect=True)
def test_published_agent_app_parameters_requires_bound_agent(sqlite_session: Session):
    tenant_id = _stable_uuid("tenant:unbound")
    app_model = _app_model(tenant_id=tenant_id)

    with pytest.raises(AgentAppGeneratorError, match="no bound Agent"):
        _get_public_agent_parameter_config(app_model, session=sqlite_session)


@pytest.mark.parametrize("sqlite_session", [(Agent, AgentConfigSnapshot, AgentConfigRevision)], indirect=True)
def test_published_agent_app_parameters_requires_existing_active_agent(sqlite_session: Session):
    requested_tenant_id = _stable_uuid("tenant:requested")
    agent_id = _stable_uuid("agent:cross-tenant")
    app_model = _app_model(tenant_id=requested_tenant_id)
    _persist_agent(
        sqlite_session,
        tenant_id=_stable_uuid("tenant:other"),
        agent_id=agent_id,
        active_config_snapshot_id=None,
        active_config_is_published=False,
        app_id=app_model.id,
    )

    with pytest.raises(AgentAppGeneratorError, match="no bound Agent"):
        _get_public_agent_parameter_config(app_model, session=sqlite_session)


@pytest.mark.parametrize("active_config_is_published", [True, False])
@pytest.mark.parametrize("sqlite_session", [(Agent, AgentConfigSnapshot, AgentConfigRevision)], indirect=True)
def test_published_agent_app_parameters_requires_published_agent(
    active_config_is_published: bool, sqlite_session: Session
):
    tenant_id = _stable_uuid(f"tenant:published:{active_config_is_published}")
    agent_id = _stable_uuid(f"agent:published:{active_config_is_published}")
    app_model = _app_model(tenant_id=tenant_id)
    _persist_agent(
        sqlite_session,
        tenant_id=tenant_id,
        agent_id=agent_id,
        active_config_snapshot_id=None,
        active_config_is_published=active_config_is_published,
        app_id=app_model.id,
    )

    with pytest.raises(AgentAppNotPublishedError, match="not been published"):
        _get_public_agent_parameter_config(app_model, session=sqlite_session)


@pytest.mark.parametrize("sqlite_session", [(Agent, AgentConfigSnapshot, AgentConfigRevision)], indirect=True)
def test_published_agent_app_parameters_allows_unpublished_draft_with_active_snapshot(sqlite_session: Session):
    tenant_id = _stable_uuid("tenant:unpublished-draft")
    agent_id = _stable_uuid("agent:unpublished-draft")
    snapshot_id = _stable_uuid("snapshot:unpublished-draft")
    app_model = _app_model(tenant_id=tenant_id)
    _persist_agent(
        sqlite_session,
        tenant_id=tenant_id,
        agent_id=agent_id,
        active_config_snapshot_id=snapshot_id,
        active_config_is_published=False,
        app_id=app_model.id,
    )
    _persist_snapshot(
        sqlite_session,
        snapshot_id=snapshot_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        config_snapshot={},
    )

    features_dict, user_input_form = _get_public_agent_parameter_config(
        app_model,
        session=sqlite_session,
    )

    assert features_dict["file_upload"]["enabled"] is True
    assert user_input_form == []


@pytest.mark.parametrize("sqlite_session", [(Agent, AgentConfigSnapshot, AgentConfigRevision)], indirect=True)
def test_published_agent_app_parameters_rejects_seeded_unpublished_snapshot(sqlite_session: Session):
    tenant_id = _stable_uuid("tenant:never-published")
    agent_id = _stable_uuid("agent:never-published")
    snapshot_id = _stable_uuid("snapshot:never-published")
    app_model = _app_model(tenant_id=tenant_id)
    _persist_agent(
        sqlite_session,
        tenant_id=tenant_id,
        agent_id=agent_id,
        active_config_snapshot_id=snapshot_id,
        active_config_is_published=False,
        app_id=app_model.id,
    )
    _persist_snapshot(
        sqlite_session,
        snapshot_id=snapshot_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        config_snapshot={},
        publish_visible=False,
    )

    with pytest.raises(AgentAppNotPublishedError, match="not been published"):
        _get_public_agent_parameter_config(app_model, session=sqlite_session)


@pytest.mark.parametrize("sqlite_session", [(Agent, AgentConfigSnapshot, AgentConfigRevision)], indirect=True)
def test_published_agent_app_parameters_requires_published_snapshot(sqlite_session: Session):
    tenant_id = _stable_uuid("tenant:missing-snapshot")
    agent_id = _stable_uuid("agent:missing-snapshot")
    app_model = _app_model(tenant_id=tenant_id)
    _persist_agent(
        sqlite_session,
        tenant_id=tenant_id,
        agent_id=agent_id,
        active_config_snapshot_id=_stable_uuid("snapshot:missing"),
        active_config_is_published=True,
        app_id=app_model.id,
    )
    _persist_publish_revision(
        sqlite_session,
        snapshot_id=_stable_uuid("snapshot:missing"),
        tenant_id=tenant_id,
        agent_id=agent_id,
    )

    with pytest.raises(AgentAppGeneratorError, match="published version not found"):
        _get_public_agent_parameter_config(app_model, session=sqlite_session)


@pytest.mark.parametrize("sqlite_session", [(Agent, AgentConfigSnapshot, AgentConfigRevision)], indirect=True)
def test_published_agent_app_parameters_allows_missing_legacy_app_model_config(sqlite_session: Session):
    tenant_id = _stable_uuid("tenant:no-legacy-config")
    agent_id = _stable_uuid("agent:no-legacy-config")
    snapshot_id = _stable_uuid("snapshot:no-legacy-config")
    app_model = _app_model(tenant_id=tenant_id)
    _persist_agent(
        sqlite_session,
        tenant_id=tenant_id,
        agent_id=agent_id,
        active_config_snapshot_id=snapshot_id,
        active_config_is_published=True,
        app_id=app_model.id,
    )
    _persist_snapshot(
        sqlite_session,
        snapshot_id=snapshot_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        config_snapshot={},
    )

    features_dict, user_input_form = _get_public_agent_parameter_config(
        app_model,
        session=sqlite_session,
    )

    assert features_dict["file_upload"] == {
        "allowed_file_extensions": ["JPG", "JPEG", "PNG", "GIF", "WEBP", "SVG"],
        "allowed_file_types": ["document", "image", "audio", "video"],
        "allowed_file_upload_methods": ["local_file", "remote_url"],
        "enabled": True,
        "image": {"enabled": True},
        "number_limits": 3,
    }
    assert user_input_form == []
