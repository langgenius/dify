import logging
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError

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
    AgentWorkspaceOwnerType,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import ConversationFromSource
from models.model import App, Conversation, IconType, Message
from repositories.agent_roster_queries import (
    build_roster_agents_stmt,
    load_published_workflows_by_agent_id,
    load_reference_counts_by_agent_id,
)
from repositories.agent_version_queries import visible_version_ids, visible_version_operations
from repositories.app.agent_app_queries import get_app_backing_agent, get_roster_agent_app
from repositories.app.agent_debug_conversations import (
    create_agent_debug_conversation,
    get_or_create_agent_debug_conversation,
)
from repositories.app.agent_runtime_app import (
    create_hidden_backing_app,
    ensure_workflow_agent_backing_app,
    find_runtime_app,
    find_runtime_resolvable_agent,
    resolve_agent_runtime_app,
)
from services.agent.agent_soul_state import agent_soul_has_model
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import (
    AgentArchivedError,
    AgentBuildSandboxNotFoundError,
    AgentNameConflictError,
    AgentNotFoundError,
    AgentVersionNotFoundError,
)
from services.agent.knowledge_spaces import validate_agent_knowledge_spaces
from services.agent.workspace_service import AgentWorkspaceNotFoundError, AgentWorkspaceService, WorkspaceOwnerScope
from services.app.agent_app_contracts import AgentReferencingWorkflow
from services.app_service import AppService, CreateAppParams
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.agent_entities import RosterAgentCreatePayload, RosterAgentUpdatePayload
from services.rbac_agent_access_service import initialize_agent_rbac_access
from services.system_feature_service import SystemFeatureService
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection

logger = logging.getLogger(__name__)


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
        active_config_is_published: bool | None = None,
        reference_count: int | None = None,
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
            "backing_app_id": agent.backing_app_id,
            "hidden_app_backed": bool(agent.scope == AgentScope.WORKFLOW_ONLY and agent.backing_app_id),
            "debug_conversation_id": None,
            "workflow_id": agent.workflow_id,
            "workflow_node_id": agent.workflow_node_id,
            "active_config_snapshot_id": agent.active_config_snapshot_id,
            "active_config_snapshot": AgentRosterService.serialize_version(active_version) if active_version else None,
            "active_config_is_published": agent.active_config_is_published
            if active_config_is_published is None
            else active_config_is_published,
            "status": agent.status.value,
            "created_by": agent.created_by,
            "updated_by": agent.updated_by,
            "archived_by": agent.archived_by,
            "archived_at": to_timestamp(agent.archived_at),
            "created_at": to_timestamp(agent.created_at),
            "updated_at": to_timestamp(agent.updated_at),
            "reference_count": len(published_references) if reference_count is None else reference_count,
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

    def list_roster_agents(
        self, *, tenant_id: str, page: int = 1, limit: int = 20, keyword: str | None = None
    ) -> dict[str, Any]:
        """Read a page of active roster Agents in the supplied tenant using the existing session."""
        stmt = build_roster_agents_stmt(tenant_id=tenant_id, keyword=keyword)

        total = self._session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        agents = list(self._session.scalars(stmt.offset((page - 1) * limit).limit(limit)).all())
        versions_by_id = self._load_versions_by_id(
            [agent.active_config_snapshot_id for agent in agents if agent.active_config_snapshot_id]
        )
        published_references_by_agent_id = self._load_published_references_by_agent_id(
            tenant_id=tenant_id,
            agent_ids=[agent.id for agent in agents],
        )
        reference_counts_by_agent_id = load_reference_counts_by_agent_id(
            self._session,
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
                    reference_counts_by_agent_id.get(agent.id, 0),
                )
            )

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
        try:
            agent = self._create_roster_agent_in_transaction(
                tenant_id=tenant_id,
                account_id=account_id,
                payload=payload,
                source=source,
            )
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise AgentNameConflictError() from exc

        initialize_agent_rbac_access(tenant_id=tenant_id, agent_id=agent.id, creator_account_id=account_id)
        return agent

    def _create_roster_agent_in_transaction(
        self,
        *,
        tenant_id: str,
        account_id: str,
        payload: RosterAgentCreatePayload,
        source: AgentSource,
    ) -> Agent:
        ComposerConfigValidator.validate_agent_soul(payload.agent_soul)
        validate_agent_knowledge_spaces(
            session=self._session, tenant_id=tenant_id, account_id=account_id, agent_soul=payload.agent_soul
        )

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
        self._session.flush()

        version = AgentConfigSnapshot(
            tenant_id=tenant_id,
            agent_id=agent.id,
            version=1,
            config_snapshot=payload.agent_soul,
            home_snapshot_id=None,
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
        agent.active_config_is_published = True

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
        source: AgentSource = AgentSource.AGENT_APP,
        initial_soul: AgentSoulConfig | None = None,
        revision_operation: AgentConfigRevisionOperation = AgentConfigRevisionOperation.CREATE_VERSION,
    ) -> Agent:
        """Create the roster Agent that backs an Agent App, linked via ``app_id``.

        Unlike :meth:`create_roster_agent`, this does not commit: the caller
        (``AppService.create_app``) owns the surrounding transaction so the App
        row and its backing Agent are persisted atomically. The caller supplies
        the initial Agent Soul, or an empty one is seeded. Importers may provide
        a portable Soul and provenance while retaining the same transaction boundary.
        """
        soul = initial_soul or AgentSoulConfig()
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
            source=source,
            status=AgentStatus.ACTIVE,
            app_id=app_id,
            backing_app_id=app_id,
            created_by=account_id,
            updated_by=account_id,
        )
        self._session.add(agent)
        self._session.flush()

        version = AgentConfigSnapshot(
            tenant_id=tenant_id,
            agent_id=agent.id,
            version=1,
            config_snapshot=soul,
            home_snapshot_id=None,
            created_by=account_id,
        )
        self._session.add(version)
        self._session.flush()

        revision = AgentConfigRevision(
            tenant_id=tenant_id,
            agent_id=agent.id,
            current_snapshot_id=version.id,
            revision=1,
            operation=revision_operation,
            created_by=account_id,
        )
        self._session.add(revision)
        agent.active_config_snapshot_id = version.id
        agent.active_config_has_model = agent_soul_has_model(soul)
        agent.active_config_is_published = False
        self._session.flush()
        self._get_or_create_agent_app_debug_conversation(
            agent=agent,
            account_id=account_id,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
        )
        return agent

    def create_hidden_backing_app_for_workflow_agent(
        self,
        *,
        tenant_id: str,
        account_id: str | None,
        name: str,
        description: str = "",
        icon_type: str | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> App:
        """Stage an internal backing App in the existing roster transaction."""
        return create_hidden_backing_app(
            self._session,
            tenant_id=tenant_id,
            account_id=account_id,
            name=name,
            description=description,
            icon_type=icon_type,
            icon=icon,
            icon_background=icon_background,
        )

    @staticmethod
    def runtime_backing_app_id(agent: Agent) -> str | None:
        """Return the App id that backs Agent runtime chat/log/monitoring."""

        return agent.backing_app_id or agent.app_id

    def _get_or_create_agent_app_debug_conversation(
        self, *, agent: Agent, account_id: str, draft_type: AgentConfigDraftType
    ) -> str:
        """Return the editor's conversation for one Agent draft surface."""

        backing_app_id = ensure_workflow_agent_backing_app(self._session, agent=agent, account_id=account_id)
        if not backing_app_id:
            raise AgentNotFoundError()

        return get_or_create_agent_debug_conversation(
            self._session,
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            backing_app_id=backing_app_id,
            account_id=account_id,
            draft_type=draft_type,
        )

    def get_or_create_build_conversation(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        commit: bool = True,
    ) -> str:
        """Return the current editor's stable Build conversation."""

        agent = self._session.scalar(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.id == agent_id,
                Agent.status == AgentStatus.ACTIVE,
            )
        )
        if agent is None:
            raise AgentNotFoundError()

        conversation_id = self._get_or_create_agent_app_debug_conversation(
            agent=agent,
            account_id=account_id,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
        )
        if commit:
            self._session.commit()
        return conversation_id

    def get_current_preview_conversation(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
    ) -> str | None:
        """Return the editor's current Preview conversation without creating one."""

        return self._session.scalar(
            select(Conversation.id)
            .join(AgentDebugConversation, AgentDebugConversation.conversation_id == Conversation.id)
            .where(
                AgentDebugConversation.tenant_id == tenant_id,
                AgentDebugConversation.agent_id == agent_id,
                AgentDebugConversation.account_id == account_id,
                AgentDebugConversation.draft_type == AgentConfigDraftType.DRAFT,
                AgentDebugConversation.app_id == Conversation.app_id,
                Conversation.from_source == ConversationFromSource.CONSOLE,
                Conversation.from_account_id == account_id,
                Conversation.is_deleted.is_(False),
            )
        )

    def count_agent_app_debug_conversation_messages(self, *, conversation_id: str) -> int:
        """Return the number of visible messages in an Agent App debug conversation."""

        return (
            self._session.scalar(
                select(func.count(Message.id)).where(
                    Message.conversation_id == conversation_id,
                )
            )
            or 0
        )

    def rotate_preview_conversation(self, *, tenant_id: str, agent_id: str, account_id: str) -> str:
        """Rotate Preview and retire its exact Conversation-owned Binding.

        The mapping update and exact CONVERSATION Binding retirement commit in
        one transaction. Validation failures fail fast; collection is enqueued
        only after commit.
        """

        agent = self._session.scalar(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.id == agent_id,
                Agent.status == AgentStatus.ACTIVE,
            )
        )
        if agent is None:
            raise AgentNotFoundError()
        backing_app_id = ensure_workflow_agent_backing_app(
            self._session,
            agent=agent,
            account_id=agent.updated_by or agent.created_by,
        )
        if not backing_app_id:
            raise AgentNotFoundError()

        retired_binding_id: str | None = None
        try:
            conversation_id = create_agent_debug_conversation(
                self._session,
                app_id=backing_app_id,
                account_id=account_id,
            )
            mapping = self._session.scalar(
                select(AgentDebugConversation).where(
                    AgentDebugConversation.tenant_id == tenant_id,
                    AgentDebugConversation.agent_id == agent_id,
                    AgentDebugConversation.account_id == account_id,
                    AgentDebugConversation.draft_type == AgentConfigDraftType.DRAFT,
                )
            )
            if mapping is None:
                self._session.add(
                    AgentDebugConversation(
                        tenant_id=tenant_id,
                        agent_id=agent_id,
                        app_id=backing_app_id,
                        account_id=account_id,
                        draft_type=AgentConfigDraftType.DRAFT,
                        conversation_id=conversation_id,
                    )
                )
            else:
                previous_app_id = mapping.app_id or backing_app_id
                previous_conversation_id = mapping.conversation_id
                if previous_conversation_id:
                    previous_conversation = self._session.scalar(
                        select(Conversation).where(
                            Conversation.id == previous_conversation_id,
                            Conversation.app_id == previous_app_id,
                            Conversation.from_source == ConversationFromSource.CONSOLE,
                            Conversation.from_account_id == account_id,
                            Conversation.is_deleted.is_(False),
                        )
                    )
                    if (
                        previous_conversation is not None
                        and previous_conversation.agent_workspace_binding_id is not None
                    ):
                        binding_id = previous_conversation.agent_workspace_binding_id
                        binding = AgentWorkspaceService.get_active_binding(
                            session=self._session,
                            tenant_id=tenant_id,
                            binding_id=binding_id,
                            expected_owner_scope=WorkspaceOwnerScope(
                                tenant_id=tenant_id,
                                app_id=previous_app_id,
                                owner_type=AgentWorkspaceOwnerType.CONVERSATION,
                                owner_id=previous_conversation.id,
                            ),
                        )
                        if binding is None or binding.agent_id != agent_id:
                            raise AgentWorkspaceNotFoundError(
                                "Agent debug Conversation participant Binding is unavailable"
                            )
                        retired_binding_id = AgentWorkspaceService.retire_binding(
                            session=self._session,
                            tenant_id=tenant_id,
                            binding_id=binding_id,
                        )
                        if retired_binding_id is None:
                            raise AgentWorkspaceNotFoundError(
                                "Agent debug Conversation participant Binding is unavailable"
                            )
                mapping.app_id = backing_app_id
                mapping.conversation_id = conversation_id
            self._session.flush()
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise
        if retired_binding_id is not None:
            enqueue_agent_resource_collection(
                tenant_id=tenant_id,
                binding_ids=(retired_binding_id,),
            )
        return conversation_id

    def reset_build_conversation(self, *, tenant_id: str, agent_id: str, account_id: str) -> str:
        """Reset Build and retire its exact DEBUG_BUILD Draft-owned Binding.

        The mapping update, exact BUILD_DRAFT Binding retirement, and Draft
        pointer clear commit in one transaction. Validation failures fail fast;
        collection is enqueued only after commit.
        """

        agent = self._session.scalar(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.id == agent_id,
                Agent.status == AgentStatus.ACTIVE,
            )
        )
        if agent is None:
            raise AgentNotFoundError()
        backing_app_id = ensure_workflow_agent_backing_app(
            self._session,
            agent=agent,
            account_id=agent.updated_by or agent.created_by,
        )
        if not backing_app_id:
            raise AgentNotFoundError()

        retired_binding_id: str | None = None
        try:
            conversation_id = create_agent_debug_conversation(
                self._session,
                app_id=backing_app_id,
                account_id=account_id,
            )
            mapping = self._session.scalar(
                select(AgentDebugConversation).where(
                    AgentDebugConversation.tenant_id == tenant_id,
                    AgentDebugConversation.agent_id == agent_id,
                    AgentDebugConversation.account_id == account_id,
                    AgentDebugConversation.draft_type == AgentConfigDraftType.DEBUG_BUILD,
                )
            )
            build_draft = self._session.scalar(
                select(AgentConfigDraft)
                .where(
                    AgentConfigDraft.tenant_id == tenant_id,
                    AgentConfigDraft.agent_id == agent_id,
                    AgentConfigDraft.draft_type == AgentConfigDraftType.DEBUG_BUILD,
                    AgentConfigDraft.account_id == account_id,
                )
                .order_by(AgentConfigDraft.updated_at.desc())
                .limit(1)
            )
            if build_draft is not None and build_draft.agent_workspace_binding_id is not None:
                binding_id = build_draft.agent_workspace_binding_id
                binding = AgentWorkspaceService.get_active_binding(
                    session=self._session,
                    tenant_id=tenant_id,
                    binding_id=binding_id,
                    expected_owner_scope=WorkspaceOwnerScope(
                        tenant_id=tenant_id,
                        app_id=backing_app_id,
                        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
                        owner_id=build_draft.id,
                    ),
                )
                if binding is None or binding.agent_id != agent_id:
                    raise AgentBuildSandboxNotFoundError()
                retired_binding_id = AgentWorkspaceService.retire_binding(
                    session=self._session,
                    tenant_id=tenant_id,
                    binding_id=binding_id,
                )
                if retired_binding_id is None:
                    raise AgentBuildSandboxNotFoundError()
                build_draft.agent_workspace_binding_id = None

            if mapping is None:
                self._session.add(
                    AgentDebugConversation(
                        tenant_id=tenant_id,
                        agent_id=agent_id,
                        app_id=backing_app_id,
                        account_id=account_id,
                        draft_type=AgentConfigDraftType.DEBUG_BUILD,
                        conversation_id=conversation_id,
                    )
                )
            else:
                mapping.app_id = backing_app_id
                mapping.conversation_id = conversation_id
            self._session.flush()
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise
        if retired_binding_id is not None:
            enqueue_agent_resource_collection(
                tenant_id=tenant_id,
                binding_ids=(retired_binding_id,),
            )
        return conversation_id

    def get_app_backing_agent(self, *, tenant_id: str, app_id: str) -> Agent | None:
        """Return the roster Agent that backs the given Agent App, if any."""
        return get_app_backing_agent(self._session, tenant_id=tenant_id, app_id=app_id)

    def get_published_agent_soul_for_app(self, *, tenant_id: str, app_id: str) -> AgentSoulConfig | None:
        """Return the active Agent Soul used by a published Agent App runtime."""
        agent = self.get_app_backing_agent(tenant_id=tenant_id, app_id=app_id)
        if agent is None:
            return None
        version = self._get_version(
            tenant_id=tenant_id,
            agent_id=agent.id,
            version_id=agent.active_config_snapshot_id,
        )
        return AgentSoulConfig.model_validate(version.config_snapshot_dict)

    def get_agent_app_model(self, *, tenant_id: str, agent_id: str) -> App:
        """Resolve the Agent App hidden behind an app-backed Agent id.

        The public /agent route uses Agent ids, while the runtime and legacy app
        APIs still operate on App ids internally. Only app-backed roster Agents
        are accepted here; workflow-only Agents and historical standalone roster
        Agents are not Agent App resources.
        """
        app = get_roster_agent_app(self._session, tenant_id=tenant_id, agent_id=agent_id)
        if app is None:
            raise AgentNotFoundError()
        return app

    def peek_authz_app_id(self, *, tenant_id: str, agent_id: str) -> str | None:
        """Resolve the App id whose access policy governs an Agent.

        Roster Agents are governed by their own Agent App, while workflow-only
        Agents are governed by their parent workflow App: the hidden runtime
        backing App never receives a resource access policy, so it must not be
        used for authorization. Stays read-only — unlike
        :meth:`get_agent_runtime_app_model`, this never materializes the hidden
        backing App. Returns ``None`` when the Agent does not resolve, leaving
        the caller to decide how to treat it.
        """

        agent = find_runtime_resolvable_agent(self._session, tenant_id=tenant_id, agent_id=agent_id)
        if agent is None:
            return None
        return agent.app_id

    def get_existing_agent_runtime_app_model(self, *, tenant_id: str, agent_id: str) -> App:
        """Resolve an existing runtime App without creating or committing state.

        Workflow-only Agents must already have a hidden backing App. Their
        parent workflow App must never stand in for a missing runtime App.
        """
        agent = find_runtime_resolvable_agent(self._session, tenant_id=tenant_id, agent_id=agent_id)
        if agent is None:
            raise AgentNotFoundError()
        app_id = agent.backing_app_id if agent.scope == AgentScope.WORKFLOW_ONLY else self.runtime_backing_app_id(agent)
        if not app_id:
            raise AgentNotFoundError()
        app = find_runtime_app(self._session, tenant_id=tenant_id, app_id=app_id)
        if app is None:
            raise AgentNotFoundError()
        return app

    def get_agent_runtime_app_model(self, *, tenant_id: str, agent_id: str) -> App:
        """Resolve the Agent's runtime App, materializing a hidden backing App when required."""
        app = resolve_agent_runtime_app(self._session, tenant_id=tenant_id, agent_id=agent_id)
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
            session=self._session,
        )

        # A copy owns a new publication history. It remains private until its
        # first successful publish even when the source Agent is public.
        target_app.enable_site = False
        target_app.enable_api = False
        target_app.use_icon_as_answer_icon = source_app.use_icon_as_answer_icon
        target_app.tracing = source_app.tracing

        self._copy_app_model_config(source_app=source_app, target_app=target_app, account_id=account.id)
        self._copy_agent_active_snapshot(
            tenant_id=tenant_id,
            source_agent=source_agent,
            target_app_id=target_app.id,
            account_id=account.id,
        )
        from services.skill_management_service import SkillManagementService

        target_agent = self.get_app_backing_agent(tenant_id=tenant_id, app_id=target_app.id)
        if target_agent is None:
            raise AgentNotFoundError()
        SkillManagementService(session=self._session).copy_agent_bindings(
            tenant_id=tenant_id,
            source_agent_id=source_agent.id,
            source_snapshot_id=source_agent.active_config_snapshot_id or "",
            target_agent_id=target_agent.id,
            user_id=account.id,
            source_include_draft=not source_agent.active_config_is_published,
        )
        self._session.commit()
        if SystemFeatureService.is_webapp_auth_enabled():
            try:
                original_settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(source_app.id)
                access_mode = original_settings.access_mode
            except Exception:
                access_mode = "public"
            EnterpriseService.WebAppAuth.update_app_access_mode(target_app.id, access_mode)

        return target_app

    @staticmethod
    def _normalize_app_icon_type(icon_type: Any | None) -> str | None:
        if icon_type is None:
            return None
        if isinstance(icon_type, IconType) or hasattr(icon_type, "value"):
            return icon_type.value
        return icon_type

    def _copy_app_model_config(self, *, source_app: App, target_app: App, account_id: str) -> None:
        source_config = source_app.app_model_config_with_session(session=self._session)
        target_config = target_app.app_model_config_with_session(session=self._session)
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
        target_agent.active_config_is_published = False
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

    def get_roster_agent_detail(self, *, tenant_id: str, agent_id: str) -> dict[str, Any]:
        """Read the tenant's roster Agent and its current references, or raise AgentNotFoundError."""
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        active_version = self._get_version(
            tenant_id=tenant_id, agent_id=agent.id, version_id=agent.active_config_snapshot_id
        )
        published_references_by_agent_id = self._load_published_references_by_agent_id(
            tenant_id=tenant_id,
            agent_ids=[agent.id],
        )
        reference_counts_by_agent_id = load_reference_counts_by_agent_id(
            self._session,
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
            reference_counts_by_agent_id.get(agent.id, 0),
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

    def active_config_is_published(self, *, tenant_id: str, agent: Agent) -> bool:
        """Return whether the normal shared draft has been published into the active snapshot."""
        return self.load_active_config_is_published_by_agent_id(tenant_id=tenant_id, agents=[agent]).get(
            agent.id,
            False,
        )

    def load_active_config_is_published_by_agent_id(self, *, tenant_id: str, agents: list[Agent]) -> dict[str, bool]:
        """Return each Agent's stored normal-draft publish state.

        The flag is maintained by write paths against the normal shared draft:
        saves compare the draft content with the active snapshot, while publish
        and version creation paths mark the new active snapshot clean.
        User-scoped debug drafts intentionally do not affect this state.
        """
        agents = [agent for agent in agents if agent.id]
        if not agents:
            return {}

        return {
            agent.id: bool(agent.active_config_snapshot_id and agent.active_config_is_published) for agent in agents
        }

    def get_visible_agent_version_snapshot(
        self, *, tenant_id: str, agent_id: str, version_id: UUID
    ) -> AgentConfigSnapshot:
        """Resolve a version exposed in the roster history within its complete owner scope."""
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        visible_ids = visible_version_ids(tenant_id=tenant_id, agent_id=agent_id, agent=agent)
        snapshot = self._session.scalar(
            select(AgentConfigSnapshot).where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.id == str(version_id),
                AgentConfigSnapshot.id.in_(select(visible_ids.c.current_snapshot_id)),
            )
        )
        if snapshot is None:
            raise AgentVersionNotFoundError()
        return snapshot

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
                AgentConfigRevision.operation.in_(visible_version_operations(agent)),
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
        """Return the legacy response shape for current published references in this tenant."""
        return {
            agent_id: [
                AgentReferencingWorkflow(
                    app_id=reference.app.id,
                    app_name=reference.app.name,
                    app_icon_type=reference.app.icon_type.value if reference.app.icon_type else None,
                    app_icon=reference.app.icon,
                    app_icon_background=reference.app.icon_background,
                    app_mode=str(reference.app.mode),
                    app_updated_at=to_timestamp(reference.app.updated_at),
                    workflow_id=reference.workflow_id,
                    workflow_version=reference.workflow_version,
                    node_ids=list(reference.node_ids),
                )
                for reference in references
            ]
            for agent_id, references in load_published_workflows_by_agent_id(
                self._session, tenant_id=tenant_id, agent_ids=agent_ids
            ).items()
        }

    def _load_versions_by_id(self, version_ids: list[str]) -> dict[str, AgentConfigSnapshot]:
        if not version_ids:
            return {}
        versions = self._session.scalars(
            select(AgentConfigSnapshot).where(AgentConfigSnapshot.id.in_(version_ids))
        ).all()
        return {version.id: version for version in versions}
