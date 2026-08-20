"""Database repository for externally visible app definitions."""

from typing import Any, cast, override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.agent.publish_visibility import agent_has_workflow_callable_active_snapshot
from core.app.apps.agent_app.app_feature_projection import merge_agent_app_features
from core.app.apps.agent_app.app_variable_projection import agent_app_variables_to_user_input_form
from core.app.apps.agent_app.errors import AgentAppGeneratorError, AgentAppNotPublishedError
from models.account import Tenant, TenantStatus
from models.agent import AgentConfigSnapshot
from models.agent_config_entities import AgentSoulConfig
from models.model import App, AppMode, AppModelConfig, Site, load_annotation_reply_config
from models.tools import ApiToolProvider
from models.workflow import Workflow
from services.app_definition_query_service import (
    AppDefinitionQuery,
    AppDefinitionSummary,
    AppParameterConfig,
    AppSiteConfiguration,
    AppToolIconSource,
)
from services.web_app_runtime_query_service import WebAppRuntimeRecord


def _map_site_configuration(site: Site) -> AppSiteConfiguration:
    return AppSiteConfiguration(
        title=site.title,
        chat_color_theme=site.chat_color_theme,
        chat_color_theme_inverted=site.chat_color_theme_inverted,
        icon_type=site.icon_type.value if site.icon_type is not None else None,
        icon=site.icon,
        icon_background=site.icon_background,
        description=site.description,
        copyright=site.copyright,
        privacy_policy=site.privacy_policy,
        input_placeholder=site.input_placeholder,
        custom_disclaimer=site.custom_disclaimer,
        default_language=site.default_language,
        prompt_public=site.prompt_public,
        show_workflow_steps=site.show_workflow_steps,
        use_icon_as_answer_icon=site.use_icon_as_answer_icon,
    )


def _get_public_agent_parameter_config(app: App, *, session: Session) -> AppParameterConfig:
    app_model_config = app.app_model_config_with_session(session=session)
    agent = app.agent_app_binding_with_session(session=session)
    if agent is None:
        raise AgentAppGeneratorError("Agent App has no bound Agent")
    if not agent_has_workflow_callable_active_snapshot(session=session, agent=agent):
        raise AgentAppNotPublishedError("Agent has not been published")

    snapshot = session.scalar(
        select(AgentConfigSnapshot)
        .where(
            AgentConfigSnapshot.tenant_id == app.tenant_id,
            AgentConfigSnapshot.agent_id == agent.id,
            AgentConfigSnapshot.id == agent.active_config_snapshot_id,
        )
        .limit(1)
    )
    if snapshot is None:
        raise AgentAppGeneratorError("Agent published version not found")

    agent_soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
    annotation_reply = load_annotation_reply_config(session, app.id) if app_model_config else None
    return AppParameterConfig(
        features_dict=merge_agent_app_features(
            agent_soul=agent_soul,
            app_model_config=app_model_config,
            annotation_reply=annotation_reply,
        ),
        user_input_form=agent_app_variables_to_user_input_form(agent_soul.app_variables),
    )


class AppDefinitionQueryRepository(AppDefinitionQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_published_parameter_config(
        self,
        app_id: str,
        *,
        public_runtime: bool = False,
    ) -> AppParameterConfig | None:
        with self._session_factory() as session:
            app = session.get(App, app_id)
            if app is None:
                return None

            if public_runtime and app.mode == AppMode.AGENT:
                return _get_public_agent_parameter_config(app, session=session)

            if app.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
                workflow = app.workflow_with_session(session=session)
                if workflow is None:
                    return None

                return AppParameterConfig(
                    features_dict=workflow.features_dict,
                    user_input_form=cast(list[dict[str, Any]], workflow.user_input_form(to_old_structure=True)),
                )

            app_model_config = app.app_model_config_with_session(session=session)
            if app_model_config is None:
                return None

            features_dict = app_model_config.to_dict(
                annotation_reply=load_annotation_reply_config(session, app.id),
            )
            return AppParameterConfig(
                features_dict=features_dict,
                user_input_form=cast(list[dict[str, Any]], features_dict.get("user_input_form", [])),
            )

    @override
    def get_tool_icon_sources(self, app_id: str) -> tuple[AppToolIconSource, ...] | None:
        with self._session_factory() as session:
            app = session.get(App, app_id)
            if app is None:
                return None

            records: list[AppToolIconSource] = []
            for tool in self._get_tools(session, app):
                if len(tool) < 4:
                    continue

                provider_type = str(tool.get("provider_type", ""))
                provider_id = str(tool.get("provider_id", ""))
                tool_name = str(tool.get("tool_name", ""))
                provider_icon: str | None = None
                if provider_type == "api":
                    try:
                        provider = session.get(ApiToolProvider, provider_id)
                        provider_icon = provider.icon if provider is not None else None
                    except Exception:
                        # Preserve the legacy response fallback when a provider cannot be loaded.
                        provider_icon = None

                records.append(
                    AppToolIconSource(
                        provider_type=provider_type,
                        provider_id=provider_id,
                        tool_name=tool_name,
                        provider_icon=provider_icon,
                    )
                )

            return tuple(records)

    @override
    def get_summary(self, app_id: str) -> AppDefinitionSummary | None:
        with self._session_factory() as session:
            app = session.get(App, app_id)
            if app is None:
                return None

            return AppDefinitionSummary(
                name=app.name,
                description=app.description,
                tags=tuple(tag.name for tag in app.tags_with_session(session=session)),
                mode=app.mode.value,
                author_name=app.author_name_with_session(session=session),
            )

    @override
    def get_site_configuration(self, app_id: str) -> AppSiteConfiguration | None:
        with self._session_factory() as session:
            site = session.scalar(select(Site).where(Site.app_id == app_id).limit(1))
            if site is None:
                return None

            return _map_site_configuration(site)

    def get_runtime_record(self, app_id: str) -> WebAppRuntimeRecord | None:
        with self._session_factory() as session:
            app = session.get(App, app_id)
            if app is None:
                return None

            site = session.scalar(select(Site).where(Site.app_id == app_id).limit(1))
            if site is None:
                return None

            tenant = session.get(Tenant, app.tenant_id)
            if tenant is None:
                return None

            app_id = app.id
            tenant_id = app.tenant_id
            enable_site = app.enable_site
            site_configuration = _map_site_configuration(site)
            plan = tenant.plan
            tenant_status = tenant.status.value
            tenant_custom_config_json = tenant.custom_config
            mode = AppMode.value_of(app.mode).value
            if tenant.status != TenantStatus.ARCHIVE:
                mode = AppMode.value_of(app.mode_compatible_with_agent_with_session(session=session)).value
            return WebAppRuntimeRecord(
                app_id=app_id,
                tenant_id=tenant_id,
                mode=mode,
                enable_site=enable_site,
                site=site_configuration,
                plan=plan,
                tenant_status=tenant_status,
                tenant_custom_config_json=tenant_custom_config_json,
            )

    @staticmethod
    def _get_tools(session: Session, app: App) -> list[dict[str, Any]]:
        if app.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow = session.get(Workflow, app.workflow_id) if app.workflow_id else None
            if workflow is None:
                return []

            tools: list[dict[str, Any]] = []
            nodes = cast(list[dict[str, Any]], workflow.graph_dict.get("nodes", []))
            for node in nodes:
                node_data = node.get("data", {})
                if node_data.get("type") == "tool":
                    tools.append(
                        {
                            "provider_type": node_data.get("provider_type"),
                            "provider_id": node_data.get("provider_id"),
                            "tool_name": node_data.get("tool_name"),
                            "tool_parameters": {},
                        }
                    )
            return tools

        app_model_config = session.get(AppModelConfig, app.app_model_config_id) if app.app_model_config_id else None
        if app_model_config is None:
            return []
        return cast(list[dict[str, Any]], app_model_config.agent_mode_dict.get("tools", []))
