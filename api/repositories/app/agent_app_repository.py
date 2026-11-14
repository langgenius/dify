"""Agent App persistence, reusing the roster's canonical app and reference queries."""

from collections.abc import Sequence
from dataclasses import replace
from typing import Any, cast

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from constants.resource_access_token import ResourceAccessTokenResourceType
from core.agent.publish_visibility import agent_has_workflow_callable_active_snapshot
from core.agent.workspace import AgentWorkspaceBindingGenerationMismatchError, WorkspaceOwnerScope
from events.app_event import app_model_config_was_updated
from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models.agent import (
    APP_BACKED_AGENT_SOURCES,
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigVersionKind,
    AgentDebugConversation,
    AgentHomeSnapshot,
    AgentIconType,
    AgentScope,
    AgentStatus,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.agent_config_entities import AgentSoulConfig
from models.agent_soul_state import build_initial_agent_soul
from models.enums import ApiTokenType, AppStatus
from models.model import ApiToken, App, AppMode, AppModelConfig, AppModelConfigDict, Conversation
from repositories.agent_drafts import agent_soul_matches_active_config, get_or_create_agent_draft, save_agent_draft
from repositories.agent_roster_queries import (
    find_agent_draft,
    load_reference_counts_by_agent_id,
    project_agent_draft_summary,
)
from repositories.agent_roster_repository import load_published_references_by_agent_id
from repositories.agent_workspace_repository import AgentWorkspaceRepository, validate_binding_generation
from repositories.app.agent_app_queries import get_app_backing_agent, get_roster_agent_app
from repositories.app.agent_debug_conversations import (
    count_agent_debug_conversation_messages,
    create_agent_debug_conversation,
    get_or_create_agent_debug_conversation,
)
from repositories.app.agent_runtime_app import (
    create_backing_agent_for_app,
    ensure_workflow_agent_backing_app,
    resolve_agent_runtime_app,
)
from repositories.app.console_repository import ConsoleAppRepository, console_app_actor
from repositories.app.response import app_record
from repositories.resource_access_token_repository import ResourceAccessTokenCleanupRepository
from services.agent.errors import AgentNameConflictError, AgentNotFoundError
from services.agent.roster_service import AgentRosterService
from services.app.agent_app_contracts import (
    AgentApiAccess,
    AgentApiAccessChange,
    AgentAppAccessNotReadyError,
    AgentAppDetail,
    AgentAppListItem,
    AgentAppListPage,
    AgentAppNameConflictError,
    AgentAppNotFoundError,
    AgentReferencingWorkflow,
)
from services.app.agent_build_session_store import (
    AgentBuildAgentNotFoundError,
    AgentBuildApplied,
    AgentBuildApplyChangedError,
    AgentBuildApplySource,
    AgentBuildBindingUnavailableError,
    AgentBuildCheckout,
    AgentBuildDraft,
    AgentBuildDraftNotFoundError,
    AgentBuildHomeSnapshot,
    AgentBuildRefresh,
    AgentBuildSandbox,
)
from services.entities.app_entities import (
    AppCreationSettings,
    AppDeletion,
    AppListParams,
    AppRecord,
    AppUpdateArguments,
    CreateAppParams,
    UpdateAppParams,
)


class AgentAppRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def create_agent_app(
        self,
        context: RequestContext,
        params: CreateAppParams,
        settings: AppCreationSettings,
        *,
        default_model: tuple[str, str] | None,
    ) -> AppRecord:
        """Commit an Agent App and its backing Agent, snapshot, and Build conversation together.

        The caller supplies prepared settings and a resolved default model. None
        seeds an empty Soul. A roster name conflict rolls back all inserted rows.
        """
        if params.mode != AppMode.AGENT:
            raise ValueError("Agent App creation requires agent mode")

        tenant_id = context.active_workspace_id
        initial_soul = build_initial_agent_soul(tenant_id, default_model)
        with self._session_factory.begin() as session:
            account = console_app_actor(session, context)
            app = ConsoleAppRepository.insert_app_record(tenant_id, params, account, settings, session=session)
            try:
                create_backing_agent_for_app(
                    session,
                    tenant_id=tenant_id,
                    account_id=context.account_id,
                    app_id=app.id,
                    name=params.name,
                    description=params.description or "",
                    role=params.agent_role,
                    icon_type=AgentIconType(params.icon_type) if params.icon_type else None,
                    icon=params.icon,
                    icon_background=params.icon_background,
                    initial_soul=initial_soul,
                )
            except IntegrityError as exc:
                raise AgentAppNameConflictError from exc
            return app_record(app, session=session, projection="detail-with-site")

    def list_apps(
        self, context: RequestContext, params: AppListParams, *, accessible_agent_ids: set[str] | None
    ) -> AgentAppListPage:
        """Load an admitted account's Agent App page and commit its Build conversations together.

        A None visibility set leaves the App filters unrestricted by Agent id.
        The editor mapping's unique key prevents concurrent duplicate mappings.
        A write or projection failure rolls back the page's conversation changes.
        """
        tenant_id = context.active_workspace_id
        account_id = context.account_id
        with self._session_factory.begin() as session:
            scoped_params = params
            if accessible_agent_ids is not None:
                app_ids = self._load_app_ids_for_agents(
                    session, tenant_id=tenant_id, agent_ids=sorted(accessible_agent_ids)
                )
                scoped_params = params.model_copy(update={"accessible_app_ids": app_ids})
            counts = ConsoleAppRepository.get_agent_publication_counts(account_id, tenant_id, scoped_params, session)
            page = ConsoleAppRepository.get_paginate_apps(account_id, tenant_id, scoped_params, session)
            if page is None:
                return AgentAppListPage(
                    page=params.page, limit=params.limit, total=0, has_more=False, publication_counts=counts, data=[]
                )

            agents = self._load_app_backing_agents_by_app_id(
                session, tenant_id=tenant_id, app_ids=[app.id for app in page.items]
            )
            agent_ids = [agent.id for agent in agents.values()]
            references = load_published_references_by_agent_id(session, tenant_id=tenant_id, agent_ids=agent_ids)
            reference_counts = load_reference_counts_by_agent_id(session, tenant_id=tenant_id, agent_ids=agent_ids)
            items: list[AgentAppListItem] = []
            for app in page.items:
                agent = agents.get(app.id)
                backing_app_id = (agent.backing_app_id or app.id) if agent else None
                conversation_id = (
                    get_or_create_agent_debug_conversation(
                        session,
                        tenant_id=tenant_id,
                        agent_id=agent.id,
                        backing_app_id=backing_app_id,
                        account_id=account_id,
                        draft_type=AgentConfigDraftType.DEBUG_BUILD,
                    )
                    if agent and backing_app_id
                    else None
                )
                items.append(
                    AgentAppListItem(
                        app=replace(app_record(app, session=session), has_draft_trigger=app.has_draft_trigger),
                        agent_id=agent.id if agent else None,
                        backing_app_id=backing_app_id,
                        role=(agent.role or "") if agent else None,
                        debug_conversation_id=conversation_id,
                        active_config_is_published=bool(
                            agent and agent.active_config_snapshot_id and agent.active_config_is_published
                        ),
                        reference_count=reference_counts.get(agent.id, 0) if agent else None,
                        published_references=[
                            AgentReferencingWorkflow(
                                app_id=ref.app_id,
                                app_name=ref.app_name,
                                app_icon_type=ref.app_icon_type,
                                app_icon=ref.app_icon,
                                app_icon_background=ref.app_icon_background,
                                app_mode=ref.app_mode,
                                app_updated_at=ref.app_updated_at,
                                workflow_id=ref.workflow_id,
                                workflow_version=ref.workflow_version,
                                node_ids=list(ref.node_ids),
                            )
                            for ref in (references.get(agent.id, ()) if agent else ())
                        ],
                        permission_keys=[],
                    )
                )
            return AgentAppListPage(
                page=page.page,
                limit=page.per_page,
                total=page.total,
                has_more=page.has_next,
                publication_counts=counts,
                data=items,
            )

    @staticmethod
    def _load_app_backing_agents_by_app_id(session: Session, *, tenant_id: str, app_ids: list[str]) -> dict[str, Agent]:
        """Return active app-backed Agents keyed by Agent App id."""
        if not app_ids:
            return {}
        agents = session.scalars(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.app_id.in_(app_ids),
                Agent.scope == AgentScope.ROSTER,
                Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                Agent.status == AgentStatus.ACTIVE,
            )
        ).all()
        return {agent.app_id: agent for agent in agents if agent.app_id and agent.id}

    @staticmethod
    def _load_app_ids_for_agents(session: Session, *, tenant_id: str, agent_ids: Sequence[str]) -> list[str]:
        """Return active Agent App ids for the requested roster Agents."""
        if not agent_ids:
            return []
        app_ids = session.scalars(
            select(Agent.app_id).where(
                Agent.tenant_id == tenant_id,
                Agent.id.in_(agent_ids),
                Agent.app_id.is_not(None),
                Agent.scope == AgentScope.ROSTER,
                Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                Agent.status == AgentStatus.ACTIVE,
            )
        ).all()
        return sorted({str(app_id) for app_id in app_ids if app_id})

    def delete_agent(self, context: RequestContext, agent_id: str) -> AppDeletion:
        """Resolve and delete an active roster Agent App in one transaction."""
        with self._session_factory.begin() as session:
            app = self._resolve_roster_app(session, tenant_id=context.active_workspace_id, agent_id=agent_id)
            ResourceAccessTokenCleanupRepository(session=session).delete_resource_relations(
                tenant_id=context.active_workspace_id,
                resource_type=ResourceAccessTokenResourceType.APP,
                resource_id=app.id,
            )
            return ConsoleAppRepository.delete_app_record(app, account_id=context.account_id, session=session)

    def get_agent_detail(self, context: RequestContext, agent_id: str) -> AgentAppDetail:
        """Return the tenant Agent's detached detail, materializing a hidden runtime App if needed."""
        with self._session_factory() as session:
            app = resolve_agent_runtime_app(session, tenant_id=context.active_workspace_id, agent_id=agent_id)
            if app is None:
                raise AgentAppNotFoundError
            agent = session.scalar(
                select(Agent).where(
                    Agent.tenant_id == context.active_workspace_id,
                    Agent.id == agent_id,
                    Agent.status == AgentStatus.ACTIVE,
                )
            )
            if agent is None:
                raise AgentAppNotFoundError
            record = app_record(app, session=session, projection="detail-with-site")
            # The legacy response view detects old Agent configurations here,
            # including its existing mode update and commit.
            should_mask_agent_mode = bool(
                record.app_model_config is not None and app.is_agent_with_session(session=session)
            )
            return AgentAppDetail(
                app=record,
                agent_id=agent.id,
                app_id=agent.app_id,
                backing_app_id=agent.backing_app_id or agent.app_id,
                hidden_app_backed=bool(agent.backing_app_id and agent.backing_app_id != agent.app_id),
                role=agent.role or "",
                access_ready=agent_has_workflow_callable_active_snapshot(session=session, agent=agent),
                should_mask_agent_mode=should_mask_agent_mode,
            )

    def get_agent_build_conversation(self, context: RequestContext, agent_id: str, *, app_id: str) -> tuple[str, int]:
        """Commit the caller's Build conversation if the Agent still owns the same runtime App."""
        with self._session_factory.begin() as session:
            agent = session.scalar(
                select(Agent).where(
                    Agent.tenant_id == context.active_workspace_id,
                    Agent.id == agent_id,
                    Agent.status == AgentStatus.ACTIVE,
                )
            )
            if agent is None or (agent.backing_app_id or agent.app_id) != app_id:
                raise AgentAppNotFoundError
            backing_app_id = ensure_workflow_agent_backing_app(session, agent=agent, account_id=context.account_id)
            if backing_app_id is None:
                raise AgentAppNotFoundError
            conversation_id = get_or_create_agent_debug_conversation(
                session,
                tenant_id=context.active_workspace_id,
                agent_id=agent_id,
                backing_app_id=backing_app_id,
                account_id=context.account_id,
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
            )
            return conversation_id, count_agent_debug_conversation_messages(session, conversation_id=conversation_id)

    def refresh_build_conversation(self, *, tenant_id: str, agent_id: str, account_id: str) -> AgentBuildRefresh:
        """Replace the active Agent's account-owned conversation and retire its Build binding in one commit."""
        with self._session_factory.begin() as session:
            agent = session.scalar(
                select(Agent)
                .where(Agent.tenant_id == tenant_id, Agent.id == agent_id, Agent.status == AgentStatus.ACTIVE)
                .with_for_update()
            )
            if agent is None:
                raise AgentBuildAgentNotFoundError
            app_id = ensure_workflow_agent_backing_app(
                session, agent=agent, account_id=agent.updated_by or agent.created_by
            )
            if not app_id:
                raise AgentBuildAgentNotFoundError

            draft = find_agent_draft(
                session,
                tenant_id=tenant_id,
                agent_id=agent_id,
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                account_id=account_id,
                for_update=True,
            )
            retired_binding_id = None
            if draft is not None and draft.agent_workspace_binding_id is not None:
                retired_binding_id = self._retire_build_binding(session, draft, app_id=app_id, require_generation=False)
                draft.agent_workspace_binding_id = None

            conversation_id = create_agent_debug_conversation(session, app_id=app_id, account_id=account_id)
            mapping = session.scalar(
                select(AgentDebugConversation).where(
                    AgentDebugConversation.tenant_id == tenant_id,
                    AgentDebugConversation.agent_id == agent_id,
                    AgentDebugConversation.account_id == account_id,
                    AgentDebugConversation.draft_type == AgentConfigDraftType.DEBUG_BUILD,
                )
            )
            if mapping is None:
                session.add(
                    AgentDebugConversation(
                        tenant_id=tenant_id,
                        agent_id=agent_id,
                        app_id=app_id,
                        account_id=account_id,
                        draft_type=AgentConfigDraftType.DEBUG_BUILD,
                        conversation_id=conversation_id,
                    )
                )
            else:
                mapping.app_id = app_id
                mapping.conversation_id = conversation_id
            return AgentBuildRefresh(conversation_id=conversation_id, retired_binding_id=retired_binding_id)

    def get_build_draft(self, *, tenant_id: str, agent_id: str, account_id: str) -> AgentBuildDraft:
        """Return the existing account-owned draft and its stored Soul without creating or changing rows."""
        with self._session_factory() as session:
            draft = find_agent_draft(
                session,
                tenant_id=tenant_id,
                agent_id=agent_id,
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                account_id=account_id,
            )
            if draft is None:
                raise AgentBuildDraftNotFoundError
            return self._build_draft_record(draft)

    @staticmethod
    def _build_draft_record(draft: AgentConfigDraft) -> AgentBuildDraft:
        """Detach the draft metadata and stored Soul while the caller owns the session."""
        return AgentBuildDraft(summary=project_agent_draft_summary(draft), agent_soul=draft.config_snapshot_dict)

    @staticmethod
    def _require_build_agent(session: Session, *, tenant_id: str, agent_id: str, for_update: bool) -> Agent:
        """Load the tenant's Agent, optionally taking the parent lock used by draft writers."""
        stmt = select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id)
        if for_update:
            stmt = stmt.with_for_update()
        agent = session.scalar(stmt)
        if agent is None:
            raise AgentBuildAgentNotFoundError
        return agent

    def save_build_draft(
        self, *, tenant_id: str, agent_id: str, account_id: str, agent_soul: dict[str, object]
    ) -> AgentBuildDraft:
        """Persist a validated personal Soul, preserving omitted file references under the draft lock."""
        soul = AgentSoulConfig.model_validate(agent_soul)
        with self._session_factory.begin() as session:
            agent = self._require_build_agent(session, tenant_id=tenant_id, agent_id=agent_id, for_update=False)
            draft = save_agent_draft(
                session=session,
                tenant_id=tenant_id,
                agent=agent,
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                account_id=account_id,
                agent_soul=soul,
                account_id_for_audit=account_id,
            )
            return self._build_draft_record(draft)

    def checkout_build_draft(
        self, *, tenant_id: str, agent_id: str, account_id: str, force: bool
    ) -> AgentBuildCheckout:
        """Copy the shared draft into the caller's draft and retire a replaced binding in the same transaction."""
        with self._session_factory.begin() as session:
            agent = self._require_build_agent(session, tenant_id=tenant_id, agent_id=agent_id, for_update=False)
            shared = get_or_create_agent_draft(
                session=session,
                tenant_id=tenant_id,
                agent=agent,
                draft_type=AgentConfigDraftType.DRAFT,
                account_id=None,
                created_by=account_id,
            )
            draft = find_agent_draft(
                session,
                tenant_id=tenant_id,
                agent_id=agent_id,
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                account_id=account_id,
                for_update=True,
            )
            if draft is not None and not force:
                return AgentBuildCheckout(self._build_draft_record(draft), None)

            retired = None
            if draft is not None and draft.agent_workspace_binding_id is not None:
                retired = self._retire_build_binding(
                    session, draft, app_id=agent.backing_app_id or agent.app_id, require_generation=True
                )
                draft.agent_workspace_binding_id = None

            soul = AgentSoulConfig.model_validate(shared.config_snapshot_dict)
            if draft is None:
                draft = AgentConfigDraft(
                    tenant_id=tenant_id,
                    agent_id=agent_id,
                    draft_type=AgentConfigDraftType.DEBUG_BUILD,
                    account_id=account_id,
                    draft_owner_key=account_id,
                    created_by=account_id,
                    config_snapshot=soul,
                )
                session.add(draft)
            else:
                draft.config_snapshot = soul
            draft.base_snapshot_id = shared.base_snapshot_id
            draft.home_snapshot_id = shared.home_snapshot_id
            draft.updated_by = account_id
            session.flush()
            return AgentBuildCheckout(self._build_draft_record(draft), retired)

    def prepare_build_apply(self, *, tenant_id: str, agent_id: str, account_id: str) -> AgentBuildApplySource:
        """Materialize the caller's draft and its exact Sandbox before returning the read connection."""
        with self._session_factory() as session:
            agent, draft = self._require_build_apply_draft(
                session, tenant_id=tenant_id, agent_id=agent_id, account_id=account_id, for_update=False
            )
            return self._build_apply_source(session, agent=agent, draft=draft, for_update=False)

    def _require_build_apply_draft(
        self, session: Session, *, tenant_id: str, agent_id: str, account_id: str, for_update: bool
    ) -> tuple[Agent, AgentConfigDraft]:
        """Return the account's Build draft with its Agent, locking the parent first when writing."""
        agent = self._require_build_agent(session, tenant_id=tenant_id, agent_id=agent_id, for_update=for_update)
        draft = find_agent_draft(
            session,
            tenant_id=tenant_id,
            agent_id=agent_id,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id=account_id,
            for_update=for_update,
        )
        if draft is None:
            raise AgentBuildDraftNotFoundError
        return agent, draft

    def _build_apply_source(
        self, session: Session, *, agent: Agent, draft: AgentConfigDraft, for_update: bool
    ) -> AgentBuildApplySource:
        """Detach the loaded draft's checkpoint source, with no Sandbox if unavailable."""
        sandbox = None
        try:
            binding = self._get_build_binding(
                session,
                draft,
                app_id=agent.backing_app_id or agent.app_id,
                require_generation=True,
                for_update=for_update,
            )
        except AgentBuildBindingUnavailableError:
            # Apply validates the Soul before reporting a missing Sandbox, as the legacy flow did.
            pass
        else:
            sandbox = AgentBuildSandbox(binding.id, binding.workspace_id, binding.app_id, binding.backend_binding_ref)
        return AgentBuildApplySource(
            draft.id, draft.base_snapshot_id, draft.home_snapshot_id, draft.config_snapshot_dict, sandbox
        )

    def commit_build_apply(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        source: AgentBuildApplySource,
        snapshot: AgentBuildHomeSnapshot | None,
    ) -> AgentBuildApplied:
        """Commit the shared draft, checkpoint ledger and retirements only while the prepared Build state matches."""
        with self._session_factory.begin() as session:
            try:
                agent, draft = self._require_build_apply_draft(
                    session, tenant_id=tenant_id, agent_id=agent_id, account_id=account_id, for_update=True
                )
            except (AgentBuildAgentNotFoundError, AgentBuildDraftNotFoundError) as exc:
                raise AgentBuildApplyChangedError from exc
            current = self._build_apply_source(session, agent=agent, draft=draft, for_update=True)
            if current != source or current.sandbox is None:
                raise AgentBuildApplyChangedError

            soul = AgentSoulConfig.model_validate(source.agent_soul)
            shared = save_agent_draft(
                session=session,
                tenant_id=tenant_id,
                agent=agent,
                draft_type=AgentConfigDraftType.DRAFT,
                account_id=None,
                agent_soul=soul,
                account_id_for_audit=account_id,
                base_snapshot_id=source.base_snapshot_id,
            )
            retired = self._retire_preview_bindings(session, agent=agent, draft=shared)
            workspaces = AgentWorkspaceRepository(session=session)
            binding_id = workspaces.retire_binding(tenant_id=tenant_id, binding_id=current.sandbox.binding_id)
            if binding_id is None:
                raise AgentBuildApplyChangedError
            if snapshot is not None:
                session.add(
                    AgentHomeSnapshot(id=snapshot.id, tenant_id=tenant_id, agent_id=agent_id, snapshot_ref=snapshot.ref)
                )
            shared.home_snapshot_id = snapshot.id if snapshot is not None else None
            agent.active_config_is_published = agent_soul_matches_active_config(
                session=session,
                tenant_id=tenant_id,
                agent=agent,
                agent_soul=soul,
                home_snapshot_id=shared.home_snapshot_id,
            )
            agent.updated_by = account_id
            session.delete(draft)
            session.flush()
            return AgentBuildApplied(project_agent_draft_summary(shared), (*retired, binding_id))

    @staticmethod
    def _retire_preview_bindings(session: Session, *, agent: Agent, draft: AgentConfigDraft) -> list[str]:
        """Retire participants for the old shared Home and clear their pointers in the apply transaction."""
        conversations = (
            session.scalars(
                select(Conversation)
                .join(
                    AgentDebugConversation,
                    (AgentDebugConversation.conversation_id == Conversation.id)
                    & (AgentDebugConversation.app_id == Conversation.app_id),
                )
                .where(
                    AgentDebugConversation.tenant_id == agent.tenant_id,
                    AgentDebugConversation.agent_id == agent.id,
                    AgentDebugConversation.draft_type == AgentConfigDraftType.DRAFT,
                    Conversation.is_deleted.is_(False),
                    Conversation.agent_workspace_binding_id.is_not(None),
                )
            )
            .unique()
            .all()
        )
        workspaces = AgentWorkspaceRepository(session=session)
        retired: list[str] = []
        for conversation in conversations:
            binding_id = conversation.agent_workspace_binding_id
            if binding_id is not None:
                binding = workspaces.get_active_binding(
                    tenant_id=agent.tenant_id,
                    binding_id=binding_id,
                    expected_owner_scope=WorkspaceOwnerScope(
                        tenant_id=agent.tenant_id,
                        app_id=conversation.app_id,
                        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
                        owner_id=conversation.id,
                    ),
                    for_update=True,
                )
                if binding is None or binding.agent_id != agent.id:
                    raise AgentBuildBindingUnavailableError
                try:
                    validate_binding_generation(
                        binding,
                        base_home_snapshot_id=draft.home_snapshot_id,
                        agent_config_version_id=draft.id,
                        agent_config_version_kind=AgentConfigVersionKind.DRAFT,
                    )
                except AgentWorkspaceBindingGenerationMismatchError as exc:
                    raise AgentBuildBindingUnavailableError from exc
                if workspaces.retire_binding(tenant_id=agent.tenant_id, binding_id=binding_id) is None:
                    raise AgentBuildBindingUnavailableError
                conversation.agent_workspace_binding_id = None
                retired.append(binding_id)
        return retired

    def discard_build_draft(self, *, tenant_id: str, agent_id: str, account_id: str) -> str | None:
        """Discard only this account's draft. An existing Agent with no such draft is a no-op."""
        with self._session_factory.begin() as session:
            # Preserve the legacy discard behavior for archived Agents.
            agent = session.scalar(
                select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id).with_for_update()
            )
            if agent is None:
                raise AgentBuildAgentNotFoundError
            draft = find_agent_draft(
                session,
                tenant_id=tenant_id,
                agent_id=agent_id,
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                account_id=account_id,
                for_update=True,
            )
            if draft is None:
                return None
            retired_binding_id = None
            if draft.agent_workspace_binding_id is not None:
                retired_binding_id = self._retire_build_binding(
                    session, draft, app_id=agent.backing_app_id or agent.app_id, require_generation=True
                )
            session.delete(draft)
            return retired_binding_id

    @staticmethod
    def _retire_build_binding(
        session: Session, draft: AgentConfigDraft, *, app_id: str | None, require_generation: bool
    ) -> str:
        """Stage retirement of the exact draft-owned binding, failing if it cannot be retired.

        Discard requires a matching generation and reports a mismatch as an
        unavailable binding. Refresh can reset an owned binding from an older
        generation.
        """
        binding = AgentAppRepository._get_build_binding(
            session, draft, app_id=app_id, require_generation=require_generation, for_update=True
        )
        retired_binding_id = AgentWorkspaceRepository(session=session).retire_binding(
            tenant_id=draft.tenant_id, binding_id=binding.id
        )
        if retired_binding_id is None:
            raise AgentBuildBindingUnavailableError
        return retired_binding_id

    @staticmethod
    def _get_build_binding(
        session: Session,
        draft: AgentConfigDraft,
        *,
        app_id: str | None,
        require_generation: bool,
        for_update: bool,
    ) -> AgentWorkspaceBinding:
        """Require the draft's active binding in the exact owner scope and, when requested, generation."""
        binding_id = draft.agent_workspace_binding_id
        if binding_id is None or app_id is None:
            raise AgentBuildBindingUnavailableError
        workspaces = AgentWorkspaceRepository(session=session)
        binding = workspaces.get_active_binding(
            tenant_id=draft.tenant_id,
            binding_id=binding_id,
            expected_owner_scope=WorkspaceOwnerScope(
                tenant_id=draft.tenant_id,
                app_id=app_id,
                owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
                owner_id=draft.id,
            ),
            for_update=for_update,
        )
        if binding is None or binding.agent_id != draft.agent_id:
            raise AgentBuildBindingUnavailableError
        if require_generation:
            try:
                validate_binding_generation(
                    binding,
                    base_home_snapshot_id=draft.home_snapshot_id,
                    agent_config_version_id=draft.id,
                    agent_config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
                )
            except AgentWorkspaceBindingGenerationMismatchError as exc:
                raise AgentBuildBindingUnavailableError from exc
        return binding

    def update_agent(self, context: RequestContext, agent_id: str, params: UpdateAppParams) -> str:
        """Commit updates for the tenant's active roster Agent App and return its id."""
        with self._session_factory() as session:
            app = self._resolve_roster_app(session, tenant_id=context.active_workspace_id, agent_id=agent_id)
            args: AppUpdateArguments = {
                "name": params.name,
                "description": params.description,
                "icon_type": params.icon_type,
                "icon": params.icon,
                "icon_background": params.icon_background,
                "use_icon_as_answer_icon": params.use_icon_as_answer_icon,
                "max_active_requests": params.max_active_requests,
                "role": params.role,
            }
            try:
                return ConsoleAppRepository.update_app(app, args, account_id=context.account_id, session=session).id
            except AgentNameConflictError as exc:
                raise AgentAppNameConflictError from exc

    @staticmethod
    def _resolve_roster_app(session: Session, *, tenant_id: str, agent_id: str) -> App:
        """Resolve only an active, app-backed roster Agent in the given tenant."""
        app = get_roster_agent_app(session, tenant_id=tenant_id, agent_id=agent_id)
        if app is None:
            raise AgentAppNotFoundError
        return app

    @staticmethod
    def _api_access(session: Session, app: App) -> AgentApiAccess:
        """Materialize access state while the app and publication data are available."""
        agent = get_app_backing_agent(session, tenant_id=app.tenant_id, app_id=app.id)
        ready = bool(agent and agent_has_workflow_callable_active_snapshot(session=session, agent=agent))
        count = session.scalar(
            select(func.count(ApiToken.id)).where(
                or_(ApiToken.tenant_id == app.tenant_id, ApiToken.tenant_id.is_(None)),
                ApiToken.type == ApiTokenType.APP,
                ApiToken.app_id == app.id,
            )
        )
        return AgentApiAccess(
            app_id=app.id,
            access_ready=ready,
            enabled=bool(app.enable_api and ready),
            api_rpm=app.api_rpm or 0,
            api_rph=app.api_rph or 0,
            api_key_count=count or 0,
        )

    def get_api_access(self, *, tenant_id: str, agent_id: str) -> AgentApiAccess:
        """Return detached access state for an active Agent App in the tenant."""
        with self._session_factory() as session:
            app = self._resolve_roster_app(session, tenant_id=tenant_id, agent_id=agent_id)
            return self._api_access(session, app)

    def set_api_access(self, *, tenant_id: str, agent_id: str, account_id: str, enabled: bool) -> AgentApiAccessChange:
        """Commit access state in one transaction; an unpublished Agent cannot be enabled."""
        with self._session_factory.begin() as session:
            app = self._resolve_roster_app(session, tenant_id=tenant_id, agent_id=agent_id)
            access = self._api_access(session, app)
            if enabled and not access.access_ready:
                raise AgentAppAccessNotReadyError
            changed = app.enable_api != enabled
            if changed:
                app.enable_api = enabled
                app.updated_by = account_id
                app.updated_at = naive_utc_now()
            return AgentApiAccessChange(
                access=replace(access, enabled=bool(enabled and access.access_ready)), changed=changed
            )

    def resolve_roster_app_id(self, *, tenant_id: str, agent_id: str) -> str:
        """Resolve a roster Agent's configuration owner without materializing inline Apps."""
        with self._session_factory() as session:
            return self._resolve_roster_app(session, tenant_id=tenant_id, agent_id=agent_id).id

    def resolve_runtime_app_id(self, *, tenant_id: str, agent_id: str) -> str:
        with self._session_factory() as session:
            try:
                return (
                    AgentRosterService(session).get_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id).id
                )
            except AgentNotFoundError as exc:
                raise AgentAppNotFoundError from exc

    def resolve_existing_runtime_app_id(self, *, tenant_id: str, agent_id: str) -> str:
        """Read persisted runtime state without creating a hidden app during a GET."""
        with self._session_factory() as session:
            try:
                return (
                    AgentRosterService(session)
                    .get_existing_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id)
                    .id
                )
            except AgentNotFoundError as exc:
                raise AgentAppNotFoundError from exc

    def list_referencing_workflows(self, *, tenant_id: str, agent_id: str) -> list[AgentReferencingWorkflow]:
        with self._session_factory() as session:
            roster = AgentRosterService(session)
            try:
                app = roster.get_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
            except AgentNotFoundError as exc:
                raise AgentAppNotFoundError from exc
            return roster.list_workflows_referencing_app_agent(tenant_id=tenant_id, app_id=app.id)

    def update_features(self, *, tenant_id: str, app_id: str, account_id: str, config: dict[str, Any]) -> None:
        """Commit the feature version, app pointer and dataset joins together."""
        with self._session_factory.begin() as session:
            app = session.scalar(
                select(App).where(
                    App.id == app_id,
                    App.tenant_id == tenant_id,
                    App.mode == AppMode.AGENT,
                    App.status == AppStatus.NORMAL,
                )
            )
            if app is None:
                raise AgentAppNotFoundError
            new_config = AppModelConfig(
                app_id=app.id, created_by=account_id, updated_by=account_id
            ).from_model_config_dict(cast(AppModelConfigDict, config))
            session.add(new_config)
            session.flush()
            app.app_model_config_id = new_config.id
            app.updated_by = account_id
            app.updated_at = naive_utc_now()
            app_model_config_was_updated.send(app, app_model_config=new_config, session=session)
