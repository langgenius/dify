"""Database repository for externally visible app definitions."""

from typing import Any, cast, override

from sqlalchemy.orm import Session, sessionmaker

from models.model import App, AppMode, AppModelConfig, load_annotation_reply_config
from models.tools import ApiToolProvider
from models.workflow import Workflow
from services.app_definition_query_service import AppDefinitionQuery, AppParameterConfig, AppToolIconSource


class AppDefinitionQueryRepository(AppDefinitionQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_published_parameter_config(self, app_id: str) -> AppParameterConfig | None:
        with self._session_factory() as session:
            app = session.get(App, app_id)
            if app is None:
                return None

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
