"""Agent App generator: orchestrate Agent App chat and finalize executions.

Agent App turns mirror the agent_chat generator (conversation + message +
queue + streamed response over the EasyUI chat pipeline), but the backing
config comes from the bound Agent Soul and the answer is produced by
``AgentAppRunner`` calling the dify-agent backend rather than an in-process
LLM/ReAct loop. Build-chat finalization uses this same streamed path and only
changes the runtime exit policy carried to the backend.
"""

from __future__ import annotations

import contextvars
import json
import logging
import threading
import uuid
from collections.abc import Generator, Mapping, Sequence
from typing import Any, Literal

from flask import Flask, current_app
from pydantic import JsonValue
from sqlalchemy import and_, or_, select

from clients.agent_backend import AgentBackendRunEventAdapter
from clients.agent_backend.factory import create_agent_backend_run_client
from configs import dify_config
from constants import UUID_NIL
from core.app.app_config.easy_ui_based_app.model_config.converter import ModelConfigConverter
from core.app.apps.agent_app.app_config_manager import AgentAppConfigManager
from core.app.apps.agent_app.app_runner import AgentAppRunner
from core.app.apps.agent_app.errors import AgentAppGeneratorError, AgentAppNotPublishedError
from core.app.apps.agent_app.generate_response_converter import AgentAppGenerateResponseConverter
from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeRequestBuilder
from core.app.apps.agent_app.session_store import AgentAppRuntimeSessionStore
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import (
    AGENT_RUNTIME_EXIT_INTENT_ARG,
    AgentAppGenerateEntity,
    AgentRuntimeExitIntent,
    DifyRunContext,
    InvokeFrom,
    UserFrom,
)
from core.app.llm.model_access import build_dify_model_access
from core.ops.ops_trace_manager import TraceQueueManager
from core.workflow.file_reference import build_file_reference, is_canonical_file_reference
from extensions.ext_database import db
from models import Account, App, EndUser, Message
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.agent_config_entities import AgentSoulConfig
from services.conversation_service import ConversationService

logger = logging.getLogger(__name__)

_REFERENCE_FILE_TRANSFER_METHODS = {"local_file", "tool_file", "datasource_file"}


def _append_prompt_file_mappings(query: str, prompt_file_mappings: Sequence[JsonValue]) -> str:
    """Append labeled, prompt-safe file locators to the backend user prompt."""
    prompt_files = _prompt_file_locators(prompt_file_mappings)
    if not prompt_files:
        return query
    payload = json.dumps(prompt_files, ensure_ascii=False, separators=(",", ":"))
    return (
        f"{query}\n"
        "User provided files: use dify-agent file download with the listed transfer_method and reference/url "
        "to get the files and investigate them\n"
        f"{payload}"
    )


def _prompt_file_locators(prompt_file_mappings: Sequence[JsonValue]) -> list[dict[str, str]]:
    locators: list[dict[str, str]] = []
    for file_mapping in prompt_file_mappings:
        if not isinstance(file_mapping, Mapping):
            continue
        locator = _prompt_file_locator(file_mapping)
        if locator is not None:
            locators.append(locator)
    return locators


def _prompt_file_locator(file_mapping: Mapping[str, object]) -> dict[str, str] | None:
    transfer_method = _string_value(file_mapping, "transfer_method")
    if transfer_method == "remote_url":
        url = _string_value(file_mapping, "url") or _string_value(file_mapping, "remote_url")
        if url is None:
            return None
        return {"transfer_method": "remote_url", "url": url}
    elif transfer_method in _REFERENCE_FILE_TRANSFER_METHODS:
        if transfer_method is None:
            return None
        reference = _canonical_file_reference(
            _string_value(file_mapping, "reference")
            or _string_value(file_mapping, "upload_file_id")
            or _string_value(file_mapping, "file_id")
            or _string_value(file_mapping, "id")
        )
        if reference is None:
            return None
        return {"transfer_method": transfer_method, "reference": reference}
    else:
        return None


def _canonical_file_reference(reference: str | None) -> str | None:
    if reference is None:
        return None
    if reference.startswith("dify-file-ref:"):
        return reference if is_canonical_file_reference(reference) else None
    return build_file_reference(record_id=reference)


def _string_value(mapping: Mapping[str, object], key: str) -> str | None:
    value = mapping.get(key)
    return value if isinstance(value, str) and value else None


class AgentAppGenerator(MessageBasedAppGenerator):
    def generate(
        self,
        *,
        app_model: App,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
    ) -> Mapping[str, Any] | Generator[Mapping | str, None, None]:
        if not streaming:
            raise AgentAppGeneratorError("Agent App only supports streaming mode")

        query = self._require_query(args)
        inputs = args["inputs"]
        prompt_file_mappings = args.get("files") or []

        # Resolve the bound roster Agent + its current Agent Soul snapshot.
        agent, agent_config_id, agent_config_version_kind, agent_soul = self._resolve_agent(
            app_model,
            invoke_from=invoke_from,
            draft_type=args.get("draft_type"),
            user=user,
        )
        runtime_session_snapshot_id = self._runtime_session_snapshot_id(
            invoke_from=invoke_from,
            snapshot_id=agent_config_id,
        )

        conversation = None
        conversation_id = args.get("conversation_id")
        if conversation_id:
            conversation = ConversationService.get_conversation(
                app_model=app_model, conversation_id=conversation_id, user=user, session=db.session()
            )

        # Build the EasyUI-shaped config from the Agent Soul so the chat pipeline
        # can persist usage; the answer itself comes from the agent backend.
        app_model_config = app_model.app_model_config
        app_config = AgentAppConfigManager.get_app_config(
            app_model=app_model,
            agent_soul=agent_soul,
            app_model_config=app_model_config,
            conversation=conversation,
        )
        model_conf = ModelConfigConverter.convert(app_config)

        trace_manager = TraceQueueManager(app_model.id, user.id if isinstance(user, Account) else user.session_id)
        agent_runtime_exit_intent = self._resolve_agent_runtime_exit_intent(args)

        application_generate_entity = AgentAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            model_conf=model_conf,
            conversation_id=conversation.id if conversation else None,
            inputs=self._prepare_user_inputs(
                user_inputs=inputs, variables=app_config.variables, tenant_id=app_model.tenant_id
            ),
            query=query,
            files=[],
            prompt_file_mappings=prompt_file_mappings,
            parent_message_id=(
                args.get("parent_message_id")
                if invoke_from not in {InvokeFrom.SERVICE_API, InvokeFrom.OPENAPI}
                else UUID_NIL
            ),
            user_id=user.id,
            stream=streaming,
            invoke_from=invoke_from,
            extras={
                "auto_generate_conversation_name": args.get("auto_generate_name", True),
            },
            call_depth=0,
            trace_manager=trace_manager,
            agent_id=agent.id,
            agent_config_snapshot_id=agent_config_id,
            agent_config_version_kind=agent_config_version_kind,
            agent_runtime_session_snapshot_id=runtime_session_snapshot_id,
            agent_runtime_exit_intent=agent_runtime_exit_intent,
        )

        conversation, message = self._init_generate_records(application_generate_entity, conversation)

        queue_manager = MessageBasedAppQueueManager(
            task_id=application_generate_entity.task_id,
            user_id=application_generate_entity.user_id,
            invoke_from=application_generate_entity.invoke_from,
            conversation_id=conversation.id,
            app_mode=conversation.mode,
            message_id=message.id,
        )

        context = contextvars.copy_context()
        worker_thread = threading.Thread(
            target=self._generate_worker,
            kwargs={
                "flask_app": current_app._get_current_object(),  # type: ignore
                "context": context,
                "application_generate_entity": application_generate_entity,
                "queue_manager": queue_manager,
                "conversation_id": conversation.id,
                "message_id": message.id,
                "user_from": UserFrom.ACCOUNT if isinstance(user, Account) else UserFrom.END_USER,
            },
        )
        worker_thread.start()

        response = self._handle_response(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation=conversation,
            message=message,
            user=user,
            stream=streaming,
        )
        return AgentAppGenerateResponseConverter.convert(response=response, invoke_from=invoke_from)

    def resume_after_form_submission(
        self,
        *,
        app_model: App,
        user: Account | EndUser,
        conversation_id: str,
        invoke_from: InvokeFrom,
    ) -> None:
        """Resume an Agent App conversation after a submitted ask_human HITL form.

        ENG-635: triggered by a background task (not an HTTP request). Runs one
        blocking turn with no user query; the runner threads the human's reply
        into the agent run as deferred_tool_results and the assistant answer is
        persisted to the conversation. Live streaming to a reconnected client is
        out of scope here — the message is persisted and can be re-fetched.
        """
        conversation = ConversationService.get_conversation(
            app_model=app_model, conversation_id=conversation_id, user=user, session=db.session()
        )
        agent, agent_config_id, agent_config_version_kind, agent_soul = self._resolve_agent(
            app_model,
            invoke_from=invoke_from,
            draft_type=self._resume_draft_type(app_model=app_model, conversation=conversation, user=user),
            user=user,
        )

        app_config = AgentAppConfigManager.get_app_config(
            app_model=app_model,
            agent_soul=agent_soul,
            app_model_config=app_model.app_model_config,
            conversation=conversation,
        )
        model_conf = ModelConfigConverter.convert(app_config)
        trace_manager = TraceQueueManager(app_model.id, user.id if isinstance(user, Account) else user.session_id)

        # ENG-638: the agent backend requires the resume composition's layer
        # names to match the suspended snapshot, which includes the per-turn
        # user-prompt layer. So re-send the original user message (the paused
        # turn's query); the continuation is driven by deferred_tool_results and
        # the restored snapshot, not by re-processing this prompt. A blank prompt
        # would drop the user-prompt layer and fail the snapshot match.
        paused_message = db.session.scalar(
            select(Message)
            .where(Message.conversation_id == conversation.id, Message.query != "")
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        resume_query = paused_message.query if paused_message and paused_message.query else "(resumed)"

        application_generate_entity = AgentAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            model_conf=model_conf,
            conversation_id=conversation.id,
            # A resume carries no new user inputs; the human's answer is the
            # submitted form, threaded in by the runner as deferred_tool_results.
            # The query re-sends the paused turn's message (see above).
            inputs={},
            query=resume_query,
            files=[],
            parent_message_id=UUID_NIL,
            user_id=user.id,
            stream=False,
            invoke_from=invoke_from,
            extras={"auto_generate_conversation_name": False},
            call_depth=0,
            trace_manager=trace_manager,
            agent_id=agent.id,
            agent_config_snapshot_id=agent_config_id,
            agent_config_version_kind=agent_config_version_kind,
        )

        conversation, message = self._init_generate_records(application_generate_entity, conversation)

        queue_manager = MessageBasedAppQueueManager(
            task_id=application_generate_entity.task_id,
            user_id=application_generate_entity.user_id,
            invoke_from=application_generate_entity.invoke_from,
            conversation_id=conversation.id,
            app_mode=conversation.mode,
            message_id=message.id,
        )

        context = contextvars.copy_context()
        worker_thread = threading.Thread(
            target=self._generate_worker,
            kwargs={
                "flask_app": current_app._get_current_object(), # type: ignore
                "session": db.session(),
                "context": context,
                "application_generate_entity": application_generate_entity,
                "queue_manager": queue_manager,
                "conversation_id": conversation.id,
                "message_id": message.id,
                "user_from": UserFrom.ACCOUNT if isinstance(user, Account) else UserFrom.END_USER,
                # Resume continues a paused agent run; skip input guards (see _generate_worker).
                "is_resume": True,
            },
        )
        worker_thread.start()

        # Blocking: drive the chat task pipeline to persist the assistant answer.
        self._handle_response(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation=conversation,
            message=message,
            user=user,
            stream=False,
        )

    @staticmethod
    def _resume_draft_type(*, app_model: App, conversation: Any, user: Account | EndUser) -> str | None:
        if conversation.invoke_from != InvokeFrom.DEBUGGER:
            return None
        active_session = AgentAppRuntimeSessionStore().load_active_session_for_conversation(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            conversation_id=conversation.id,
        )
        snapshot_id = active_session.scope.agent_config_snapshot_id if active_session is not None else None
        if snapshot_id and isinstance(user, Account):
            draft = db.session.scalar(
                select(AgentConfigDraft).where(
                    AgentConfigDraft.tenant_id == app_model.tenant_id,
                    AgentConfigDraft.id == snapshot_id,
                )
            )
            if draft is not None:
                if draft.draft_type == AgentConfigDraftType.DEBUG_BUILD and draft.account_id == user.id:
                    return AgentConfigDraftType.DEBUG_BUILD.value
                if draft.draft_type == AgentConfigDraftType.DRAFT and draft.account_id is None:
                    return AgentConfigDraftType.DRAFT.value
        return AgentConfigDraftType.DRAFT.value

    def _generate_worker(
        self,
        *,
        flask_app: Flask,
        context: contextvars.Context,
        application_generate_entity: AgentAppGenerateEntity,
        queue_manager: AppQueueManager,
        conversation_id: str,
        message_id: str,
        user_from: UserFrom,
        is_resume: bool = False,
    ) -> None:
        from libs.flask_utils import preserve_flask_contexts

        with preserve_flask_contexts(flask_app, context_vars=context):
            try:
                conversation = self._get_conversation(conversation_id)
                message = self._get_message(message_id)
                app_config = application_generate_entity.app_config

                if is_resume:
                    # ENG-638: a resume continues a paused agent run; the human's
                    # reply is threaded in by the runner as deferred_tool_results.
                    # The query is the replayed paused-turn message, kept only to
                    # match the suspended snapshot's layers — it is NOT new
                    # end-user input, so input guards must NOT run. Moderation or an
                    # annotation match on the replayed query would short-circuit the
                    # turn and drop the human reply, stranding the ask_human session.
                    query = application_generate_entity.query or ""
                else:
                    # Apply app-level input guards (content moderation + annotation
                    # reply) before reaching the Agent backend, mirroring the EasyUI
                    # chat / agent-chat runners. These can short-circuit the turn.
                    app_model = db.session.get(App, app_config.app_id)
                    if app_model is None:
                        raise AgentAppGeneratorError("App not found")
                    handled, query = self._run_input_guards(
                        application_generate_entity=application_generate_entity,
                        app_model=app_model,
                        message=message,
                        queue_manager=queue_manager,
                    )
                    if handled:
                        return
                    query = _append_prompt_file_mappings(
                        query=query,
                        prompt_file_mappings=application_generate_entity.prompt_file_mappings,
                    )

                dify_context = DifyRunContext(
                    tenant_id=app_config.tenant_id,
                    app_id=app_config.app_id,
                    user_id=application_generate_entity.user_id,
                    user_from=user_from,
                    invoke_from=application_generate_entity.invoke_from,
                )
                _, _, agent_soul = self._resolve_agent_by_id(
                    tenant_id=app_config.tenant_id,
                    agent_id=application_generate_entity.agent_id,
                    snapshot_id=application_generate_entity.agent_config_snapshot_id,
                )

                runner = self._build_runner(dify_context)
                runner.run(
                    dify_context=dify_context,
                    agent_id=application_generate_entity.agent_id,
                    agent_config_snapshot_id=application_generate_entity.agent_config_snapshot_id,
                    agent_config_version_kind=application_generate_entity.agent_config_version_kind,
                    agent_soul=agent_soul,
                    conversation_id=conversation.id,
                    query=query,
                    message_id=message.id,
                    model_name=application_generate_entity.model_conf.model,
                    queue_manager=queue_manager,
                    session_scope_snapshot_id=application_generate_entity.agent_runtime_session_snapshot_id,
                    agent_runtime_exit_intent=application_generate_entity.agent_runtime_exit_intent,
                )
            except GenerateTaskStoppedError:
                pass
            except Exception as e:
                logger.exception("Unknown Error in Agent App generate worker")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            finally:
                db.session.close()

    @staticmethod
    def _require_query(args: Mapping[str, Any]) -> str:
        query = args.get("query")
        if not isinstance(query, str) or not query.strip():
            raise AgentAppGeneratorError("query is required")
        return query.replace("\x00", "")

    @staticmethod
    def _resolve_agent_runtime_exit_intent(args: Mapping[str, Any]) -> AgentRuntimeExitIntent:
        """Resolve API-internal runtime exit policy from controller-owned args.

        Only the private controller-injected "delete" value changes behavior.
        Normal chat and resume flows default/fallback to "suspend" so public
        payloads and invalid internal values preserve existing semantics.
        """
        if args.get(AGENT_RUNTIME_EXIT_INTENT_ARG) == "delete":
            return "delete"
        return "suspend"

    @staticmethod
    def _build_runner(dify_context: DifyRunContext) -> AgentAppRunner:
        credentials_provider, _ = build_dify_model_access(dify_context)
        return AgentAppRunner(
            request_builder=AgentAppRuntimeRequestBuilder(credentials_provider=credentials_provider),
            agent_backend_client=create_agent_backend_run_client(
                base_url=dify_config.AGENT_BACKEND_BASE_URL,
                use_fake=dify_config.AGENT_BACKEND_USE_FAKE,
                fake_scenario=dify_config.AGENT_BACKEND_FAKE_SCENARIO,
            ),
            event_adapter=AgentBackendRunEventAdapter(),
            session_store=AgentAppRuntimeSessionStore(),
            text_delta_debounce_seconds=dify_config.AGENT_APP_TEXT_DELTA_DEBOUNCE_SECONDS,
        )

    def _run_input_guards(
        self,
        *,
        application_generate_entity: AgentAppGenerateEntity,
        app_model: App,
        message: Message,
        queue_manager: AppQueueManager,
    ) -> tuple[bool, str]:
        """Apply input moderation + annotation reply before the backend call.

        Returns ``(handled, query)``: when ``handled`` is True a direct answer
        has already been published (a blocked/preset moderation response or a
        matched annotation) and the backend turn must be skipped. Otherwise
        ``query`` is the possibly moderation-overridden query to send onward.
        """
        from core.app.apps.agent_app.app_runner import publish_text_answer
        from core.app.entities.queue_entities import QueueAnnotationReplyEvent
        from core.app.features.annotation_reply.annotation_reply import AnnotationReplyFeature
        from core.moderation.base import ModerationError
        from core.moderation.input_moderation import InputModeration

        app_config = application_generate_entity.app_config
        model_name = application_generate_entity.model_conf.model
        query = application_generate_entity.query or ""

        # content moderation (sensitive_word_avoidance); a blocked input yields a
        # preset answer, an "overridden" action returns a sanitized query.
        try:
            _, _, query = InputModeration().check(
                app_id=app_config.app_id,
                tenant_id=app_config.tenant_id,
                app_config=app_config,
                inputs=dict(application_generate_entity.inputs),
                query=query or "",
                message_id=message.id,
                trace_manager=application_generate_entity.trace_manager,
            )
        except ModerationError as e:
            publish_text_answer(queue_manager=queue_manager, model_name=model_name, answer=str(e), user_query=query)
            return True, query

        # annotation reply: a matching annotation answers the turn deterministically.
        if query:
            annotation_reply = AnnotationReplyFeature().query(
                app_record=app_model,
                message=message,
                query=query,
                user_id=application_generate_entity.user_id,
                invoke_from=application_generate_entity.invoke_from,
            )
            if annotation_reply:
                queue_manager.publish(
                    QueueAnnotationReplyEvent(message_annotation_id=annotation_reply.id),
                    PublishFrom.APPLICATION_MANAGER,
                )
                publish_text_answer(
                    queue_manager=queue_manager,
                    model_name=model_name,
                    answer=annotation_reply.content,
                    user_query=query,
                )
                return True, query

        return False, query

    def _resolve_agent(
        self,
        app_model: App,
        *,
        invoke_from: InvokeFrom,
        draft_type: Any,
        user: Account | EndUser,
    ) -> tuple[Agent, str, Literal["snapshot", "draft", "build_draft"], AgentSoulConfig]:
        agent = db.session.scalar(
            select(Agent)
            .where(
                Agent.tenant_id == app_model.tenant_id,
                Agent.status == AgentStatus.ACTIVE,
                or_(
                    and_(
                        Agent.app_id == app_model.id,
                        Agent.scope == AgentScope.ROSTER,
                        Agent.source == AgentSource.AGENT_APP,
                    ),
                    Agent.backing_app_id == app_model.id,
                ),
            )
            .order_by(Agent.created_at.desc())
            .limit(1)
        )
        if agent is None:
            raise AgentAppGeneratorError("Agent App has no bound Agent")
        if invoke_from == InvokeFrom.DEBUGGER:
            draft = self._resolve_debug_draft(
                tenant_id=app_model.tenant_id,
                agent=agent,
                draft_type=draft_type,
                account_id=user.id if isinstance(user, Account) else None,
            )
            agent_soul = AgentSoulConfig.model_validate(draft.config_snapshot_dict)
            config_version_kind: Literal["snapshot", "draft", "build_draft"] = (
                "build_draft" if draft.draft_type == AgentConfigDraftType.DEBUG_BUILD else "draft"
            )
            return agent, draft.id, config_version_kind, agent_soul
        # active_config_is_published tracks whether the editable draft matches the active snapshot.
        # Public runtime must keep serving the active snapshot even when unpublished draft edits exist.
        if not agent.active_config_snapshot_id:
            raise AgentAppNotPublishedError("Agent has not been published")
        _, snapshot, agent_soul = self._resolve_agent_by_id(
            tenant_id=app_model.tenant_id,
            agent_id=agent.id,
            snapshot_id=agent.active_config_snapshot_id,
        )
        return agent, snapshot.id, "snapshot", agent_soul

    @staticmethod
    def _runtime_session_snapshot_id(*, invoke_from: InvokeFrom, snapshot_id: str) -> str | None:
        """Return the session scope snapshot id for Agent App runtime state.

        Console preview/debug chat uses a stable Agent draft row id; build mode
        uses the current user's build-draft row id. Published/web/API runs use
        immutable published snapshot ids. This keeps runtime session continuity
        inside one editable surface without mixing draft/build/published state.
        """
        return snapshot_id

    @staticmethod
    def _resolve_debug_draft(
        *, tenant_id: str, agent: Agent, draft_type: Any, account_id: str | None
    ) -> AgentConfigDraft:
        effective_draft_type = (
            AgentConfigDraftType.DEBUG_BUILD
            if draft_type == AgentConfigDraftType.DEBUG_BUILD.value
            else AgentConfigDraftType.DRAFT
        )
        stmt = select(AgentConfigDraft).where(
            AgentConfigDraft.tenant_id == tenant_id,
            AgentConfigDraft.agent_id == agent.id,
            AgentConfigDraft.draft_type == effective_draft_type,
        )
        if effective_draft_type == AgentConfigDraftType.DEBUG_BUILD:
            if not account_id:
                raise AgentAppGeneratorError("Build draft requires an account user")
            stmt = stmt.where(AgentConfigDraft.account_id == account_id)
        else:
            stmt = stmt.where(AgentConfigDraft.account_id.is_(None))
        draft = db.session.scalar(stmt.order_by(AgentConfigDraft.updated_at.desc()).limit(1))
        if draft is not None:
            return draft
        if effective_draft_type == AgentConfigDraftType.DEBUG_BUILD:
            raise AgentAppGeneratorError("Agent build draft not found")
        _, snapshot, agent_soul = AgentAppGenerator._resolve_agent_by_id(
            tenant_id=tenant_id,
            agent_id=agent.id,
            snapshot_id=agent.active_config_snapshot_id,
        )
        draft = AgentConfigDraft(
            tenant_id=tenant_id,
            agent_id=agent.id,
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
            draft_owner_key="",
            base_snapshot_id=snapshot.id,
            config_snapshot=agent_soul,
            created_by=agent.created_by,
            updated_by=agent.updated_by,
        )
        db.session.add(draft)
        db.session.flush()
        return draft

    @staticmethod
    def _resolve_agent_by_id(
        *, tenant_id: str, agent_id: str, snapshot_id: str | None
    ) -> tuple[Agent, AgentConfigSnapshot | AgentConfigDraft, AgentSoulConfig]:
        agent = db.session.scalar(select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id))
        if agent is None:
            raise AgentAppGeneratorError("Agent not found")
        if not snapshot_id:
            raise AgentAppGeneratorError("Agent has no published version")
        snapshot = db.session.scalar(
            select(AgentConfigSnapshot).where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.id == snapshot_id,
            )
        )
        if snapshot is not None:
            agent_soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
            return agent, snapshot, agent_soul
        draft = db.session.scalar(
            select(AgentConfigDraft).where(
                AgentConfigDraft.tenant_id == tenant_id,
                AgentConfigDraft.agent_id == agent_id,
                AgentConfigDraft.id == snapshot_id,
            )
        )
        if draft is None:
            raise AgentAppGeneratorError("Agent published version not found")
        agent_soul = AgentSoulConfig.model_validate(draft.config_snapshot_dict)
        return agent, draft, agent_soul


__all__ = ["AgentAppGenerator", "AgentAppGeneratorError", "AgentAppNotPublishedError"]
