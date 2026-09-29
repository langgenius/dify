import json
import logging
from collections.abc import Callable, Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from typing import Any, NotRequired, TypedDict, cast

import sqlalchemy as sa
from pydantic import JsonValue
from sqlalchemy import ColumnElement, delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from configs import dify_config
from constants.model_template import default_app_templates
from core.agent.publish_visibility import agent_has_workflow_callable_active_snapshot
from core.agent.tool_configuration import mask_agent_tool_parameters
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelManager
from enums import DeploymentEdition
from events.app_event import app_was_created, app_was_deleted, app_was_updated
from extensions.ext_database import db  # noqa: F401
from graphon.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from libs.datetime_utils import naive_utc_now
from libs.login import current_user
from libs.pagination import PaginatedResult, paginate_query
from models import Account, AppStar
from models.agent import (
    APP_BACKED_AGENT_SOURCES,
    Agent,
    AgentIconType,
    AgentScope,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspaceBinding,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig
from models.model import App, AppMode, AppModelConfig, IconType, Site, load_annotation_reply_config
from models.provider_ids import ModelProviderID
from models.skill import AgentSkillBinding
from models.workflow import Workflow
from services.agent.errors import AgentAccessNotReadyError, AgentNameConflictError
from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.retirement_service import WorkflowAgentRetirementService
from services.agent.workspace_service import AgentWorkspaceService
from services.billing_service import BillingService
from services.enterprise import rbac_service as enterprise_rbac_service
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.app_entities import (
    AgentAppPublicationCounts,
    AppCreationSettings,
    AppDeletion,
    AppEvent,
    AppListBaseParams,
    AppListParams,
    AppListSortBy,
    CreateAppParams,
)
from services.model_provider_service import ModelProviderService
from services.openapi.visibility import apply_openapi_gate, is_openapi_visible
from services.rbac_agent_access_service import initialize_agent_rbac_access
from services.system_feature_service import SystemFeatureService
from services.tag_service import TagService
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection
from tasks.remove_app_and_related_data_task import remove_app_and_related_data_task

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _CreatedApp:
    tenant_id: str
    creator_account_id: str
    app_id: str
    backing_agent_id: str | None


def _initialize_created_app_access(created: _CreatedApp) -> None:
    enterprise_rbac_service.try_sync_creator_access_policy_member_bindings(
        created.tenant_id,
        created.creator_account_id,
        enterprise_rbac_service.RBACResourceType.APP,
        created.app_id,
    )


def _initialize_created_agent_access(created: _CreatedApp) -> None:
    if created.backing_agent_id is None:
        raise ValueError(f"agent app {created.app_id} was created without a backing agent")
    initialize_agent_rbac_access(
        tenant_id=created.tenant_id,
        agent_id=created.backing_agent_id,
        creator_account_id=created.creator_account_id,
    )


_CREATED_APP_ACCESS_INITIALIZERS: dict[AppMode, Callable[[_CreatedApp], None]] = {
    AppMode.AGENT: _initialize_created_agent_access,
}


class AppModelConfigResponseView:
    """Expose AppModelConfig response properties through the request session."""

    def __init__(self, app_model_config: AppModelConfig, *, session: Session) -> None:
        self._app_model_config = app_model_config
        self._session = session

    def __getattr__(self, name: str) -> Any:
        return getattr(self._app_model_config, name)  # guard-ignore: no-new-getattr -- delegates model fields

    @property
    def annotation_reply_dict(self) -> Any:
        return load_annotation_reply_config(self._session, self._app_model_config.app_id)


class AppResponseView:
    """Expose App response properties through one caller-owned database session."""

    def __init__(
        self, app: App, *, session: Session, account: Account | None = None, access_mode: str | None = None
    ) -> None:
        self._app = app
        self._session = session
        self._account = account
        self._access_mode = access_mode

    def __getattr__(self, name: str) -> Any:
        return getattr(self._app, name)  # guard-ignore: no-new-getattr -- delegates model fields

    @property
    def desc_or_prompt(self) -> str:
        return self._app.desc_or_prompt_with_session(session=self._session)

    @property
    def site(self) -> Site | None:
        return self._app.site_with_session(session=self._session)

    @property
    def app_model_config(self) -> AppModelConfigResponseView | None:
        app_model_config = self._app.app_model_config_with_session(session=self._session)
        if app_model_config is None:
            return None
        if self._account is not None and (
            self._app.mode == AppMode.AGENT_CHAT or self._app.is_agent_with_session(session=self._session)
        ):
            tenant_id = self._account.current_tenant_id
            assert tenant_id is not None
            masked_agent_mode = mask_agent_tool_parameters(
                agent_mode=cast(Mapping[str, JsonValue], app_model_config.agent_mode_dict),
                app_id=self._app.id,
                tenant_id=tenant_id,
                user_id=self._account.id,
            )
            app_model_config = deepcopy(app_model_config)
            app_model_config.agent_mode = json.dumps(masked_agent_mode)
        return AppModelConfigResponseView(app_model_config, session=self._session)

    @property
    def workflow(self) -> Workflow | None:
        return self._app.workflow_with_session(session=self._session)

    @property
    def bound_agent_id(self) -> str | None:
        return self._app.bound_agent_id_with_session(session=self._session)

    @property
    def mode_compatible_with_agent(self) -> str:
        return self._app.mode_compatible_with_agent_with_session(session=self._session)

    @property
    def access_mode(self) -> str | None:
        return self._access_mode

    @property
    def permission_keys(self) -> list[str]:
        return []

    @property
    def app_id(self) -> str | None:
        return None

    @property
    def deleted_tools(self) -> list[Any]:
        return self._app.deleted_tools_with_session(session=self._session)

    @property
    def tags(self) -> Sequence[Any]:
        return self._app.tags_with_session(session=self._session)

    @property
    def author_name(self) -> str | None:
        return self._app.author_name_with_session(session=self._session)


class AppService:
    @staticmethod
    def _agent_app_exists_filter(tenant_id: str, *, is_published: bool | None = None) -> sa.Exists:
        agent_filters = [
            Agent.tenant_id == tenant_id,
            Agent.app_id == App.id,
            Agent.scope == AgentScope.ROSTER,
            Agent.source.in_(APP_BACKED_AGENT_SOURCES),
            Agent.status == AgentStatus.ACTIVE,
        ]
        if is_published is not None:
            has_published_config = sa.and_(
                Agent.active_config_snapshot_id.is_not(None),
                Agent.active_config_is_published.is_(True),
            )
            agent_filters.append(has_published_config if is_published else sa.not_(has_published_config))

        return sa.exists().where(*agent_filters).correlate(App)

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
            publication_filter = params.agent_is_published if isinstance(params, AppListParams) else None
            filters.append(AppService._agent_app_exists_filter(tenant_id, is_published=publication_filter))
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
    def get_starred_app_ids(
        session: Session,
        *,
        tenant_id: str,
        account_id: str,
        app_ids: Sequence[str],
    ) -> set[str]:
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
    def get_app_by_id(
        app_id: str,
        session: Session,
    ) -> App | None:
        return session.get(App, app_id)

    @staticmethod
    def get_visible_app_by_id(
        app_id: str,
        session: Session,
    ) -> App | None:
        app = session.get(App, app_id)
        if not app or app.status != "normal" or not is_openapi_visible(app):
            return None
        return app

    @staticmethod
    def find_visible_apps_by_ids(
        app_ids: Sequence[str],
        session: Session,
    ) -> list[App]:
        if not app_ids:
            return []
        return list(session.execute(apply_openapi_gate(select(App).where(App.id.in_(list(app_ids))))).scalars().all())

    def get_paginate_apps(
        self,
        user_id: str,
        tenant_id: str,
        params: AppListParams,
        session: Session,
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
            session=session,
            tenant_id=tenant_id,
            account_id=user_id,
            app_ids=app_ids,
        )
        for app in app_models.items:
            app.is_starred = str(app.id) in starred_app_ids

        return app_models

    def get_agent_publication_counts(
        self,
        user_id: str,
        tenant_id: str,
        params: AppListParams,
        session: Session,
    ) -> AgentAppPublicationCounts:
        unfiltered_params = params.model_copy(update={"agent_is_published": None})
        filters = self._build_app_list_filters(user_id, tenant_id, unfiltered_params, session)
        if not filters:
            return AgentAppPublicationCounts(published=0, drafts=0)

        published_filter = self._agent_app_exists_filter(tenant_id, is_published=True)
        draft_filter = self._agent_app_exists_filter(tenant_id, is_published=False)
        published_count, draft_count = session.execute(
            sa.select(
                sa.func.coalesce(sa.func.sum(sa.case((published_filter, 1), else_=0)), 0),
                sa.func.coalesce(sa.func.sum(sa.case((draft_filter, 1), else_=0)), 0),
            )
            .select_from(App)
            .where(*filters)
        ).one()

        return AgentAppPublicationCounts(published=int(published_count), drafts=int(draft_count))

    @staticmethod
    def prepare_agent_soul(tenant_id: str, *, session: Session) -> AgentSoulConfig | None:
        """Build the initial Agent Soul from the workspace default model, when available."""
        default_model = ModelProviderService().get_default_model_selection(tenant_id, ModelType.LLM, session=session)
        if default_model is None:
            return None
        agent_provider, agent_model = default_model
        try:
            provider_id = ModelProviderID(agent_provider)
        except ValueError:
            logger.warning("Invalid Agent default model, tenant_id: %s", tenant_id, exc_info=True)
            return None
        return AgentSoulConfig(
            model=AgentSoulModelConfig(
                plugin_id=provider_id.plugin_id,
                model_provider=str(provider_id),
                model=agent_model,
            )
        )

    def create_app(
        self,
        tenant_id: str,
        params: CreateAppParams,
        account: Account,
        *,
        session: Session,
    ) -> App:
        """
        Create app
        :param tenant_id: tenant id
        :param params: app creation parameters
        :param account: Account instance
        """
        app_mode = AppMode.value_of(params.mode)
        app_template = default_app_templates[app_mode]
        initial_agent_soul = self.prepare_agent_soul(tenant_id, session=session) if app_mode == AppMode.AGENT else None

        # get model config
        default_model_config = app_template.get("model_config")
        default_model_config = default_model_config.copy() if default_model_config else None
        if default_model_config and "model" in default_model_config:
            default_model_dict = default_model_config["model"]
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

            if model_instance is not None:
                if (
                    model_instance.model_name == default_model_config["model"]["name"]
                    and model_instance.provider == default_model_config["model"]["provider"]
                ):
                    default_model_dict = default_model_config["model"]
                else:
                    llm_model = cast(LargeLanguageModel, model_instance.model_type_instance)
                    try:
                        model_schema = llm_model.get_model_schema(model_instance.model_name, model_instance.credentials)
                        if model_schema is None:
                            raise ValueError(f"model schema not found for model {model_instance.model_name}")
                    except Exception:
                        # A removed provider model must not prevent creating an app.
                        logger.warning(
                            "Default model schema is unavailable, tenant_id: %s, provider: %s, model: %s",
                            tenant_id,
                            model_instance.provider,
                            model_instance.model_name,
                            exc_info=True,
                        )
                        model_instance = None
                    else:
                        default_model_dict = {
                            "provider": model_instance.provider,
                            "name": model_instance.model_name,
                            "mode": model_schema.model_properties.get(ModelPropertyKey.MODE),
                            "completion_params": {},
                        }
            if model_instance is None:
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
        # atomically; the Agent Soul starts with the workspace model selection.
        backing_agent: Agent | None = None
        if app_mode == AppMode.AGENT:
            from services.agent.roster_service import AgentRosterService

            icon_type = AgentIconType(params.icon_type) if params.icon_type else None
            try:
                backing_agent = AgentRosterService(session).create_backing_agent_for_app(
                    tenant_id=tenant_id,
                    account_id=account.id,
                    app_id=app.id,
                    name=params.name,
                    description=params.description or "",
                    role=params.agent_role,
                    icon_type=icon_type,
                    icon=params.icon,
                    icon_background=params.icon_background,
                    initial_soul=initial_agent_soul,
                )
            except IntegrityError as exc:
                session.rollback()
                raise AgentNameConflictError() from exc

        session.flush()

        # Preserve the original commit-before-signal ordering for telemetry.
        session.commit()
        self.finalize_created_app(
            app=app,
            backing_agent_id=backing_agent.id if backing_agent else None,
            account=account,
            session=session,
        )
        return app

    def finalize_created_app(
        self,
        *,
        app: App,
        backing_agent_id: str | None,
        account: Account,
        session: Session,
        created_records_initialized: bool = False,
    ) -> None:
        """Run post-commit App creation hooks and external access initialization."""

        app_was_created.send(
            app,
            account=account,
            session=session,
            created_records_initialized=created_records_initialized,
        )
        session.commit()
        app_mode = app.mode
        initialize_access = _CREATED_APP_ACCESS_INITIALIZERS.get(app_mode, _initialize_created_app_access)
        initialize_access(
            _CreatedApp(
                tenant_id=app.tenant_id,
                creator_account_id=account.id,
                app_id=app.id,
                backing_agent_id=backing_agent_id,
            )
        )

        if SystemFeatureService.is_webapp_auth_enabled():
            # update web app setting as private
            EnterpriseService.WebAppAuth.update_app_access_mode(app.id, "private")

        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            BillingService.clean_billing_info_cache(app.tenant_id)

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
    def _get_backing_agent(app: App, *, session: Session) -> Agent | None:
        if app.mode != AppMode.AGENT:
            return None
        return session.scalar(
            select(Agent).where(
                Agent.tenant_id == app.tenant_id,
                Agent.app_id == app.id,
                Agent.scope == AgentScope.ROSTER,
                Agent.source.in_(APP_BACKED_AGENT_SOURCES),
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
        agent = self._get_backing_agent(app, session=session)
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

    @staticmethod
    def is_agent_app_access_ready(app: App, *, session: Session) -> bool:
        """Return whether an Agent App has a publish-visible active snapshot."""

        if app.mode != AppMode.AGENT:
            return True
        agent = session.scalar(
            select(Agent)
            .where(
                Agent.tenant_id == app.tenant_id,
                Agent.app_id == app.id,
                Agent.scope == AgentScope.ROSTER,
                Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                Agent.status == AgentStatus.ACTIVE,
            )
            .limit(1)
        )
        return bool(agent and agent_has_workflow_callable_active_snapshot(session=session, agent=agent))

    @classmethod
    def ensure_agent_app_access_ready(cls, app: App, *, session: Session) -> None:
        if not cls.is_agent_app_access_ready(app, session=session):
            raise AgentAccessNotReadyError()

    def update_app_api_status(self, app: App, enable_api: bool, *, session: Session) -> App:
        """
        Update app api status
        :param app: App instance
        :param enable_api: enable api status
        :return: App instance
        """
        if enable_api:
            self.ensure_agent_app_access_ready(app, session=session)
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
        """Delete an App and commit the passed session.

        The transaction releases all of a Workflow App's binding owners across
        draft and published versions, archives a backing Roster Agent, retires
        its resources, and deletes the App. Deleting a Roster Agent's backing
        App does not remove bindings owned by external Workflows.

        After commit, the main App cleanup is published first, followed by
        workflow-only Agent retirement and the Roster resource collector. Any
        publication failure propagates.
        """
        app_was_deleted.send(app)

        backing_agent = self._get_backing_agent(app, session=session)
        workflow_agent_ids = set(
            session.scalars(
                select(Agent.id).where(
                    Agent.tenant_id == app.tenant_id,
                    Agent.app_id == app.id,
                    Agent.scope == AgentScope.WORKFLOW_ONLY,
                    Agent.status == AgentStatus.ACTIVE,
                )
            ).all()
        )
        if app.mode in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT):
            workflow_agent_ids.update(
                agent_id
                for agent_id in session.scalars(
                    select(WorkflowAgentNodeBinding.agent_id).where(
                        WorkflowAgentNodeBinding.tenant_id == app.tenant_id,
                        WorkflowAgentNodeBinding.app_id == app.id,
                        WorkflowAgentNodeBinding.binding_type == WorkflowAgentBindingType.INLINE_AGENT,
                        WorkflowAgentNodeBinding.agent_id.is_not(None),
                    )
                ).all()
                if agent_id
            )
            session.execute(
                delete(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.tenant_id == app.tenant_id,
                    WorkflowAgentNodeBinding.app_id == app.id,
                )
            )
        agent_ids_to_unbind = set(workflow_agent_ids)
        if backing_agent is not None:
            agent_ids_to_unbind.add(backing_agent.id)
        if agent_ids_to_unbind:
            session.execute(
                delete(AgentSkillBinding).where(
                    AgentSkillBinding.tenant_id == app.tenant_id,
                    AgentSkillBinding.agent_id.in_(agent_ids_to_unbind),
                )
            )
        account_id = current_user.id if current_user else None
        if backing_agent is not None:
            now = naive_utc_now()
            backing_agent.status = AgentStatus.ARCHIVED
            backing_agent.archived_by = account_id
            backing_agent.archived_at = now
            backing_agent.updated_by = account_id
            backing_agent.updated_at = now

        retired_binding_ids: list[str] = []
        retired_snapshot_ids: list[str] = []
        if backing_agent is not None:
            bindings = session.scalars(
                select(AgentWorkspaceBinding).where(
                    AgentWorkspaceBinding.tenant_id == app.tenant_id,
                    AgentWorkspaceBinding.agent_id == backing_agent.id,
                )
            ).all()
            for binding in bindings:
                if binding.status == AgentWorkingResourceStatus.ACTIVE:
                    AgentWorkspaceService.retire_binding(
                        session=session,
                        tenant_id=app.tenant_id,
                        binding_id=binding.id,
                    )
                retired_binding_ids.append(binding.id)
            retired_snapshot_ids = AgentHomeSnapshotService.retire_all_for_agent(
                session=session,
                tenant_id=app.tenant_id,
                agent_id=backing_agent.id,
            )

        retired_workspace_ids = AgentWorkspaceService.retire_all_for_app(
            session=session,
            tenant_id=app.tenant_id,
            app_id=app.id,
        )
        session.delete(app)
        session.commit()

        try:
            remove_app_and_related_data_task.delay(tenant_id=app.tenant_id, app_id=app.id)
        except Exception:
            logger.exception(
                "Failed to enqueue App cleanup",
                extra={"tenant_id": app.tenant_id, "app_id": app.id},
            )
            raise

        WorkflowAgentRetirementService.retire_unowned(
            tenant_id=app.tenant_id,
            agent_ids=workflow_agent_ids,
            account_id=account_id,
        )
        enqueue_agent_resource_collection(
            tenant_id=app.tenant_id,
            workspace_ids=retired_workspace_ids,
            binding_ids=retired_binding_ids,
            home_snapshot_ids=retired_snapshot_ids,
            purge_agent_ids=[backing_agent.id] if backing_agent is not None else [],
        )

        # clean up web app settings
        if SystemFeatureService.is_webapp_auth_enabled():
            EnterpriseService.WebAppAuth.cleanup_webapp(app.id)

        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            BillingService.clean_billing_info_cache(app.tenant_id)

    @staticmethod
    def prepare_creation(tenant_id: str, params: CreateAppParams) -> AppCreationSettings:
        app_mode = AppMode.value_of(params.mode)
        app_template = default_app_templates[app_mode]

        # get model config
        default_model_config = app_template.get("model_config")
        default_model_config = default_model_config.copy() if default_model_config else None
        if default_model_config and "model" in default_model_config:
            default_model_dict = default_model_config["model"]
            # get model provider
            model_manager = ModelManager.for_tenant(tenant_id=tenant_id)

            # get default model instance
            try:
                model_instance = model_manager.get_default_model_instance(tenant_id=tenant_id, model_type=ModelType.LLM)
            except (ProviderTokenNotInitError, LLMBadRequestError):
                model_instance = None
            except Exception:
                logger.exception("Get default model instance failed, tenant_id: %s", tenant_id)
                model_instance = None

            if model_instance is not None:
                if (
                    model_instance.model_name == default_model_config["model"]["name"]
                    and model_instance.provider == default_model_config["model"]["provider"]
                ):
                    default_model_dict = default_model_config["model"]
                else:
                    llm_model = cast(LargeLanguageModel, model_instance.model_type_instance)
                    try:
                        model_schema = llm_model.get_model_schema(model_instance.model_name, model_instance.credentials)
                        if model_schema is None:
                            raise ValueError(f"model schema not found for model {model_instance.model_name}")
                    except Exception:
                        # A removed provider model must not prevent creating an app.
                        logger.warning(
                            "Default model schema is unavailable, tenant_id: %s, provider: %s, model: %s",
                            tenant_id,
                            model_instance.provider,
                            model_instance.model_name,
                            exc_info=True,
                        )
                        model_instance = None
                    else:
                        default_model_dict = {
                            "provider": model_instance.provider,
                            "name": model_instance.model_name,
                            "mode": model_schema.model_properties.get(ModelPropertyKey.MODE),
                            "completion_params": {},
                        }
            if model_instance is None:
                try:
                    provider, model = model_manager.get_default_provider_model_name(
                        tenant_id=tenant_id, model_type=ModelType.LLM
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

        return AppCreationSettings(dict(app_template["app"]), default_model_config)

    @staticmethod
    def notify_created_app(*, event: AppEvent, account_id: str, backing_agent_id: str | None) -> None:
        app_was_created.send(event, created_records_initialized=True)
        initialize_access = _CREATED_APP_ACCESS_INITIALIZERS.get(AppMode(event.mode), _initialize_created_app_access)
        initialize_access(_CreatedApp(event.tenant_id, account_id, event.id, backing_agent_id))
        if SystemFeatureService.is_webapp_auth_enabled():
            EnterpriseService.WebAppAuth.update_app_access_mode(event.id, "private")
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            BillingService.clean_billing_info_cache(event.tenant_id)

    @staticmethod
    def notify_deleted_app(deleted: AppDeletion, *, account_id: str | None) -> None:
        app = deleted.app
        app_was_deleted.send(app)
        try:
            remove_app_and_related_data_task.delay(tenant_id=app.tenant_id, app_id=app.id)
        except Exception:
            logger.exception(
                "Failed to enqueue App cleanup",
                extra={"tenant_id": app.tenant_id, "app_id": app.id},
            )
            raise

        WorkflowAgentRetirementService.retire_unowned(
            tenant_id=app.tenant_id,
            agent_ids=deleted.workflow_agent_ids,
            account_id=account_id,
        )
        enqueue_agent_resource_collection(
            tenant_id=app.tenant_id,
            workspace_ids=deleted.workspace_ids,
            binding_ids=deleted.binding_ids,
            home_snapshot_ids=deleted.home_snapshot_ids,
            purge_agent_ids=[deleted.backing_agent_id] if deleted.backing_agent_id is not None else [],
        )

        # clean up web app settings
        if SystemFeatureService.is_webapp_auth_enabled():
            EnterpriseService.WebAppAuth.cleanup_webapp(app.id)

        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            BillingService.clean_billing_info_cache(app.tenant_id)
