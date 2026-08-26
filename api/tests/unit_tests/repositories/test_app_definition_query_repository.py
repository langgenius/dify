import json

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.tools.entities.tool_entities import ApiProviderSchemaType
from models.account import Account, Tenant, TenantStatus
from models.enums import CustomizeTokenStrategy, TagType
from models.model import App, AppMode, AppModelConfig, IconType, Site, Tag, TagBinding
from models.tools import ApiToolProvider
from models.workflow import Workflow, WorkflowKind, WorkflowType
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
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


def test_get_published_parameter_config_returns_none_for_missing_app(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = AppDefinitionQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_published_parameter_config(_APP_ID) is None


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
            type=workflow_type,
            kind=WorkflowKind.STANDARD,
            version="1",
            graph=json.dumps({"nodes": [{"id": "start", "data": {"type": "start", "variables": [variable]}}]}),
            features=json.dumps({"opening_statement": "Hello from workflow"}),
            created_by=_ACCOUNT_ID,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
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
            type=workflow_type,
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
            features="{}",
            created_by=_ACCOUNT_ID,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
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
