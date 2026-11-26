"""Agent App persistence, reusing the roster's canonical app and reference queries."""

from collections.abc import Sequence
from dataclasses import replace
from typing import Any, Protocol, cast
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from constants.resource_access_token import ResourceAccessTokenResourceType
from core.agent.publish_visibility import agent_has_workflow_callable_active_snapshot
from core.agent.workspace import AgentWorkspaceBindingGenerationMismatchError, WorkspaceOwnerScope
from core.dify_builder.naming import resolve_creation_name
from events.app_event import app_model_config_was_updated
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import filter_uuid_strings
from machinery.context import RequestContext
from models.agent import (
    APP_BACKED_AGENT_SOURCES,
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevisionOperation,
    AgentConfigVersionKind,
    AgentDebugConversation,
    AgentHomeSnapshot,
    AgentIconType,
    AgentScope,
    AgentStatus,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.agent_soul_state import agent_soul_has_model, build_initial_agent_soul
from models.dataset import Dataset
from models.enums import ApiTokenType, AppStatus, MessageStatus
from models.model import ApiToken, App, AppMode, AppModelConfig, AppModelConfigDict, Conversation, Message
from models.workflow import Workflow
from repositories.agent.agent_app_composer_queries import (
    composer_snapshot,
    publication_source,
    read_composer_state,
    require_composer_agent,
)
from repositories.agent.agent_app_queries import get_app_backing_agent, get_roster_agent_app
from repositories.agent.agent_debug_conversations import (
    count_agent_debug_conversation_messages,
    create_agent_debug_conversation,
    get_or_create_agent_debug_conversation,
)
from repositories.agent.agent_drafts import (
    agent_soul_matches_active_config,
    create_composer_snapshot,
    find_agent_snapshot,
    get_or_create_agent_draft,
    save_agent_draft,
)
from repositories.agent.agent_roster_queries import (
    find_agent_draft,
    load_published_workflows_by_agent_id,
    load_reference_counts_by_agent_id,
    project_agent_draft_summary,
    project_referencing_workflow,
)
from repositories.agent.agent_runtime_app import (
    create_backing_agent_for_app,
    ensure_workflow_agent_backing_app,
    find_existing_agent_runtime_app,
    resolve_agent_runtime_app,
)
from repositories.agent.agent_skill_bindings import copy_agent_bindings, publish_agent_bindings
from repositories.agent.agent_workspace_repository import (
    AgentWorkspaceRepository,
    has_owned_home_snapshot,
    validate_binding_generation,
)
from repositories.app.console_repository import (
    ConsoleAppRepository,
    StageTargetEvaluationCleanup,
    console_app_actor,
    find_console_app,
)
from repositories.app.response import app_record
from repositories.resource_access_token_repository import ResourceAccessTokenCleanupRepository
from repositories.tag_repository import TagRepository
from services.agent.agent_app_contracts import (
    AgentApiAccess,
    AgentApiAccessChange,
    AgentAppAccessNotReadyError,
    AgentAppCopied,
    AgentAppCopy,
    AgentAppDetail,
    AgentAppListItem,
    AgentAppListPage,
    AgentAppNameConflictError,
    AgentAppNotFoundError,
    AgentReferencingWorkflow,
)
from services.agent.agent_config_contracts import (
    AgentConfigNodeUnboundError,
    AgentConfigRuntimeMissingError,
    AgentConfigSelection,
    AgentConfigVersionMissingError,
    AgentConfigWorkflowMissingError,
)
from services.agent.agent_config_contracts import (
    AgentConfigVersionKind as ConfigSelectionKind,
)
from services.agent.app_composer_store import (
    AgentComposerAgentMissingError,
    AgentComposerCandidateSource,
    AgentComposerDatasetLabel,
    AgentComposerSnapshotMissingError,
    AgentComposerState,
    AgentPublication,
    AgentPublicationChangedError,
    AgentPublicationHomeUnavailableError,
    AgentPublicationKind,
    AgentPublicationSource,
)
from services.agent.build_session_store import (
    AgentBuildAgentNotFoundError,
    AgentBuildApplied,
    AgentBuildApplyChangedError,
    AgentBuildApplyRolledBackError,
    AgentBuildApplySource,
    AgentBuildBaseUnavailableError,
    AgentBuildBindingUnavailableError,
    AgentBuildCheckout,
    AgentBuildDraft,
    AgentBuildDraftNotFoundError,
    AgentBuildHomeSnapshot,
    AgentBuildRefresh,
    AgentBuildSandbox,
)
from services.agent.errors import AgentNameConflictError
from services.app_audio_service import AgentTextToSpeechSource
from services.audio_types import AudioAppRef
from services.entities.app_entities import (
    AppCreationSettings,
    AppDeletion,
    AppListParams,
    AppRecord,
    AppUpdateArguments,
    CreateAppParams,
    UpdateAppParams,
)


class StageAgentPublicationBindings(Protocol):
    def __call__(
        self, session: Session, *, tenant_id: str, account_id: str, app_id: str, control_space_ids: list[str]
    ) -> None:
        """Stage previously authorized KnowledgeFS bindings in the same publication transaction."""
        ...


class AgentAppRepository:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        stage_evaluation_cleanup: StageTargetEvaluationCleanup,
        stage_publication_bindings: StageAgentPublicationBindings | None = None,
    ) -> None:
        """Bind the session factory and the transaction participants for deletion and publication."""
        self._session_factory = session_factory
        self._stage_evaluation_cleanup = stage_evaluation_cleanup
        self._stage_publication_bindings = stage_publication_bindings

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
            name = resolve_creation_name(
                name=params.name,
                prompt=params.prompt,
                timezone=account.timezone,
                language=account.interface_language,
            )
            app = ConsoleAppRepository.insert_app_record(
                tenant_id, params, account, settings, name=name, session=session
            )
            try:
                create_backing_agent_for_app(
                    session,
                    tenant_id=tenant_id,
                    account_id=context.account_id,
                    app_id=app.id,
                    name=name,
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

    def copy_agent_app(
        self, context: RequestContext, agent_id: str, overrides: AgentAppCopy, settings: AppCreationSettings
    ) -> AgentAppCopied:
        """Commit the new private App, copied Soul, feature config and skill bindings together."""
        tenant_id = context.active_workspace_id
        account_id = context.account_id
        with self._session_factory.begin() as session:
            account = console_app_actor(session, context)
            source_app = get_roster_agent_app(session, tenant_id=tenant_id, agent_id=agent_id)
            if source_app is None:
                raise AgentAppNotFoundError
            source_agent = get_app_backing_agent(session, tenant_id=tenant_id, app_id=source_app.id)
            if source_agent is None:
                raise AgentAppNotFoundError
            source = find_agent_snapshot(
                session=session,
                tenant_id=tenant_id,
                agent_id=source_agent.id,
                version_id=source_agent.active_config_snapshot_id,
            )
            if source is None:
                raise AgentComposerSnapshotMissingError

            params = CreateAppParams(
                name=overrides.name or self._copy_name(session, tenant_id=tenant_id, base_name=source_app.name),
                description=source_app.description if overrides.description is None else overrides.description,
                mode="agent",
                agent_role=(source_agent.role or "") if overrides.role is None else overrides.role,
                icon_type=source_app.icon_type if overrides.icon_type is None else overrides.icon_type,
                icon=source_app.icon if overrides.icon is None else overrides.icon,
                icon_background=source_app.icon_background
                if overrides.icon_background is None
                else overrides.icon_background,
                api_rph=source_app.api_rph or 0,
                api_rpm=source_app.api_rpm or 0,
                max_active_requests=source_app.max_active_requests,
            )
            target_app = ConsoleAppRepository.insert_app_record(tenant_id, params, account, settings, session=session)
            target_app.enable_site = False
            target_app.enable_api = False
            target_app.use_icon_as_answer_icon = source_app.use_icon_as_answer_icon
            target_app.tracing = source_app.tracing
            try:
                target_agent = create_backing_agent_for_app(
                    session,
                    tenant_id=tenant_id,
                    account_id=account_id,
                    app_id=target_app.id,
                    name=params.name,
                    description=params.description or "",
                    role=params.agent_role,
                    icon_type=AgentIconType(params.icon_type) if params.icon_type else None,
                    icon=params.icon,
                    icon_background=params.icon_background,
                    initial_soul=AgentSoulConfig.model_validate(source.config_snapshot_dict),
                )
            except IntegrityError as exc:
                raise AgentAppNameConflictError from exc
            target_snapshot = find_agent_snapshot(
                session=session,
                tenant_id=tenant_id,
                agent_id=target_agent.id,
                version_id=target_agent.active_config_snapshot_id,
            )
            if target_snapshot is None:
                raise AgentComposerSnapshotMissingError
            target_snapshot.summary = source.summary
            target_snapshot.version_note = source.version_note
            self._copy_model_config(session, source=source_app, target=target_app, account_id=account_id)
            copy_agent_bindings(
                session,
                tenant_id=tenant_id,
                source_agent_id=source_agent.id,
                source_snapshot_id=source.id,
                target_agent_id=target_agent.id,
                user_id=account_id,
                source_include_draft=not source_agent.active_config_is_published,
            )
            return AgentAppCopied(app_record(target_app, session=session, projection="detail-with-site"), source_app.id)

    @staticmethod
    def _copy_name(session: Session, *, tenant_id: str, base_name: str) -> str:
        """Choose the first unused legacy copy name, within the Agent name limit."""
        suffixes = [" copy", *(f" copy {index}" for index in range(2, 100))]
        candidates = [base_name[: 255 - len(suffix)] + suffix for suffix in suffixes]
        existing = set(
            session.scalars(
                select(Agent.name).where(
                    Agent.tenant_id == tenant_id,
                    Agent.scope == AgentScope.ROSTER,
                    Agent.status == AgentStatus.ACTIVE,
                    Agent.name.in_(candidates),
                )
            )
        )
        return next(
            (name for name in candidates if name not in existing),
            f"{base_name[:245]} copy {int(naive_utc_now().timestamp())}",
        )

    @staticmethod
    def _copy_model_config(session: Session, *, source: App, target: App, account_id: str) -> None:
        """Copy Agent presentation settings while keeping target identity and audit columns."""
        source_config = source.app_model_config_with_session(session=session)
        target_config = target.app_model_config_with_session(session=session)
        if source_config is None or target_config is None:
            return
        target_config.opening_statement = source_config.opening_statement
        target_config.suggested_questions = source_config.suggested_questions
        target_config.suggested_questions_after_answer = source_config.suggested_questions_after_answer
        target_config.speech_to_text = source_config.speech_to_text
        target_config.text_to_speech = source_config.text_to_speech
        target_config.more_like_this = source_config.more_like_this
        target_config.model = source_config.model
        target_config.user_input_form = source_config.user_input_form
        target_config.dataset_query_variable = source_config.dataset_query_variable
        target_config.pre_prompt = source_config.pre_prompt
        target_config.agent_mode = source_config.agent_mode
        target_config.sensitive_word_avoidance = source_config.sensitive_word_avoidance
        target_config.retriever_resource = source_config.retriever_resource
        target_config.prompt_type = source_config.prompt_type
        target_config.chat_prompt_config = source_config.chat_prompt_config
        target_config.completion_prompt_config = source_config.completion_prompt_config
        target_config.dataset_configs = source_config.dataset_configs
        target_config.external_data_tools = source_config.external_data_tools
        target_config.file_upload = source_config.file_upload
        target_config.updated_by = account_id

    def list_apps(
        self, context: RequestContext, params: AppListParams, *, accessible_agent_ids: set[str] | None
    ) -> AgentAppListPage:
        """Load an admitted account's Agent App page and commit its Build conversations together.

        Preconditions: params contains validated filters for the admitted workspace.
        Postconditions: tags, totals and publication counts reflect the same Agent
        tag filters; Studio tags never appear on Agent cards. A None visibility
        set leaves the App filters unrestricted by Agent id.
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
            tags = TagRepository.load_tags_for_targets(
                session, tenant_id=tenant_id, tag_type="agent", target_ids=agent_ids
            )
            references = load_published_workflows_by_agent_id(session, tenant_id=tenant_id, agent_ids=agent_ids)
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
                        app=replace(
                            app_record(app, session=session),
                            has_draft_trigger=app.has_draft_trigger,
                            tags=tags.get(agent.id, []) if agent else [],
                        ),
                        agent_id=agent.id if agent else None,
                        backing_app_id=backing_app_id,
                        role=(agent.role or "") if agent else None,
                        debug_conversation_id=conversation_id,
                        active_config_is_published=bool(
                            agent and agent.active_config_snapshot_id and agent.active_config_is_published
                        ),
                        reference_count=reference_counts.get(agent.id, 0) if agent else None,
                        published_references=[
                            project_referencing_workflow(reference)
                            for reference in (references.get(agent.id, ()) if agent else ())
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
            return ConsoleAppRepository.delete_app_record(
                app,
                account_id=context.account_id,
                session=session,
                stage_evaluation_cleanup=self._stage_evaluation_cleanup,
            )

    def get_agent_detail(self, context: RequestContext, agent_id: str) -> AgentAppDetail:
        """Return an admitted Agent's detached detail and its independent Agent tags.

        Preconditions: context is admitted to the active workspace and agent_id
        passed Agent visibility checks. Postconditions: the runtime App is
        materialized when needed, tags use the canonical Agent identity rather
        than Studio App bindings, and missing or foreign Agents raise
        AgentAppNotFoundError without returning another workspace's metadata.
        """
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
            tags = TagRepository.load_tags_for_targets(
                session, tenant_id=context.active_workspace_id, tag_type="agent", target_ids=[agent.id]
            )
            record = replace(
                app_record(app, session=session, projection="detail-with-site"), tags=tags.get(agent.id, [])
            )
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

    def resolve_config_selection(
        self, context: RequestContext, agent_id: str, *, version_id: str | None, build: bool, for_write: bool
    ) -> AgentConfigSelection:
        """Select the eligible Agent's config and prepare a normal draft for asset writes.

        Runtime App resolution may also create and commit a missing hidden
        backing App for a workflow-only Agent, including on reads.
        """
        tenant_id = context.active_workspace_id
        with self._session_factory() as session:
            if resolve_agent_runtime_app(session, tenant_id=tenant_id, agent_id=agent_id) is None:
                raise AgentConfigRuntimeMissingError
            return self._config_selection(
                session, context, agent_id, version_id=version_id, build=build, for_write=for_write
            )

    def resolve_workflow_config_selection(
        self,
        context: RequestContext,
        app_id: str,
        *,
        node_id: str | None,
        version_id: str | None,
        build: bool,
        for_write: bool,
    ) -> AgentConfigSelection:
        """Resolve a draft node's Agent without creating a runtime App or editing its active snapshot."""
        tenant_id = context.active_workspace_id
        with self._session_factory() as session:
            app = find_console_app(session, workspace_id=tenant_id, app_id=app_id)
            if app is None:
                raise AgentConfigWorkflowMissingError
            if AppMode.value_of(app.mode) not in {AppMode.WORKFLOW, AppMode.ADVANCED_CHAT}:
                raise AgentConfigWorkflowMissingError(
                    "App mode is not in the supported list: {'workflow', 'advanced-chat'}"
                )
            if node_id:
                agent_id = session.scalar(
                    select(WorkflowAgentNodeBinding.agent_id)
                    .join(Workflow, Workflow.id == WorkflowAgentNodeBinding.workflow_id)
                    .where(
                        Workflow.tenant_id == tenant_id,
                        Workflow.app_id == app_id,
                        Workflow.version == Workflow.VERSION_DRAFT,
                        WorkflowAgentNodeBinding.tenant_id == tenant_id,
                        WorkflowAgentNodeBinding.workflow_version == Workflow.VERSION_DRAFT,
                        WorkflowAgentNodeBinding.node_id == node_id,
                    )
                    .limit(1)
                )
            else:
                agent_id = app.bound_agent_id_with_session(session=session)
            if not agent_id:
                raise AgentConfigNodeUnboundError
            return self._config_selection(
                session, context, agent_id, version_id=version_id, build=build, for_write=for_write
            )

    @staticmethod
    def _config_selection(
        session: Session,
        context: RequestContext,
        agent_id: str,
        *,
        version_id: str | None,
        build: bool,
        for_write: bool,
    ) -> AgentConfigSelection:
        """Resolve shared, private Build, or immutable config and commit explicit draft preparation."""
        tenant_id = context.active_workspace_id
        account_id = context.account_id
        if version_id:
            return AgentConfigSelection(tenant_id, agent_id, account_id, version_id, ConfigSelectionKind.SNAPSHOT)
        try:
            if build:
                draft = find_agent_draft(
                    session,
                    tenant_id=tenant_id,
                    agent_id=agent_id,
                    draft_type=AgentConfigDraftType.DEBUG_BUILD,
                    account_id=account_id,
                )
                if draft is None:
                    raise AgentConfigVersionMissingError
                return AgentConfigSelection(tenant_id, agent_id, account_id, draft.id, ConfigSelectionKind.BUILD_DRAFT)
            agent = require_composer_agent(session, tenant_id=tenant_id, agent_id=agent_id)
            if for_write:
                draft = get_or_create_agent_draft(
                    session=session,
                    tenant_id=tenant_id,
                    agent=agent,
                    draft_type=AgentConfigDraftType.DRAFT,
                    account_id=None,
                    created_by=account_id,
                )
                draft_id = draft.id
                session.commit()
                return AgentConfigSelection(tenant_id, agent_id, account_id, draft_id, ConfigSelectionKind.DRAFT)
            state = read_composer_state(session, agent=agent)
        except (AgentComposerAgentMissingError, AgentBuildAgentNotFoundError) as exc:
            raise AgentConfigRuntimeMissingError from exc
        except (AgentComposerSnapshotMissingError, AgentBuildBaseUnavailableError) as exc:
            raise AgentConfigVersionMissingError from exc
        snapshot = state.active_config_snapshot
        draft_summary = state.draft
        stale_inline = (
            agent.scope == AgentScope.WORKFLOW_ONLY
            and snapshot is not None
            and draft_summary is not None
            and draft_summary.base_snapshot_id != snapshot.id
        )
        if draft_summary is not None and not stale_inline:
            return AgentConfigSelection(tenant_id, agent_id, account_id, draft_summary.id, ConfigSelectionKind.DRAFT)
        if snapshot is None:
            raise AgentConfigVersionMissingError
        return AgentConfigSelection(tenant_id, agent_id, account_id, snapshot.id, ConfigSelectionKind.SNAPSHOT)

    def get_composer(self, *, tenant_id: str, agent_id: str) -> AgentComposerState:
        """Return the tenant's Agent configuration without writing a draft."""
        with self._session_factory() as session:
            agent = require_composer_agent(session, tenant_id=tenant_id, agent_id=agent_id)
            return read_composer_state(session, agent=agent)

    def save_composer(
        self, *, tenant_id: str, agent_id: str, account_id: str, soul: AgentSoulConfig
    ) -> AgentComposerState:
        """Save the normal draft and recalculate the publish flag in one transaction."""
        try:
            with self._session_factory.begin() as session, session.no_autoflush:
                agent = require_composer_agent(session, tenant_id=tenant_id, agent_id=agent_id)
                draft = save_agent_draft(
                    session=session,
                    tenant_id=tenant_id,
                    agent=agent,
                    draft_type=AgentConfigDraftType.DRAFT,
                    account_id=None,
                    agent_soul=soul,
                    account_id_for_audit=account_id,
                )
                agent.updated_by = account_id
                agent.active_config_is_published = agent_soul_matches_active_config(
                    session=session,
                    tenant_id=tenant_id,
                    agent=agent,
                    agent_soul=AgentSoulConfig.model_validate(draft.config_snapshot_dict),
                    home_snapshot_id=draft.home_snapshot_id,
                )
                session.flush()
                return read_composer_state(session, agent=agent)
        except AgentBuildAgentNotFoundError as exc:
            raise AgentComposerAgentMissingError from exc
        except AgentBuildBaseUnavailableError as exc:
            raise AgentComposerSnapshotMissingError from exc

    @staticmethod
    def _composer_datasets(
        session: Session, *, tenant_id: str, dataset_ids: list[str]
    ) -> dict[str, AgentComposerDatasetLabel]:
        """Return labels for valid dataset IDs owned by the tenant."""
        ids = filter_uuid_strings(dataset_ids)
        if not ids:
            return {}
        rows = session.execute(
            select(Dataset.id, Dataset.name, Dataset.description).where(
                Dataset.tenant_id == tenant_id, Dataset.id.in_(ids)
            )
        )
        return {dataset_id: AgentComposerDatasetLabel(name, description) for dataset_id, name, description in rows}

    def missing_composer_datasets(self, *, tenant_id: str, dataset_ids: list[str]) -> list[str]:
        """Return malformed, missing and foreign dataset IDs in the request order."""
        with self._session_factory() as session:
            datasets = self._composer_datasets(session, tenant_id=tenant_id, dataset_ids=dataset_ids)
        return [dataset_id for dataset_id in dataset_ids if dataset_id not in datasets]

    def prepare_publication(self, *, tenant_id: str, agent_id: str) -> AgentPublicationSource:
        """Read the candidate publication without creating a draft."""
        with self._session_factory() as session:
            agent = require_composer_agent(session, tenant_id=tenant_id, agent_id=agent_id)
            return publication_source(session, agent=agent, for_update=False)

    def publish_composer(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        source: AgentPublicationSource,
        version_note: str | None,
    ) -> AgentPublication:
        """Publish only the validated configuration and atomically commit all associated rows."""
        with self._session_factory.begin() as session:
            agent = session.scalar(
                select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id).with_for_update()
            )
            if agent is None:
                raise AgentComposerAgentMissingError
            if publication_source(session, agent=agent, for_update=True) != source:
                raise AgentPublicationChangedError
            access_was_ready = agent_has_workflow_callable_active_snapshot(session=session, agent=agent)
            draft = get_or_create_agent_draft(
                session=session,
                tenant_id=tenant_id,
                agent=agent,
                draft_type=AgentConfigDraftType.DRAFT,
                account_id=None,
                created_by=account_id,
            )
            soul = AgentSoulConfig.model_validate(source.soul)
            knowledge_app_id = source.knowledge_app_id
            if knowledge_app_id is not None:
                if self._stage_publication_bindings is None:
                    raise RuntimeError("Agent publication requires a KnowledgeFS binding participant")
                self._stage_publication_bindings(
                    session,
                    tenant_id=tenant_id,
                    account_id=account_id,
                    app_id=knowledge_app_id,
                    control_space_ids=[binding.control_space_id for binding in soul.knowledge.spaces],
                )
            if source.home_snapshot_id is not None and not has_owned_home_snapshot(
                session, agent=agent, home_snapshot_id=source.home_snapshot_id
            ):
                raise AgentPublicationHomeUnavailableError

            version = create_composer_snapshot(
                session,
                tenant_id=tenant_id,
                agent_id=agent.id,
                account_id=account_id,
                agent_soul=soul,
                operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
                version_note=version_note,
                previous_snapshot_id=source.active_snapshot_id,
                home_snapshot_id=source.home_snapshot_id,
            )
            agent.active_config_snapshot_id = version.id
            agent.active_config_has_model = agent_soul_has_model(soul)
            agent.active_config_is_published = True
            agent.updated_by = account_id
            draft.base_snapshot_id = version.id
            draft.updated_by = account_id
            publish_agent_bindings(
                session, tenant_id=tenant_id, agent_id=agent.id, snapshot_id=version.id, user_id=account_id
            )
            if not access_was_ready:
                app = session.scalar(select(App).where(App.tenant_id == tenant_id, App.id == agent.app_id))
                if app is None:
                    raise AgentComposerAgentMissingError
                app.enable_site = True
                app.enable_api = True
                app.updated_by = account_id
            session.flush()
            snapshot = composer_snapshot(version)
            assert snapshot is not None
            return AgentPublication(
                publication_kind=AgentPublicationKind.UPDATE if access_was_ready else AgentPublicationKind.FIRST,
                active_config_snapshot_id=version.id,
                active_config_snapshot=snapshot,
                draft=project_agent_draft_summary(draft),
            )

    def get_composer_candidates(self, *, tenant_id: str, agent_id: str) -> AgentComposerCandidateSource:
        """Detach the effective Soul and labels, retaining empty Soul candidates for an unknown Agent."""
        with self._session_factory() as session:
            try:
                agent = require_composer_agent(session, tenant_id=tenant_id, agent_id=agent_id)
            except AgentComposerAgentMissingError:
                return AgentComposerCandidateSource(soul=None, datasets={})
            soul = AgentSoulConfig.model_validate(read_composer_state(session, agent=agent).agent_soul)
            datasets = self._composer_datasets(session, tenant_id=tenant_id, dataset_ids=soul.knowledge.dataset_ids())
            return AgentComposerCandidateSource(soul=soul, datasets=datasets)

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
        """Recheck the prepared state and atomically attach the checkpoint and retire the old bindings.

        Report a rolled-back write only after a staging failure and successful rollback.
        A failure once commit starts leaves the checkpoint's attachment uncertain.
        """
        with self._session_factory() as session:
            try:
                result = self._stage_build_apply(
                    session,
                    tenant_id=tenant_id,
                    agent_id=agent_id,
                    account_id=account_id,
                    source=source,
                    snapshot=snapshot,
                )
            except (AgentBuildApplyChangedError, AgentBuildBaseUnavailableError, AgentBuildBindingUnavailableError):
                raise
            except Exception as exc:
                session.rollback()
                raise AgentBuildApplyRolledBackError from exc
            session.commit()
            return result

    def _stage_build_apply(
        self,
        session: Session,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        source: AgentBuildApplySource,
        snapshot: AgentBuildHomeSnapshot | None,
    ) -> AgentBuildApplied:
        """Stage and flush Apply in the caller's transaction if the prepared state still matches."""
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
        """Resolve the Agent runtime App and materialize a missing hidden App when permitted."""
        with self._session_factory() as session:
            app = resolve_agent_runtime_app(session, tenant_id=tenant_id, agent_id=agent_id)
            if app is None:
                raise AgentAppNotFoundError
            return app.id

    def resolve_existing_runtime_app_id(self, *, tenant_id: str, agent_id: str) -> str:
        """Read persisted runtime state without creating a hidden app during a GET."""
        with self._session_factory() as session:
            return self._require_existing_runtime_app(session, tenant_id=tenant_id, agent_id=agent_id).id

    def get_agent_asr_enabled(self, *, app: AudioAppRef, agent_id: str, account_id: str, build: bool) -> bool:
        """Read the admitted App and effective debug ASR setting without changing any rows."""
        with self._session_factory() as session:
            runtime_app = self._require_existing_runtime_app(session, tenant_id=app.tenant_id, agent_id=agent_id)
            if runtime_app.id != app.app_id or runtime_app.mode != app.app_mode:
                raise AgentAppNotFoundError

            if build:
                draft = find_agent_draft(
                    session,
                    tenant_id=app.tenant_id,
                    agent_id=agent_id,
                    draft_type=AgentConfigDraftType.DEBUG_BUILD,
                    account_id=account_id,
                )
                if draft is None:
                    raise AgentConfigVersionMissingError
                soul_data = draft.config_snapshot_dict
            else:
                try:
                    agent = require_composer_agent(session, tenant_id=app.tenant_id, agent_id=agent_id)
                    soul_data = read_composer_state(session, agent=agent).agent_soul
                except AgentComposerAgentMissingError as exc:
                    raise AgentAppNotFoundError from exc
                except AgentComposerSnapshotMissingError as exc:
                    raise AgentConfigVersionMissingError from exc

            speech_to_text = AgentSoulConfig.model_validate(soul_data).app_features.speech_to_text
            if speech_to_text is not None:
                return speech_to_text.enabled
            app_config = runtime_app.app_model_config_with_session(session=session)
            return app_config is not None and bool(app_config.speech_to_text_dict.get("enabled"))

    def get_agent_tts_source(
        self, *, tenant_id: str, agent_id: str, account_id: str, message_id: str | None
    ) -> AgentTextToSpeechSource:
        """Return the existing App and an eligible answer scoped to the admitted account."""
        with self._session_factory() as session:
            app = self._require_existing_runtime_app(session, tenant_id=tenant_id, agent_id=agent_id)
            app_ref = AudioAppRef(app.id, app.tenant_id, app.mode.value)
            if not message_id:
                return AgentTextToSpeechSource(app_ref, None)
            try:
                UUID(message_id)
            except ValueError:
                return AgentTextToSpeechSource(app_ref, None)
            message = session.execute(
                select(Message.answer, Message.status)
                .where(
                    Message.id == message_id,
                    Message.app_id == app.id,
                    Message.from_account_id == account_id,
                )
                .limit(1)
            ).one_or_none()
            if message is None or (
                message.answer == "" and message.status in {MessageStatus.NORMAL, MessageStatus.PAUSED}
            ):
                return AgentTextToSpeechSource(app_ref, None)
            return AgentTextToSpeechSource(app_ref, message.answer)

    @staticmethod
    def _require_existing_runtime_app(session: Session, *, tenant_id: str, agent_id: str) -> App:
        """Load a normal Agent App within its tenant without provisioning a missing App."""
        app = find_existing_agent_runtime_app(session, tenant_id=tenant_id, agent_id=agent_id)
        if app is None:
            raise AgentAppNotFoundError
        return app

    def list_referencing_workflows(self, *, tenant_id: str, agent_id: str) -> list[AgentReferencingWorkflow]:
        """Require a public Agent App and return its current published Workflow references without writing."""
        with self._session_factory() as session:
            app = get_roster_agent_app(session, tenant_id=tenant_id, agent_id=agent_id)
            if app is None:
                raise AgentAppNotFoundError
            agent = get_app_backing_agent(session, tenant_id=tenant_id, app_id=app.id)
            if agent is None:
                return []
            references = load_published_workflows_by_agent_id(session, tenant_id=tenant_id, agent_ids=[agent.id])
            return [project_referencing_workflow(reference) for reference in references.get(agent.id, ())]

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
