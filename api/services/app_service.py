import json
import logging
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Literal, NotRequired, TypedDict, cast, override

import sqlalchemy as sa
from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from configs import dify_config
from constants.model_template import default_app_templates
from core.agent.entities import AgentToolEntity
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelManager
from core.tools.tool_manager import ToolManager
from core.tools.utils.configuration import ToolParameterConfigurationManager
from events.app_event import app_was_created, app_was_deleted, app_was_updated
from extensions.ext_database import db  # noqa: F401
from graphon.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from libs.datetime_utils import naive_utc_now
from libs.login import current_user
from libs.pagination import PaginatedResult, paginate_query
from models import Account, AppStar
from models.agent import Agent, AgentIconType, AgentScope, AgentSource, AgentStatus
from models.model import App, AppMode, AppModelConfig, IconType, Site
from models.tools import ApiToolProvider
from services.agent.errors import AgentNameConflictError
from services.billing_service import BillingService
from services.enterprise import rbac_service as enterprise_rbac_service
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService
from services.openapi.visibility import apply_openapi_gate, is_openapi_visible
from services.tag_service import TagService
from tasks.remove_app_and_related_data_task import remove_app_and_related_data_task

logger = logging.getLogger(__name__)

AppListSortBy = Literal["last_modified", "recently_created", "earliest_created"]


class AppListBaseParams(BaseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=100)
    mode: Literal[
        "completion", "chat", "advanced-chat", "workflow", "agent-chat", "agent", "channel", "all", "discovery"
    ] = "all"
    sort_by: AppListSortBy = "last_modified"
    name: str | None = None
    tag_ids: list[str] | None = None
    creator_ids: list[str] | None = None
    is_created_by_me: bool | None = None
    accessible_app_ids: list[str] | None = None
    include_own_apps: bool = False


class AppListParams(AppListBaseParams):
    status: str | None = None
    openapi_visible: bool = False


class StarredAppListParams(AppListBaseParams):
    pass


class CreateAppParams(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    mode: Literal["chat", "agent-chat", "agent", "advanced-chat", "workflow", "completion"]
    agent_role: str = Field(default="", max_length=255)
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    api_rph: int = 0
    api_rpm: int = 0
    max_active_requests: int | None = None


class AppService:
    @staticmethod
    def _build_app_list_filters(
        user_id: str, tenant_id: str, params: AppListBaseParams, session: Session
    ) -> list[sa.ColumnElement[bool]]:
        filters = [App.tenant_id == tenant_id, App.is_universal == False]

        if params.mode == "workflow":
            filters.append(App.mode == AppMode.WORKFLOW)
        elif params.mode == "completion":
            filters.append(App.mode == AppMode.COMPLETION)
        elif params.mode == "chat":
            filters.append(App.mode == AppMode.CHAT)
        elif params.mode == "advanced-chat":
            filters.append(App.mode == AppMode.ADVANCED_CHAT)
        elif params.mode == "agent-chat":
            filters.append(App.mode == AppMode.AGENT_CHAT)
        elif params.mode == "agent":
            filters.append(App.mode == AppMode.AGENT)
            filters.append(
                sa.exists()
                .where(
                    Agent.tenant_id == tenant_id,
                    Agent.app_id == App.id,
                    Agent.scope == AgentScope.ROSTER,
                    Agent.source == AgentSource.AGENT_APP,
                    Agent.status == AgentStatus.ACTIVE,
                )
                .correlate(App)
            )
        elif params.mode == "all":
            filters.append(App.mode != AppMode.AGENT)

        if isinstance(params, AppListParams):
            if params.status:
                filters.append(App.status == params.status)
            # OpenAPI surface visibility gate. Pushed into the query so
            # `pagination.total` reflects only apps the openapi caller can
            # actually reach; post-filtering by enable_api after the page
            # arrives would make `total` page-dependent.
            if params.openapi_visible:
                filters.append(App.enable_api.is_(True))

        if params.is_created_by_me:
            filters.append(App.created_by == user_id)
        elif params.accessible_app_ids is not None:
            accessible_filter: ColumnElement[bool] = App.id.in_(params.accessible_app_ids)
            if params.include_own_apps:
                accessible_filter = sa.or_(App.maintainer == user_id, accessible_filter)
            filters.append(accessible_filter)
        if params.creator_ids:
            filters.append(App.created_by.in_(params.creator_ids))
        if params.name:
            from libs.helper import escape_like_pattern

            name = params.name[:30]
            escaped_name = escape_like_pattern(name)
            filters.append(App.name.ilike(f"%{escaped_name}%", escape="\\"))
        if params.tag_ids and len(params.tag_ids) > 0:
            target_ids = TagService.get_target_ids_by_tag_ids("app", tenant_id, params.tag_ids, session, match_all=True)
            if target_ids and len(target_ids) > 0:
                filters.append(App.id.in_(target_ids))
            else:
                return []

        return filters

    @staticmethod
    def _build_app_list_order_by(sort_by: AppListSortBy) -> sa.ColumnElement[Any]:
        return {
            "last_modified": App.updated_at.desc(),
            "recently_created": App.created_at.desc(),
            "earliest_created": App.created_at.asc(),
        }[sort_by]

    @staticmethod
    def get_starred_app_ids(*, tenant_id: str, account_id: str, app_ids: Sequence[str], session: Session) -> set[str]:
        """Return app IDs starred by this account within the tenant."""
        if not app_ids:
            return set()

        starred_app_ids = session.scalars(
            select(AppStar.app_id).where(
                AppStar.tenant_id == tenant_id,
                AppStar.account_id == account_id,
                AppStar.app_id.in_(list(app_ids)),
            )
        ).all()
        return set(starred_app_ids)

    @staticmethod
    def get_app_by_id(app_id: str, *, session: Session) -> App | None:
        return session.get(App, app_id)

    @staticmethod
    def get_visible_app_by_id(app_id: str, *, session: Session) -> App | None:
        app = session.get(App, app_id)
        if not app or app.status != "normal" or not is_openapi_visible(app):
            return None
        return app

    @staticmethod
    def find_visible_apps_by_ids(app_ids: Sequence[str], *, session: Session) -> list[App]:
        if not app_ids:
            return []
        return list(session.execute(apply_openapi_gate(select(App).where(App.id.in_(list(app_ids))))).scalars().all())

    @staticmethod
    def find_visible_apps_by_name(*, name: str, tenant_id: str, session: Session) -> list[App]:
        return list(
            session.execute(
                apply_openapi_gate(
                    select(App).where(
                        App.name == name,
                        App.tenant_id == tenant_id,
                        App.status == "normal",
                    )
                )
            ).scalars()
        )

    def get_paginate_apps(
        self, user_id: str, tenant_id: str, params: AppListParams, session: Session
    ) -> PaginatedResult | None:
        """
        Get app list with pagination, filters, and explicit sort order.
        :param user_id: user id
        :param tenant_id: tenant id
        :param params: query parameters
        :return:
        """
        filters = self._build_app_list_filters(user_id, tenant_id, params, session)
        if not filters:
            return None

        order_by = self._build_app_list_order_by(params.sort_by)

        app_models = paginate_query(
            sa.select(App).where(*filters).order_by(order_by),
            page=params.page,
            per_page=params.limit,
            session=session,
        )

        app_ids = [str(app.id) for app in app_models.items]
        starred_app_ids = self.get_starred_app_ids(
            tenant_id=tenant_id, account_id=user_id, app_ids=app_ids, session=session
        )
        for app in app_models.items:
            app.is_starred = str(app.id) in starred_app_ids

        return app_models

    def get_paginate_starred_apps(
        self, user_id: str, tenant_id: str, params: StarredAppListParams, session: Session
    ) -> PaginatedResult | None:
        """
        Get apps starred by the current account with pagination, filters, and explicit sort order.
        """
        filters = self._build_app_list_filters(user_id, tenant_id, params, session)
        if not filters:
            return None

        order_by = self._build_app_list_order_by(params.sort_by)
        app_models = paginate_query(
            sa.select(App)
            .join(
                AppStar,
                sa.and_(
                    AppStar.tenant_id == App.tenant_id,
                    AppStar.app_id == App.id,
                    AppStar.account_id == user_id,
                ),
            )
            .where(AppStar.tenant_id == tenant_id, *filters)
            .order_by(order_by),
            page=params.page,
            per_page=params.limit,
            session=session,
        )

        for app in app_models.items:
            app.is_starred = True

        return app_models

    @staticmethod
    def star_app(*, app: App, account_id: str, session: Session) -> None:
        """Create the account's app star if it does not already exist."""
        existing_star = session.scalar(
            select(AppStar)
            .where(
                AppStar.tenant_id == app.tenant_id,
                AppStar.app_id == app.id,
                AppStar.account_id == account_id,
            )
            .limit(1)
        )
        if existing_star:
            return

        session.add(AppStar(tenant_id=app.tenant_id, app_id=app.id, account_id=account_id))

    @staticmethod
    def unstar_app(*, app: App, account_id: str, session: Session) -> None:
        """Remove the account's app star if present."""
        existing_star = session.scalar(
            select(AppStar)
            .where(
                AppStar.tenant_id == app.tenant_id,
                AppStar.app_id == app.id,
                AppStar.account_id == account_id,
            )
            .limit(1)
        )
        if not existing_star:
            return

        session.delete(existing_star)

    def create_app(self, tenant_id: str, params: CreateAppParams, account: Account, *, session: Session) -> App:
        """
        Create app
        :param tenant_id: tenant id
        :param params: app creation parameters
        :param account: Account instance
        """
        app_mode = AppMode.value_of(params.mode)
        app_template = default_app_templates[app_mode]

        # get model config
        default_model_config = app_template.get("model_config")
        default_model_config = default_model_config.copy() if default_model_config else None
        if default_model_config and "model" in default_model_config:
            # get model provider
            model_manager = ModelManager.for_tenant(tenant_id=account.current_tenant_id or "")

            # get default model instance
            try:
                model_instance = model_manager.get_default_model_instance(
                    tenant_id=account.current_tenant_id or "", model_type=ModelType.LLM
                )
            except (ProviderTokenNotInitError, LLMBadRequestError):
                model_instance = None
            except Exception:
                logger.exception("Get default model instance failed, tenant_id: %s", tenant_id)
                model_instance = None

            if model_instance:
                if (
                    model_instance.model_name == default_model_config["model"]["name"]
                    and model_instance.provider == default_model_config["model"]["provider"]
                ):
                    default_model_dict = default_model_config["model"]
                else:
                    llm_model = cast(LargeLanguageModel, model_instance.model_type_instance)
                    model_schema = llm_model.get_model_schema(model_instance.model_name, model_instance.credentials)
                    if model_schema is None:
                        raise ValueError(f"model schema not found for model {model_instance.model_name}")

                    default_model_dict = {
                        "provider": model_instance.provider,
                        "name": model_instance.model_name,
                        "mode": model_schema.model_properties.get(ModelPropertyKey.MODE),
                        "completion_params": {},
                    }
            else:
                try:
                    provider, model = model_manager.get_default_provider_model_name(
                        tenant_id=account.current_tenant_id or "", model_type=ModelType.LLM
                    )
                except Exception:
                    logger.exception("Get default provider model failed, tenant_id: %s", tenant_id)
                    provider = default_model_config["model"].get("provider")
                    model = default_model_config["model"].get("name")

                if provider:
                    default_model_config["model"]["provider"] = provider
                if model:
                    default_model_config["model"]["name"] = model
                default_model_dict = default_model_config["model"]

            default_model_config["model"] = json.dumps(default_model_dict)

        app = App(**app_template["app"])
        app.name = params.name
        app.description = params.description or ""
        app.mode = app_mode
        app.icon_type = IconType(params.icon_type) if params.icon_type else IconType.EMOJI
        app.icon = params.icon
        app.icon_background = params.icon_background
        app.tenant_id = tenant_id
        app.api_rph = params.api_rph
        app.api_rpm = params.api_rpm
        app.max_active_requests = params.max_active_requests
        app.created_by = account.id
        app.maintainer = account.id
        app.updated_by = account.id

        session.add(app)
        session.flush()

        if default_model_config:
            app_model_config = AppModelConfig(
                **default_model_config, app_id=app.id, created_by=account.id, updated_by=account.id
            )
            session.add(app_model_config)
            session.flush()

            app.app_model_config_id = app_model_config.id
        elif app_mode == AppMode.AGENT:
            # An Agent App keeps its model / prompt / tools in the bound Agent
            # Soul, so the app_model_config row carries no model — only the
            # app-level presentation features the PRD requires (conversation
            # opener, follow-up suggestions, citations, moderation, annotation).
            # They default to disabled/empty here and are read by both the
            # webapp /parameters endpoint and the chat pipeline. agent_mode is
            # left unset so App.is_agent stays False (this is the new Agent App
            # type, not a legacy function-call/react agent).
            agent_app_model_config = AppModelConfig(app_id=app.id, created_by=account.id, updated_by=account.id)
            session.add(agent_app_model_config)
            session.flush()

            app.app_model_config_id = agent_app_model_config.id

        # Agent App type is backed 1:1 by a roster Agent (linked via Agent.app_id).
        # Created in the same transaction so the App and its backing Agent persist
        # atomically; the Agent Soul (model/prompt/tools) is configured afterward
        # in the Composer.
        if app_mode == AppMode.AGENT:
            from services.agent.roster_service import AgentRosterService

            icon_type = AgentIconType(params.icon_type) if params.icon_type else None
            AgentRosterService(session).create_backing_agent_for_app(
                tenant_id=tenant_id,
                account_id=account.id,
                app_id=app.id,
                name=params.name,
                description=params.description or "",
                role=params.agent_role,
                icon_type=icon_type,
                icon=params.icon,
                icon_background=params.icon_background,
            )

        session.commit()

        app_was_created.send(app, account=account)
        enterprise_rbac_service.try_sync_creator_access_policy_member_bindings(
            tenant_id,
            account.id,
            enterprise_rbac_service.RBACResourceType.APP,
            app.id,
        )

        if FeatureService.get_system_features().webapp_auth.enabled:
            # update web app setting as private
            EnterpriseService.WebAppAuth.update_app_access_mode(app.id, "private")

        if dify_config.BILLING_ENABLED:
            BillingService.clean_billing_info_cache(app.tenant_id)

        return app

    def get_app(self, app: App) -> App:
        """
        Get App
        """
        assert isinstance(current_user, Account)
        assert current_user.current_tenant_id is not None
        # get original app model config
        if app.mode == AppMode.AGENT_CHAT or app.is_agent:
            model_config = app.app_model_config
            if not model_config:
                return app
            agent_mode = model_config.agent_mode_dict
            # decrypt agent tool parameters if it's secret-input
            for tool in agent_mode.get("tools") or []:
                if not isinstance(tool, dict) or len(tool.keys()) <= 3:
                    continue
                typed_tool = {key: value for key, value in tool.items() if isinstance(key, str)}
                if len(typed_tool) != len(tool):
                    continue
                agent_tool_entity = AgentToolEntity.model_validate(typed_tool)
                # get tool
                try:
                    tool_runtime = ToolManager.get_agent_tool_runtime(
                        tenant_id=current_user.current_tenant_id,
                        app_id=app.id,
                        agent_tool=agent_tool_entity,
                        user_id=current_user.id,
                    )
                    manager = ToolParameterConfigurationManager(
                        tenant_id=current_user.current_tenant_id,
                        tool_runtime=tool_runtime,
                        provider_name=agent_tool_entity.provider_id,
                        provider_type=agent_tool_entity.provider_type,
                        identity_id=f"AGENT.{app.id}",
                    )

                    # get decrypted parameters
                    if agent_tool_entity.tool_parameters:
                        parameters = manager.decrypt_tool_parameters(agent_tool_entity.tool_parameters or {})
                        masked_parameter = manager.mask_tool_parameters(parameters or {})
                    else:
                        masked_parameter = {}

                    # override tool parameters
                    tool["tool_parameters"] = masked_parameter
                except Exception:
                    logger.exception("Failed to mask agent tool parameters for tool %s", agent_tool_entity.tool_name)

            # override agent mode
            if model_config:
                model_config.agent_mode = json.dumps(agent_mode)

            class ModifiedApp(App):
                """
                Modified App class
                """

                def __init__(self, app):
                    self.__dict__.update(app.__dict__)

                @property
                @override
                def app_model_config(self):
                    return model_config

            app = ModifiedApp(app)

        return app

    class ArgsDict(TypedDict):
        name: str
        description: str
        icon_type: IconType | str | None
        icon: str
        icon_background: str
        use_icon_as_answer_icon: bool
        max_active_requests: int
        role: NotRequired[str | None]

    @staticmethod
    def _get_backing_agent_for_update(app: App, *, session: Session) -> Agent | None:
        if app.mode != AppMode.AGENT:
            return None
        return session.scalar(
            select(Agent).where(
                Agent.tenant_id == app.tenant_id,
                Agent.app_id == app.id,
                Agent.scope == AgentScope.ROSTER,
                Agent.source == AgentSource.AGENT_APP,
                Agent.status == AgentStatus.ACTIVE,
            )
        )

    @staticmethod
    def _to_agent_icon_type(icon_type: IconType | str | None) -> AgentIconType | None:
        if icon_type is None:
            return None
        value = icon_type.value if isinstance(icon_type, IconType) else icon_type
        return AgentIconType(value)

    def _sync_backing_agent_identity(
        self,
        app: App,
        *,
        name: str | None = None,
        description: str | None = None,
        role: str | None = None,
        icon_type: IconType | str | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
        account_id: str | None = None,
        updated_at: datetime | None = None,
        session: Session,
    ) -> None:
        """Keep the Roster identity aligned with its Agent App shell.

        Agent Soul remains versioned through Composer. This helper only mirrors
        user-facing identity fields, including the roster role/persona label,
        so Roster and Agent Console do not drift.

        Role omission is intentional: ``role=None`` preserves the backing
        Agent's current role, while ``role=""`` explicitly clears it.
        """
        agent = self._get_backing_agent_for_update(app, session=session)
        if agent is None:
            return

        if name is not None:
            agent.name = name
        if description is not None:
            agent.description = description
        if role is not None:
            agent.role = role
        if icon_type is not None:
            agent.icon_type = self._to_agent_icon_type(icon_type)
        if icon is not None:
            agent.icon = icon
        if icon_background is not None:
            agent.icon_background = icon_background
        agent.updated_by = account_id
        if updated_at is not None:
            agent.updated_at = updated_at

    @staticmethod
    def _commit_app_identity_update(app: App, *, session: Session) -> None:
        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            if app.mode == AppMode.AGENT:
                raise AgentNameConflictError() from exc
            raise

    def update_app(self, app: App, args: ArgsDict, *, session: Session) -> App:
        """
        Update app
        :param app: App instance
        :param args: request args
        :return: App instance
        """
        assert current_user is not None
        app.name = args["name"]
        app.description = args["description"]
        icon_type = args.get("icon_type")
        if icon_type is None:
            resolved_icon_type = app.icon_type
        else:
            resolved_icon_type = IconType(icon_type)

        app.icon_type = resolved_icon_type
        app.icon = args["icon"]
        app.icon_background = args["icon_background"]
        app.use_icon_as_answer_icon = args.get("use_icon_as_answer_icon", False)
        app.max_active_requests = args.get("max_active_requests")
        app.updated_by = current_user.id
        app.updated_at = naive_utc_now()
        self._sync_backing_agent_identity(
            app,
            name=app.name,
            description=app.description,
            # Omitted role must stay omitted here: None means "preserve current
            # backing-agent role", while an empty string is an explicit clear.
            role=args.get("role"),
            icon_type=app.icon_type,
            icon=app.icon,
            icon_background=app.icon_background,
            account_id=current_user.id,
            updated_at=app.updated_at,
            session=session,
        )
        self._commit_app_identity_update(app, session=session)

        app_was_updated.send(app)

        return app

    def update_app_name(self, app: App, name: str, *, session: Session) -> App:
        """
        Update app name
        :param app: App instance
        :param name: new name
        :return: App instance
        """
        assert current_user is not None
        app.name = name
        app.updated_by = current_user.id
        app.updated_at = naive_utc_now()
        self._sync_backing_agent_identity(
            app,
            name=app.name,
            account_id=current_user.id,
            updated_at=app.updated_at,
            session=session,
        )
        self._commit_app_identity_update(app, session=session)

        app_was_updated.send(app)

        return app

    def update_app_icon(
        self,
        app: App,
        icon: str,
        icon_background: str,
        icon_type: IconType | str | None = None,
        *,
        session: Session,
    ) -> App:
        """
        Update app icon
        :param app: App instance
        :param icon: new icon
        :param icon_background: new icon_background
        :param icon_type: new icon type
        :return: App instance
        """
        assert current_user is not None
        app.icon = icon
        app.icon_background = icon_background
        if icon_type is not None:
            app.icon_type = icon_type if isinstance(icon_type, IconType) else IconType(icon_type)
        app.updated_by = current_user.id
        app.updated_at = naive_utc_now()
        self._sync_backing_agent_identity(
            app,
            icon_type=app.icon_type,
            icon=app.icon,
            icon_background=app.icon_background,
            account_id=current_user.id,
            updated_at=app.updated_at,
            session=session,
        )
        session.commit()

        app_was_updated.send(app)

        return app

    def update_app_site_status(self, app: App, enable_site: bool, *, session: Session) -> App:
        """
        Update app site status
        :param app: App instance
        :param enable_site: enable site status
        :return: App instance
        """
        if enable_site == app.enable_site:
            return app
        assert current_user is not None
        app.enable_site = enable_site
        app.updated_by = current_user.id
        app.updated_at = naive_utc_now()
        session.commit()

        app_was_updated.send(app)

        return app

    def update_app_api_status(self, app: App, enable_api: bool, *, session: Session) -> App:
        """
        Update app api status
        :param app: App instance
        :param enable_api: enable api status
        :return: App instance
        """
        if enable_api == app.enable_api:
            return app
        assert current_user is not None

        app.enable_api = enable_api
        app.updated_by = current_user.id
        app.updated_at = naive_utc_now()
        session.commit()

        app_was_updated.send(app)

        return app

    def delete_app(self, app: App, *, session: Session) -> None:
        """
        Delete app
        :param app: App instance
        """
        app_was_deleted.send(app)

        backing_agent = self._get_backing_agent_for_update(app, session=session)
        if backing_agent is not None:
            now = naive_utc_now()
            account_id = getattr(current_user, "id", None)
            backing_agent.status = AgentStatus.ARCHIVED
            backing_agent.archived_by = account_id
            backing_agent.archived_at = now
            backing_agent.updated_by = account_id
            backing_agent.updated_at = now

        session.delete(app)
        session.commit()

        # clean up web app settings
        if FeatureService.get_system_features().webapp_auth.enabled:
            EnterpriseService.WebAppAuth.cleanup_webapp(app.id)

        if dify_config.BILLING_ENABLED:
            BillingService.clean_billing_info_cache(app.tenant_id)

        # Trigger asynchronous deletion of app and related data
        remove_app_and_related_data_task.delay(tenant_id=app.tenant_id, app_id=app.id)

    def get_app_meta(self, app_model: App, *, session: Session):
        """
        Get app meta info
        :param app_model: app model
        :return:
        """
        app_mode = AppMode.value_of(app_model.mode)

        meta: dict[str, Any] = {"tool_icons": {}}

        if app_mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow = app_model.workflow
            if workflow is None:
                return meta

            graph = workflow.graph_dict
            nodes = graph.get("nodes", [])
            tools = []
            for node in nodes:
                if node.get("data", {}).get("type") == "tool":
                    node_data = node.get("data", {})
                    tools.append(
                        {
                            "provider_type": node_data.get("provider_type"),
                            "provider_id": node_data.get("provider_id"),
                            "tool_name": node_data.get("tool_name"),
                            "tool_parameters": {},
                        }
                    )
        else:
            app_model_config: AppModelConfig | None = app_model.app_model_config

            if not app_model_config:
                return meta

            agent_config = app_model_config.agent_mode_dict

            # get all tools
            tools = cast(list[dict[str, Any]], agent_config.get("tools", []))

        url_prefix = dify_config.CONSOLE_API_URL + "/console/api/workspaces/current/tool-provider/builtin/"

        for tool in tools:
            keys = list(tool.keys())
            if len(keys) >= 4:
                # current tool standard
                provider_type = str(tool.get("provider_type", ""))
                provider_id = str(tool.get("provider_id", ""))
                tool_name = str(tool.get("tool_name", ""))
                if provider_type == "builtin":
                    meta["tool_icons"][tool_name] = url_prefix + provider_id + "/icon"
                elif provider_type == "api":
                    try:
                        provider: ApiToolProvider | None = session.get(ApiToolProvider, provider_id)
                        if provider is None:
                            raise ValueError(f"provider not found for tool {tool_name}")
                        meta["tool_icons"][tool_name] = json.loads(provider.icon)
                    except:
                        meta["tool_icons"][tool_name] = {"background": "#252525", "content": "\ud83d\ude01"}

        return meta

    @staticmethod
    def get_app_code_by_id(app_id: str, *, session: Session) -> str:
        """
        Get app code by app id
        :param app_id: app id
        :return: app code
        """
        site = session.scalar(select(Site).where(Site.app_id == app_id).limit(1))
        if not site:
            raise ValueError(f"App with id {app_id} not found")
        return str(site.code)

    @staticmethod
    def get_app_id_by_code(app_code: str, *, session: Session) -> str:
        """
        Get app id by app code
        :param app_code: app code
        :return: app id
        """
        site = session.scalar(select(Site).where(Site.code == app_code).limit(1))
        if not site:
            raise ValueError(f"App with code {app_code} not found")
        return str(site.app_id)
