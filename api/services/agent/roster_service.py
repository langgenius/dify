from typing import Any, TypedDict

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError

from core.app.entities.app_invoke_entities import InvokeFrom
from libs.datetime_utils import naive_utc_now
from libs.helper import to_timestamp
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentDebugConversation,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus, ConversationFromSource, ConversationStatus
from models.model import App, AppMode, Conversation, IconType
from models.workflow import Workflow
from services.agent.agent_soul_state import agent_soul_has_model
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import (
    AgentArchivedError,
    AgentNameConflictError,
    AgentNotFoundError,
    AgentVersionNotFoundError,
)
from services.app_service import AppService, CreateAppParams
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.agent_entities import RosterAgentCreatePayload, RosterAgentUpdatePayload
from services.feature_service import FeatureService


class AgentReferencingWorkflow(TypedDict):
    """A workflow app that references a roster Agent via an Agent node."""

    app_id: str
    app_name: str
    app_icon_type: str | None
    app_icon: str | None
    app_icon_background: str | None
    app_mode: str
    app_updated_at: int | None
    workflow_id: str
    workflow_version: str
    node_ids: list[str]


class AgentRosterService:
    _APP_MODEL_CONFIG_COPY_FIELDS = (
        "opening_statement",
        "suggested_questions",
        "suggested_questions_after_answer",
        "speech_to_text",
        "text_to_speech",
        "more_like_this",
        "model",
        "user_input_form",
        "dataset_query_variable",
        "pre_prompt",
        "agent_mode",
        "sensitive_word_avoidance",
        "retriever_resource",
        "prompt_type",
        "chat_prompt_config",
        "completion_prompt_config",
        "dataset_configs",
        "external_data_tools",
        "file_upload",
    )

    def __init__(self, session: Any):
        self._session = session

    @staticmethod
    def serialize_agent(
        agent: Agent,
        active_version: AgentConfigSnapshot | None = None,
        published_references: list[AgentReferencingWorkflow] | None = None,
        active_config_is_published: bool = False,
    ) -> dict[str, Any]:
        published_references = published_references or []
        return {
            "id": agent.id,
            "name": agent.name,
            "description": agent.description,
            "role": agent.role or "",
            "icon_type": agent.icon_type.value if agent.icon_type else None,
            "icon": agent.icon,
            "icon_background": agent.icon_background,
            "agent_kind": agent.agent_kind.value,
            "scope": agent.scope.value,
            "source": agent.source.value,
            "app_id": agent.app_id,
            "debug_conversation_id": None,
            "workflow_id": agent.workflow_id,
            "workflow_node_id": agent.workflow_node_id,
            "active_config_snapshot_id": agent.active_config_snapshot_id,
            "active_config_snapshot": AgentRosterService.serialize_version(active_version) if active_version else None,
            "active_config_is_published": active_config_is_published,
            "status": agent.status.value,
            "created_by": agent.created_by,
            "updated_by": agent.updated_by,
            "archived_by": agent.archived_by,
            "archived_at": to_timestamp(agent.archived_at),
            "created_at": to_timestamp(agent.created_at),
            "updated_at": to_timestamp(agent.updated_at),
            "published_reference_count": len(published_references),
            "published_node_reference_count": sum(len(item["node_ids"]) for item in published_references),
            "published_references": published_references,
        }

    @staticmethod
    def serialize_version(version: AgentConfigSnapshot | None) -> dict[str, Any] | None:
        if version is None:
            return None
        return {
            "id": version.id,
            "agent_id": version.agent_id,
            "version": version.version,
            "display_version": version.version,
            "snapshot_version": version.version,
            "summary": version.summary,
            "version_note": version.version_note,
            "created_by": version.created_by,
            "created_at": to_timestamp(version.created_at),
        }

    @classmethod
    def _serialize_visible_version(
        cls,
        version: AgentConfigSnapshot,
        *,
        display_version: int,
    ) -> dict[str, Any]:
        payload = cls.serialize_version(version) or {}
        payload["version"] = display_version
        payload["display_version"] = display_version
        payload["snapshot_version"] = version.version
        return payload

    @staticmethod
    def _build_roster_agents_stmt(*, tenant_id: str, keyword: str | None = None):
        stmt = select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.scope == AgentScope.ROSTER,
            Agent.status == AgentStatus.ACTIVE,
        )
        if keyword:
            from libs.helper import escape_like_pattern

            escaped_keyword = escape_like_pattern(keyword)
            stmt = stmt.where(Agent.name.ilike(f"%{escaped_keyword}%", escape="\\"))
        return stmt.order_by(Agent.updated_at.desc())

    def list_roster_agents(
        self, *, tenant_id: str, page: int = 1, limit: int = 20, keyword: str | None = None
    ) -> dict[str, Any]:
        stmt = self._build_roster_agents_stmt(tenant_id=tenant_id, keyword=keyword)

        total = self._session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        agents = list(self._session.scalars(stmt.offset((page - 1) * limit).limit(limit)).all())
        versions_by_id = self._load_versions_by_id(
            [agent.active_config_snapshot_id for agent in agents if agent.active_config_snapshot_id]
        )
        published_references_by_agent_id = self._load_published_references_by_agent_id(
            tenant_id=tenant_id,
            agent_ids=[agent.id for agent in agents],
        )
        active_config_is_published_by_agent_id = self.load_active_config_is_published_by_agent_id(
            tenant_id=tenant_id,
            agents=agents,
        )

        data = []
        for agent in agents:
            active_version = (
                versions_by_id.get(agent.active_config_snapshot_id) if agent.active_config_snapshot_id else None
            )
            data.append(
                self.serialize_agent(
                    agent,
                    active_version,
                    published_references_by_agent_id.get(agent.id, []),
                    active_config_is_published_by_agent_id.get(agent.id, False),
                )
            )

        return {
            "data": data,
            "page": page,
            "limit": limit,
            "total": total,
            "has_more": page * limit < total,
        }

    def list_invite_options(
        self, *, tenant_id: str, page: int = 1, limit: int = 20, keyword: str | None = None, app_id: str | None = None
    ) -> dict[str, Any]:
        stmt = self._build_roster_agents_stmt(tenant_id=tenant_id, keyword=keyword).where(
            Agent.active_config_has_model.is_(True)
        )
        total = self._session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        agents = list(self._session.scalars(stmt.offset((page - 1) * limit).limit(limit)).all())
        versions_by_id = self._load_versions_by_id(
            [agent.active_config_snapshot_id for agent in agents if agent.active_config_snapshot_id]
        )
        published_references_by_agent_id = self._load_published_references_by_agent_id(
            tenant_id=tenant_id,
            agent_ids=[agent.id for agent in agents],
        )
        active_config_is_published_by_agent_id = self.load_active_config_is_published_by_agent_id(
            tenant_id=tenant_id,
            agents=agents,
        )
        data = [
            self.serialize_agent(
                agent,
                versions_by_id.get(agent.active_config_snapshot_id) if agent.active_config_snapshot_id else None,
                published_references_by_agent_id.get(agent.id, []),
                active_config_is_published_by_agent_id.get(agent.id, False),
            )
            for agent in agents
        ]
        usage_by_agent_id: dict[str, list[str]] = {}
        if app_id:
            draft_workflow = self._session.scalar(
                select(Workflow)
                .where(
                    Workflow.tenant_id == tenant_id,
                    Workflow.app_id == app_id,
                    Workflow.version == Workflow.VERSION_DRAFT,
                )
                .limit(1)
            )
            if draft_workflow:
                agent_ids = [item["id"] for item in data]
                if agent_ids:
                    bindings = self._session.scalars(
                        select(WorkflowAgentNodeBinding).where(
                            WorkflowAgentNodeBinding.tenant_id == tenant_id,
                            WorkflowAgentNodeBinding.workflow_id == draft_workflow.id,
                            WorkflowAgentNodeBinding.agent_id.in_(agent_ids),
                        )
                    ).all()
                    for binding in bindings:
                        if binding.agent_id:
                            usage_by_agent_id.setdefault(binding.agent_id, []).append(binding.node_id)

        for item in data:
            existing_node_ids = usage_by_agent_id.get(item["id"], [])
            item["is_in_current_workflow"] = bool(existing_node_ids)
            item["in_current_workflow_count"] = len(existing_node_ids)
            item["existing_node_ids"] = existing_node_ids
        return {
            "data": data,
            "page": page,
            "limit": limit,
            "total": total,
            "has_more": page * limit < total,
        }

    def create_roster_agent(
        self,
        *,
        tenant_id: str,
        account_id: str,
        payload: RosterAgentCreatePayload,
        source: AgentSource = AgentSource.ROSTER,
    ) -> Agent:
        ComposerConfigValidator.validate_agent_soul(payload.agent_soul)

        agent = Agent(
            tenant_id=tenant_id,
            name=payload.name,
            description=payload.description,
            role=payload.role,
            icon_type=payload.icon_type,
            icon=payload.icon,
            icon_background=payload.icon_background,
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=source,
            status=AgentStatus.ACTIVE,
            created_by=account_id,
            updated_by=account_id,
        )
        self._session.add(agent)
        try:
            self._session.flush()
        except IntegrityError as exc:
            self._session.rollback()
            raise AgentNameConflictError() from exc

        version = AgentConfigSnapshot(
            tenant_id=tenant_id,
            agent_id=agent.id,
            version=1,
            config_snapshot=payload.agent_soul,
            version_note=payload.version_note,
            created_by=account_id,
        )
        self._session.add(version)
        self._session.flush()

        revision = AgentConfigRevision(
            tenant_id=tenant_id,
            agent_id=agent.id,
            current_snapshot_id=version.id,
            revision=1,
            operation=AgentConfigRevisionOperation.CREATE_VERSION,
            version_note=payload.version_note,
            created_by=account_id,
        )
        self._session.add(revision)
        agent.active_config_snapshot_id = version.id
        agent.active_config_has_model = agent_soul_has_model(payload.agent_soul)

        try:
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise AgentNameConflictError() from exc
        return agent

    def create_backing_agent_for_app(
        self,
        *,
        tenant_id: str,
        account_id: str,
        app_id: str,
        name: str,
        description: str = "",
        role: str = "",
        icon_type: Any = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> Agent:
        """Create the roster Agent that backs an Agent App, linked via ``app_id``.

        Unlike :meth:`create_roster_agent`, this does not commit: the caller
        (``AppService.create_app``) owns the surrounding transaction so the App
        row and its backing Agent are persisted atomically. A default (empty)
        Agent Soul is seeded; the user configures model/prompt/tools afterward in
        the Composer.
        """
        agent = Agent(
            tenant_id=tenant_id,
            name=name,
            description=description,
            role=role,
            icon_type=icon_type,
            icon=icon,
            icon_background=icon_background,
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            app_id=app_id,
            created_by=account_id,
            updated_by=account_id,
        )
        self._session.add(agent)
        try:
            self._session.flush()
        except IntegrityError as exc:
            self._session.rollback()
            raise AgentNameConflictError() from exc

        version = AgentConfigSnapshot(
            tenant_id=tenant_id,
            agent_id=agent.id,
            version=1,
            config_snapshot=AgentSoulConfig(),
            created_by=account_id,
        )
        self._session.add(version)
        self._session.flush()

        revision = AgentConfigRevision(
            tenant_id=tenant_id,
            agent_id=agent.id,
            current_snapshot_id=version.id,
            revision=1,
            operation=AgentConfigRevisionOperation.CREATE_VERSION,
            created_by=account_id,
        )
        self._session.add(revision)
        agent.active_config_snapshot_id = version.id
        agent.active_config_has_model = agent_soul_has_model(AgentSoulConfig())
        self._session.flush()
        self._get_or_create_agent_app_debug_conversation(agent=agent, account_id=account_id)
        return agent

    def _create_agent_app_debug_conversation(self, *, app_id: str, account_id: str) -> str:
        """Create one console debug conversation for an Agent App editor."""

        conversation = Conversation(
            app_id=app_id,
            app_model_config_id=None,
            model_provider=None,
            model_id="",
            override_model_configs=None,
            mode=AppMode.AGENT,
            name="Agent Debugging Conversation",
            inputs={},
            introduction="",
            system_instruction="",
            system_instruction_tokens=0,
            status=ConversationStatus.NORMAL,
            invoke_from=InvokeFrom.DEBUGGER,
            from_source=ConversationFromSource.CONSOLE,
            from_end_user_id=None,
            from_account_id=account_id,
        )
        self._session.add(conversation)
        self._session.flush()
        return conversation.id

    def _get_or_create_agent_app_debug_conversation(self, *, agent: Agent, account_id: str) -> str:
        if not agent.app_id:
            raise AgentNotFoundError()

        mapping = self._session.scalar(
            select(AgentDebugConversation).where(
                AgentDebugConversation.tenant_id == agent.tenant_id,
                AgentDebugConversation.agent_id == agent.id,
                AgentDebugConversation.account_id == account_id,
            )
        )
        if mapping is not None:
            conversation_id = self._session.scalar(
                select(Conversation.id).where(
                    Conversation.id == mapping.conversation_id,
                    Conversation.app_id == agent.app_id,
                    Conversation.from_source == ConversationFromSource.CONSOLE,
                    Conversation.from_account_id == account_id,
                    Conversation.is_deleted.is_(False),
                )
            )
            if conversation_id:
                return conversation_id

            mapping.conversation_id = self._create_agent_app_debug_conversation(
                app_id=agent.app_id,
                account_id=account_id,
            )
            self._session.flush()
            return mapping.conversation_id

        conversation_id = self._create_agent_app_debug_conversation(
            app_id=agent.app_id,
            account_id=account_id,
        )
        self._session.add(
            AgentDebugConversation(
                tenant_id=agent.tenant_id,
                agent_id=agent.id,
                app_id=agent.app_id,
                account_id=account_id,
                conversation_id=conversation_id,
            )
        )
        self._session.flush()
        return conversation_id

    def get_or_create_agent_app_debug_conversation_id(
        self, *, tenant_id: str, agent_id: str, account_id: str, commit: bool = True
    ) -> str:
        """Return the current editor's debug conversation for an Agent App."""

        agent = self._session.scalar(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.id == agent_id,
                Agent.scope == AgentScope.ROSTER,
                Agent.source == AgentSource.AGENT_APP,
                Agent.status == AgentStatus.ACTIVE,
            )
        )
        if agent is None:
            raise AgentNotFoundError()

        conversation_id = self._get_or_create_agent_app_debug_conversation(agent=agent, account_id=account_id)
        if commit:
            self._session.commit()
        return conversation_id

    def refresh_agent_app_debug_conversation_id(
        self, *, tenant_id: str, agent_id: str, account_id: str, commit: bool = True
    ) -> str:
        """Start a new console debug conversation for the current Agent App editor."""

        agent = self._session.scalar(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.id == agent_id,
                Agent.scope == AgentScope.ROSTER,
                Agent.source == AgentSource.AGENT_APP,
                Agent.status == AgentStatus.ACTIVE,
            )
        )
        if agent is None or not agent.app_id:
            raise AgentNotFoundError()

        conversation_id = self._create_agent_app_debug_conversation(
            app_id=agent.app_id,
            account_id=account_id,
        )
        mapping = self._session.scalar(
            select(AgentDebugConversation).where(
                AgentDebugConversation.tenant_id == tenant_id,
                AgentDebugConversation.agent_id == agent_id,
                AgentDebugConversation.account_id == account_id,
            )
        )
        if mapping is None:
            self._session.add(
                AgentDebugConversation(
                    tenant_id=tenant_id,
                    agent_id=agent_id,
                    app_id=agent.app_id,
                    account_id=account_id,
                    conversation_id=conversation_id,
                )
            )
        else:
            mapping.app_id = agent.app_id
            mapping.conversation_id = conversation_id
        self._session.flush()
        if commit:
            self._session.commit()
        return conversation_id

    def load_or_create_agent_app_debug_conversation_ids_by_agent_id(
        self, *, tenant_id: str, agents: list[Agent], account_id: str
    ) -> dict[str, str]:
        """Return per-account debug conversations for a page of Agent Apps."""

        conversation_ids_by_agent_id: dict[str, str] = {}
        changed = False
        for agent in agents:
            if (
                agent.tenant_id != tenant_id
                or agent.scope != AgentScope.ROSTER
                or agent.source != AgentSource.AGENT_APP
            ):
                continue
            conversation_ids_by_agent_id[agent.id] = self._get_or_create_agent_app_debug_conversation(
                agent=agent,
                account_id=account_id,
            )
            changed = True
        if changed:
            self._session.commit()
        return conversation_ids_by_agent_id

    def load_app_backing_agents_by_app_id(self, *, tenant_id: str, app_ids: list[str]) -> dict[str, Agent]:
        """Return active app-backed Agents keyed by Agent App id."""
        if not app_ids:
            return {}
        agents = self._session.scalars(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.app_id.in_(app_ids),
                Agent.scope == AgentScope.ROSTER,
                Agent.source == AgentSource.AGENT_APP,
                Agent.status == AgentStatus.ACTIVE,
            )
        ).all()
        return {agent.app_id: agent for agent in agents if agent.app_id}

    def get_app_backing_agent(self, *, tenant_id: str, app_id: str) -> Agent | None:
        """Return the roster Agent that backs the given Agent App, if any."""
        return self._session.scalar(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.app_id == app_id,
                Agent.scope == AgentScope.ROSTER,
                Agent.source == AgentSource.AGENT_APP,
                Agent.status == AgentStatus.ACTIVE,
            )
        )

    def get_agent_app_model(self, *, tenant_id: str, agent_id: str) -> App:
        """Resolve the Agent App hidden behind an app-backed Agent id.

        The public /agent route uses Agent ids, while the runtime and legacy app
        APIs still operate on App ids internally. Only app-backed roster Agents
        are accepted here; workflow-only Agents and historical standalone roster
        Agents are not Agent App resources.
        """
        agent = self._session.scalar(
            select(Agent)
            .where(
                Agent.tenant_id == tenant_id,
                Agent.id == agent_id,
                Agent.scope == AgentScope.ROSTER,
                Agent.source == AgentSource.AGENT_APP,
                Agent.app_id.is_not(None),
                Agent.status == AgentStatus.ACTIVE,
            )
            .limit(1)
        )
        if agent is None or agent.app_id is None:
            raise AgentNotFoundError()

        app = self._session.scalar(
            select(App)
            .where(
                App.tenant_id == tenant_id,
                App.id == agent.app_id,
                App.mode == AppMode.AGENT,
                App.status == AppStatus.NORMAL,
            )
            .limit(1)
        )
        if app is None:
            raise AgentNotFoundError()
        return app

    def duplicate_agent_app(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account: Any,
        name: str | None = None,
        description: str | None = None,
        role: str | None = None,
        icon_type: Any = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> App:
        source_app = self.get_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        source_agent = self.get_app_backing_agent(tenant_id=tenant_id, app_id=source_app.id)
        if source_agent is None:
            raise AgentNotFoundError()

        copied_name = name or self._next_duplicate_agent_name(tenant_id=tenant_id, base_name=source_app.name)
        copied_description = description if description is not None else source_app.description
        copied_role = role if role is not None else source_agent.role or ""
        copied_icon_type = icon_type if icon_type is not None else source_app.icon_type
        copied_icon = icon if icon is not None else source_app.icon
        copied_icon_background = icon_background if icon_background is not None else source_app.icon_background

        target_app = AppService().create_app(
            tenant_id,
            CreateAppParams(
                name=copied_name,
                description=copied_description,
                mode="agent",
                agent_role=copied_role,
                icon_type=self._normalize_app_icon_type(copied_icon_type),
                icon=copied_icon,
                icon_background=copied_icon_background,
                api_rph=source_app.api_rph or 0,
                api_rpm=source_app.api_rpm or 0,
                max_active_requests=source_app.max_active_requests,
            ),
            account,
        )

        target_app.enable_site = source_app.enable_site
        target_app.enable_api = source_app.enable_api
        target_app.use_icon_as_answer_icon = source_app.use_icon_as_answer_icon
        target_app.tracing = source_app.tracing

        self._copy_app_model_config(source_app=source_app, target_app=target_app, account_id=account.id)
        self._copy_agent_active_snapshot(
            tenant_id=tenant_id,
            source_agent=source_agent,
            target_app_id=target_app.id,
            account_id=account.id,
        )
        self._session.commit()

        if FeatureService.get_system_features().webapp_auth.enabled:
            try:
                original_settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(source_app.id)
                access_mode = original_settings.access_mode
            except Exception:
                access_mode = "public"
            EnterpriseService.WebAppAuth.update_app_access_mode(target_app.id, access_mode)

        return target_app

    @staticmethod
    def _normalize_app_icon_type(icon_type: IconType | str | None) -> str | None:
        if icon_type is None:
            return None
        if isinstance(icon_type, IconType):
            return icon_type.value
        return icon_type

    def _copy_app_model_config(self, *, source_app: App, target_app: App, account_id: str) -> None:
        source_config = source_app.app_model_config
        target_config = target_app.app_model_config
        if source_config is None or target_config is None:
            return

        for field_name in self._APP_MODEL_CONFIG_COPY_FIELDS:
            setattr(target_config, field_name, getattr(source_config, field_name))
        target_config.updated_by = account_id

    def _copy_agent_active_snapshot(
        self,
        *,
        tenant_id: str,
        source_agent: Agent,
        target_app_id: str,
        account_id: str,
    ) -> None:
        target_agent = self.get_app_backing_agent(tenant_id=tenant_id, app_id=target_app_id)
        if target_agent is None:
            raise AgentNotFoundError()

        source_version = self._get_version(
            tenant_id=tenant_id,
            agent_id=source_agent.id,
            version_id=source_agent.active_config_snapshot_id,
        )
        target_version = self._get_version(
            tenant_id=tenant_id,
            agent_id=target_agent.id,
            version_id=target_agent.active_config_snapshot_id,
        )

        target_version.config_snapshot = AgentSoulConfig.model_validate(source_version.config_snapshot_dict)
        target_version.summary = source_version.summary
        target_version.version_note = source_version.version_note
        target_version.created_by = account_id
        target_agent.active_config_has_model = agent_soul_has_model(target_version.config_snapshot)
        target_agent.updated_by = account_id

    def _next_duplicate_agent_name(self, *, tenant_id: str, base_name: str) -> str:
        suffix = " copy"
        max_base_len = 255 - len(suffix)
        first_candidate = f"{base_name[:max_base_len]}{suffix}"
        candidates = [first_candidate]
        for index in range(2, 100):
            numbered_suffix = f" copy {index}"
            candidates.append(f"{base_name[: 255 - len(numbered_suffix)]}{numbered_suffix}")

        existing_names = set(
            self._session.scalars(
                select(Agent.name).where(
                    Agent.tenant_id == tenant_id,
                    Agent.scope == AgentScope.ROSTER,
                    Agent.status == AgentStatus.ACTIVE,
                    Agent.name.in_(candidates),
                )
            ).all()
        )
        for candidate in candidates:
            if candidate not in existing_names:
                return candidate
        return f"{base_name[:245]} copy {int(naive_utc_now().timestamp())}"

    def list_workflows_referencing_app_agent(self, *, tenant_id: str, app_id: str) -> list[AgentReferencingWorkflow]:
        """List the workflow apps that reference this Agent App's bound Agent.

        Read-only "Workflow access" surface: an Agent App is backed by a roster
        Agent, and workflow Agent nodes may bind that same roster Agent. This
        returns the distinct workflow apps (with the referencing node ids) so the
        console can show "used by" without exposing the workflow internals.
        """
        agent = self.get_app_backing_agent(tenant_id=tenant_id, app_id=app_id)
        if agent is None:
            return []

        return self._load_published_references_by_agent_id(tenant_id=tenant_id, agent_ids=[agent.id]).get(agent.id, [])

    def load_published_references_by_agent_id(
        self, *, tenant_id: str, agent_ids: list[str]
    ) -> dict[str, list[AgentReferencingWorkflow]]:
        """Return published workflow references grouped by roster Agent id."""
        return self._load_published_references_by_agent_id(tenant_id=tenant_id, agent_ids=agent_ids)

    def get_roster_agent_detail(self, *, tenant_id: str, agent_id: str) -> dict[str, Any]:
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        active_version = self._get_version(
            tenant_id=tenant_id, agent_id=agent.id, version_id=agent.active_config_snapshot_id
        )
        published_references_by_agent_id = self._load_published_references_by_agent_id(
            tenant_id=tenant_id,
            agent_ids=[agent.id],
        )
        active_config_is_published_by_agent_id = self.load_active_config_is_published_by_agent_id(
            tenant_id=tenant_id,
            agents=[agent],
        )
        return self.serialize_agent(
            agent,
            active_version,
            published_references_by_agent_id.get(agent.id, []),
            active_config_is_published_by_agent_id.get(agent.id, False),
        )

    def update_roster_agent(
        self, *, tenant_id: str, agent_id: str, account_id: str, payload: RosterAgentUpdatePayload
    ) -> dict[str, Any]:
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        if agent.status == AgentStatus.ARCHIVED:
            raise AgentArchivedError()

        update_data = payload.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(agent, key, value)
        agent.updated_by = account_id

        try:
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise AgentNameConflictError() from exc
        return self.get_roster_agent_detail(tenant_id=tenant_id, agent_id=agent_id)

    def archive_roster_agent(self, *, tenant_id: str, agent_id: str, account_id: str) -> None:
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        if agent.status == AgentStatus.ARCHIVED:
            return
        agent.status = AgentStatus.ARCHIVED
        agent.archived_by = account_id
        agent.archived_at = naive_utc_now()
        agent.updated_by = account_id
        self._session.commit()

    @staticmethod
    def _visible_version_operations(agent: Agent) -> set[AgentConfigRevisionOperation]:
        if agent.source == AgentSource.AGENT_APP:
            return {
                AgentConfigRevisionOperation.PUBLISH_DRAFT,
                AgentConfigRevisionOperation.SAVE_NEW_VERSION,
                AgentConfigRevisionOperation.SAVE_TO_ROSTER,
                AgentConfigRevisionOperation.RESTORE_VERSION,
            }
        return {
            AgentConfigRevisionOperation.CREATE_VERSION,
            AgentConfigRevisionOperation.SAVE_NEW_VERSION,
            AgentConfigRevisionOperation.SAVE_NEW_AGENT,
            AgentConfigRevisionOperation.SAVE_TO_ROSTER,
            AgentConfigRevisionOperation.RESTORE_VERSION,
        }

    def active_config_is_published(self, *, tenant_id: str, agent: Agent) -> bool:
        """Return whether the editable draft matches the active published snapshot."""
        return self.load_active_config_is_published_by_agent_id(tenant_id=tenant_id, agents=[agent]).get(
            agent.id,
            False,
        )

    def load_active_config_is_published_by_agent_id(self, *, tenant_id: str, agents: list[Agent]) -> dict[str, bool]:
        """Return whether each Agent's normal draft is aligned with its active published snapshot."""
        published_agent_ids = self._load_published_active_snapshot_agent_ids(tenant_id=tenant_id, agents=agents)
        drafts = self._session.scalars(
            select(AgentConfigDraft).where(
                AgentConfigDraft.tenant_id == tenant_id,
                AgentConfigDraft.agent_id.in_([agent.id for agent in agents] or [""]),
                AgentConfigDraft.draft_type == AgentConfigDraftType.DRAFT,
                AgentConfigDraft.account_id.is_(None),
            )
        ).all()
        drafts_by_agent_id = {draft.agent_id: draft for draft in drafts}
        result: dict[str, bool] = {}
        for agent in agents:
            draft = drafts_by_agent_id.get(agent.id)
            result[agent.id] = (
                agent.id in published_agent_ids
                and bool(agent.active_config_snapshot_id)
                and (draft is None or draft.base_snapshot_id == agent.active_config_snapshot_id)
            )
        return result

    def list_agent_versions(self, *, tenant_id: str, agent_id: str) -> list[dict[str, Any]]:
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        visible_version_ids = self._visible_version_ids_stmt(tenant_id=tenant_id, agent_id=agent_id, agent=agent)
        versions = list(
            self._session.scalars(
                select(AgentConfigSnapshot)
                .where(
                    AgentConfigSnapshot.tenant_id == tenant_id,
                    AgentConfigSnapshot.agent_id == agent_id,
                    AgentConfigSnapshot.id.in_(select(visible_version_ids.c.current_snapshot_id)),
                )
                .order_by(AgentConfigSnapshot.version.desc())
            ).all()
        )
        total = len(versions)
        return [
            self._serialize_visible_version(version, display_version=total - index)
            for index, version in enumerate(versions)
        ]

    def _visible_version_ids_stmt(self, *, tenant_id: str, agent_id: str, agent: Agent):
        return (
            select(AgentConfigRevision.current_snapshot_id)
            .where(
                AgentConfigRevision.tenant_id == tenant_id,
                AgentConfigRevision.agent_id == agent_id,
                AgentConfigRevision.operation.in_(self._visible_version_operations(agent)),
            )
            .subquery()
        )

    def get_agent_version_detail(self, *, tenant_id: str, agent_id: str, version_id: str) -> dict[str, Any]:
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        visible_version_ids = self._visible_version_ids_stmt(tenant_id=tenant_id, agent_id=agent_id, agent=agent)
        visible_versions = list(
            self._session.scalars(
                select(AgentConfigSnapshot)
                .where(
                    AgentConfigSnapshot.tenant_id == tenant_id,
                    AgentConfigSnapshot.agent_id == agent_id,
                    AgentConfigSnapshot.id.in_(select(visible_version_ids.c.current_snapshot_id)),
                )
                .order_by(AgentConfigSnapshot.version.asc())
            ).all()
        )
        display_versions_by_id = {version.id: index for index, version in enumerate(visible_versions, start=1)}
        if version_id not in display_versions_by_id:
            raise AgentVersionNotFoundError()
        version = self._get_version(tenant_id=tenant_id, agent_id=agent_id, version_id=version_id)
        revisions = list(
            self._session.scalars(
                select(AgentConfigRevision)
                .where(
                    AgentConfigRevision.tenant_id == tenant_id,
                    AgentConfigRevision.agent_id == agent_id,
                    AgentConfigRevision.current_snapshot_id == version_id,
                )
                .order_by(AgentConfigRevision.revision.desc())
            ).all()
        )
        result = self._serialize_visible_version(version, display_version=display_versions_by_id[version_id])
        result["config_snapshot"] = version.config_snapshot_dict
        result["revisions"] = [
            {
                "id": revision.id,
                "previous_snapshot_id": revision.previous_snapshot_id,
                "current_snapshot_id": revision.current_snapshot_id,
                "revision": revision.revision,
                "operation": revision.operation.value,
                "summary": revision.summary,
                "version_note": revision.version_note,
                "created_by": revision.created_by,
                "created_at": to_timestamp(revision.created_at),
            }
            for revision in revisions
        ]
        return result

    def restore_agent_version(
        self, *, tenant_id: str, agent_id: str, version_id: str, account_id: str
    ) -> dict[str, Any]:
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        visible_version_ids = self._visible_version_ids_stmt(tenant_id=tenant_id, agent_id=agent_id, agent=agent)
        visible_version_id = self._session.scalar(
            select(AgentConfigSnapshot.id)
            .where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.id == version_id,
                AgentConfigSnapshot.id.in_(select(visible_version_ids.c.current_snapshot_id)),
            )
            .limit(1)
        )
        if not visible_version_id:
            raise AgentVersionNotFoundError()

        version = self._get_version(tenant_id=tenant_id, agent_id=agent_id, version_id=version_id)
        draft = self._session.scalar(
            select(AgentConfigDraft)
            .where(
                AgentConfigDraft.tenant_id == tenant_id,
                AgentConfigDraft.agent_id == agent_id,
                AgentConfigDraft.draft_type == AgentConfigDraftType.DRAFT,
                AgentConfigDraft.account_id.is_(None),
            )
            .limit(1)
        )
        if draft is None:
            draft = AgentConfigDraft(
                tenant_id=tenant_id,
                agent_id=agent_id,
                draft_type=AgentConfigDraftType.DRAFT,
                account_id=None,
                draft_owner_key="",
                created_by=account_id,
            )
            self._session.add(draft)
        draft.base_snapshot_id = version.id
        draft.config_snapshot = AgentSoulConfig.model_validate(version.config_snapshot_dict)
        draft.updated_by = account_id
        agent.updated_by = account_id
        self._session.commit()
        return {
            "result": "success",
            "active_config_snapshot_id": agent.active_config_snapshot_id or version.id,
            "draft_config_id": draft.id,
            "restored_version_id": version.id,
        }

    def _get_agent(self, *, tenant_id: str, agent_id: str, roster_only: bool = False) -> Agent:
        stmt = select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id)
        if roster_only:
            stmt = stmt.where(Agent.scope == AgentScope.ROSTER)
        agent = self._session.scalar(stmt.limit(1))
        if not agent:
            raise AgentNotFoundError()
        return agent

    def _get_version(self, *, tenant_id: str, agent_id: str, version_id: str | None) -> AgentConfigSnapshot:
        if not version_id:
            raise AgentVersionNotFoundError()
        version = self._session.scalar(
            select(AgentConfigSnapshot)
            .where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.id == version_id,
            )
            .limit(1)
        )
        if not version:
            raise AgentVersionNotFoundError()
        return version

    def _next_revision(self, *, tenant_id: str, agent_id: str) -> int:
        return (
            self._session.scalar(
                select(func.max(AgentConfigRevision.revision)).where(
                    AgentConfigRevision.tenant_id == tenant_id,
                    AgentConfigRevision.agent_id == agent_id,
                )
            )
            or 0
        ) + 1

    def _load_published_active_snapshot_agent_ids(self, *, tenant_id: str, agents: list[Agent]) -> set[str]:
        predicates = [
            and_(
                AgentConfigRevision.agent_id == agent.id,
                AgentConfigRevision.current_snapshot_id == agent.active_config_snapshot_id,
                AgentConfigRevision.operation.in_(self._visible_version_operations(agent)),
            )
            for agent in agents
            if agent.active_config_snapshot_id
        ]
        if not predicates:
            return set()

        agent_ids = self._session.scalars(
            select(AgentConfigRevision.agent_id)
            .where(
                AgentConfigRevision.tenant_id == tenant_id,
                or_(*predicates),
            )
            .distinct()
        ).all()
        return set(agent_ids)

    def _load_published_references_by_agent_id(
        self, *, tenant_id: str, agent_ids: list[str]
    ) -> dict[str, list[AgentReferencingWorkflow]]:
        if not agent_ids:
            return {}

        bindings = list(
            self._session.scalars(
                select(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.tenant_id == tenant_id,
                    WorkflowAgentNodeBinding.agent_id.in_(agent_ids),
                    WorkflowAgentNodeBinding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT,
                    WorkflowAgentNodeBinding.workflow_version != Workflow.VERSION_DRAFT,
                )
            ).all()
        )
        if not bindings:
            return {}

        app_ids = {binding.app_id for binding in bindings}
        apps = {
            app.id: app
            for app in self._session.scalars(
                select(App).where(
                    App.tenant_id == tenant_id,
                    App.id.in_(app_ids),
                    App.status == AppStatus.NORMAL,
                )
            ).all()
        }

        grouped: dict[str, dict[tuple[str, str], AgentReferencingWorkflow]] = {}
        for binding in bindings:
            if not binding.agent_id:
                continue
            app = apps.get(binding.app_id)
            if app is None or app.workflow_id != binding.workflow_id:
                continue
            by_workflow = grouped.setdefault(binding.agent_id, {})
            key = (binding.app_id, binding.workflow_id)
            item = by_workflow.setdefault(
                key,
                AgentReferencingWorkflow(
                    app_id=binding.app_id,
                    app_name=app.name,
                    app_icon_type=(icon_type.value if (icon_type := getattr(app, "icon_type", None)) else None),
                    app_icon=getattr(app, "icon", None),
                    app_icon_background=getattr(app, "icon_background", None),
                    app_mode=str(app.mode),
                    app_updated_at=to_timestamp(getattr(app, "updated_at", None)),
                    workflow_id=binding.workflow_id,
                    workflow_version=binding.workflow_version,
                    node_ids=[],
                ),
            )
            item["node_ids"].append(binding.node_id)

        result: dict[str, list[AgentReferencingWorkflow]] = {}
        for agent_id, by_workflow in grouped.items():
            references = list(by_workflow.values())
            for reference in references:
                reference["node_ids"] = sorted(set(reference["node_ids"]))
            references.sort(key=lambda item: (-(item["app_updated_at"] or 0), item["app_name"].lower()))
            result[agent_id] = references
        return result

    def _load_versions_by_id(self, version_ids: list[str]) -> dict[str, AgentConfigSnapshot]:
        if not version_ids:
            return {}
        versions = self._session.scalars(
            select(AgentConfigSnapshot).where(AgentConfigSnapshot.id.in_(version_ids))
        ).all()
        return {version.id: version for version in versions}
