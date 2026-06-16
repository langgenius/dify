"""Agent App runner: drive one conversation turn through the dify-agent backend.

Unlike the legacy ``AgentChatAppRunner`` (which runs an in-process ReAct loop),
this runner delegates to the Agent backend: build the run request from the
Agent Soul + conversation, create the run, consume its event stream, and
republish the assistant answer as chat queue events so the existing
EasyUI chat task pipeline persists the message and streams SSE. The conversation
``session_snapshot`` is saved on success for multi-turn continuity (S3).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from dify_agent.layers.ask_human import AskHumanToolArgs
from dify_agent.protocol import DeferredToolResultsPayload
from pydantic import JsonValue

from clients.agent_backend import (
    AgentBackendDeferredToolCallInternalEvent,
    AgentBackendError,
    AgentBackendInternalEventType,
    AgentBackendRunClient,
    AgentBackendRunEventAdapter,
    AgentBackendRunSucceededInternalEvent,
    AgentBackendStreamInternalEvent,
    extract_runtime_layer_specs,
)
from core.app.apps.agent_app.runtime_request_builder import (
    AgentAppRuntimeBuildContext,
    AgentAppRuntimeRequest,
    AgentAppRuntimeRequestBuilder,
)
from core.app.apps.agent_app.session_store import (
    AgentAppRuntimeSessionStore,
    AgentAppSessionScope,
    StoredAgentAppSession,
)
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import DifyRunContext
from core.app.entities.queue_entities import QueueLLMChunkEvent, QueueMessageEndEvent
from core.repositories.human_input_repository import HumanInputFormRepository, HumanInputFormRepositoryImpl
from core.workflow.nodes.agent_v2.ask_human_hitl import AskHumanFormBuildError, create_ask_human_form
from core.workflow.nodes.agent_v2.ask_human_resume import build_deferred_tool_results, resolve_ask_human_form
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from models.agent_config_entities import AgentSoulConfig

logger = logging.getLogger(__name__)


def publish_text_answer(*, queue_manager: AppQueueManager, model_name: str, answer: str) -> None:
    """Publish a complete assistant answer as one chunk + message-end.

    The EasyUI chat task pipeline consumes a QueueLLMChunkEvent stream followed
    by a QueueMessageEndEvent; emitting the whole answer as a single chunk lets
    both the backend-produced answer and short-circuited answers (moderation /
    annotation reply) share the exact same persistence + SSE path.
    """
    chunk = LLMResultChunk(
        model=model_name,
        prompt_messages=[],
        delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content=answer)),
    )
    queue_manager.publish(QueueLLMChunkEvent(chunk=chunk), PublishFrom.APPLICATION_MANAGER)
    queue_manager.publish(
        QueueMessageEndEvent(
            llm_result=LLMResult(
                model=model_name,
                prompt_messages=[],
                message=AssistantPromptMessage(content=answer),
                usage=LLMUsage.empty_usage(),
            ),
        ),
        PublishFrom.APPLICATION_MANAGER,
    )


class AgentAppRunner:
    """Runs one Agent App conversation turn against the Agent backend."""

    def __init__(
        self,
        *,
        request_builder: AgentAppRuntimeRequestBuilder,
        agent_backend_client: AgentBackendRunClient,
        event_adapter: AgentBackendRunEventAdapter,
        session_store: AgentAppRuntimeSessionStore,
    ) -> None:
        self._request_builder = request_builder
        self._agent_backend_client = agent_backend_client
        self._event_adapter = event_adapter
        self._session_store = session_store

    def run(
        self,
        *,
        dify_context: DifyRunContext,
        agent_id: str,
        agent_config_snapshot_id: str,
        agent_soul: AgentSoulConfig,
        conversation_id: str,
        query: str,
        message_id: str,
        model_name: str,
        queue_manager: AppQueueManager,
    ) -> None:
        scope = AgentAppSessionScope(
            tenant_id=dify_context.tenant_id,
            app_id=dify_context.app_id,
            conversation_id=conversation_id,
            agent_id=agent_id,
            agent_config_snapshot_id=agent_config_snapshot_id,
        )
        # ENG-638: if a prior turn paused on ask_human and the form is now answered,
        # resume by threading the human's reply into this run as deferred_tool_results.
        stored = self._session_store.load_active_session(scope)
        session_snapshot = stored.session_snapshot if stored is not None else None
        deferred_tool_results = self._resolve_pending_ask_human(
            stored=stored, dify_context=dify_context, message_id=message_id
        )

        runtime = self._request_builder.build(
            AgentAppRuntimeBuildContext(
                dify_context=dify_context,
                agent_id=agent_id,
                agent_config_snapshot_id=agent_config_snapshot_id,
                agent_soul=agent_soul,
                conversation_id=conversation_id,
                user_query=query,
                idempotency_key=message_id,
                session_snapshot=session_snapshot,
                deferred_tool_results=deferred_tool_results,
            )
        )

        create_response = self._agent_backend_client.create_run(runtime.request)
        terminal = self._consume_stream(create_response.run_id, queue_manager=queue_manager)

        if isinstance(terminal, AgentBackendDeferredToolCallInternalEvent):
            # ENG-635: the agent asked a human. End this turn with the question and
            # a conversation-owned HITL form; a form submission resumes the run.
            self._pause_for_ask_human(
                terminal=terminal,
                scope=scope,
                dify_context=dify_context,
                agent_soul=agent_soul,
                conversation_id=conversation_id,
                message_id=message_id,
                model_name=model_name,
                runtime=runtime,
                queue_manager=queue_manager,
            )
            return

        if not isinstance(terminal, AgentBackendRunSucceededInternalEvent):
            error = getattr(terminal, "error", None) or "Agent backend run did not complete successfully."
            raise AgentBackendError(str(error))

        answer = self._extract_answer(terminal.output)
        self._publish_answer(queue_manager=queue_manager, model_name=model_name, answer=answer)
        self._save_session(
            scope=scope,
            backend_run_id=terminal.run_id,
            snapshot=terminal.session_snapshot,
            runtime_layer_specs=extract_runtime_layer_specs(runtime.request.composition),
        )

    def _pause_for_ask_human(
        self,
        *,
        terminal: AgentBackendDeferredToolCallInternalEvent,
        scope: AgentAppSessionScope,
        dify_context: DifyRunContext,
        agent_soul: AgentSoulConfig,
        conversation_id: str,
        message_id: str,
        model_name: str,
        runtime: AgentAppRuntimeRequest,
        queue_manager: AppQueueManager,
    ) -> None:
        """End the chat turn on a dify.ask_human call: create a conversation-owned
        HITL form, persist the pause correlation, and surface the question."""
        try:
            created = create_ask_human_form(
                deferred_tool_call=terminal.deferred_tool_call,
                # Chat forms have no workflow node; key by the turn's message id.
                node_id=message_id,
                default_node_title="Agent",
                contacts=agent_soul.human.contacts,
                repository=self._build_form_repository(dify_context),
                conversation_id=conversation_id,
            )
        except AskHumanFormBuildError as error:
            raise AgentBackendError(f"Failed to build ask_human form for Agent App chat: {error}") from error

        # Persist the snapshot + correlation so a form submission can start the
        # second run with the human's answer (ENG-637/638 columns, conversation owner).
        self._save_session(
            scope=scope,
            backend_run_id=terminal.run_id,
            snapshot=terminal.session_snapshot,
            runtime_layer_specs=extract_runtime_layer_specs(runtime.request.composition),
            pending_form_id=created.form_id,
            pending_tool_call_id=terminal.deferred_tool_call.tool_call_id,
        )

        # The structured form is delivered via the HITL surface(s); the chat turn
        # ends by echoing the agent's question so the conversation reflects the ask.
        self._publish_answer(
            queue_manager=queue_manager,
            model_name=model_name,
            answer=self._ask_human_message(created.args),
        )

    def _resolve_pending_ask_human(
        self,
        *,
        stored: StoredAgentAppSession | None,
        dify_context: DifyRunContext,
        message_id: str,
    ) -> DeferredToolResultsPayload | None:
        """Build deferred_tool_results when a pending ask_human form is answered."""
        if stored is None or stored.pending_form_id is None or stored.pending_tool_call_id is None:
            return None
        outcome = resolve_ask_human_form(
            form_id=stored.pending_form_id,
            tenant_id=dify_context.tenant_id,
            node_id=message_id,
        )
        if outcome is None or outcome.deferred_result is None:
            # Form missing or still waiting — run a normal turn, no resume.
            return None
        return build_deferred_tool_results(
            tool_call_id=stored.pending_tool_call_id,
            result=outcome.deferred_result,
        )

    def _build_form_repository(self, dify_context: DifyRunContext) -> HumanInputFormRepository:
        invoke_source = dify_context.invoke_from.value
        return HumanInputFormRepositoryImpl(
            tenant_id=dify_context.tenant_id,
            app_id=dify_context.app_id,
            workflow_execution_id=None,
            invoke_source=invoke_source,
            submission_actor_id=dify_context.user_id if invoke_source in {"debugger", "explore"} else None,
        )

    @staticmethod
    def _ask_human_message(args: AskHumanToolArgs) -> str:
        parts = [args.question]
        if args.markdown:
            parts.append(args.markdown)
        return "\n\n".join(parts)

    def _consume_stream(self, run_id: str, *, queue_manager: AppQueueManager):
        terminal = None
        for public_event in self._agent_backend_client.stream_events(run_id):
            if queue_manager.is_stopped():
                self._cancel_run(run_id)
                raise GenerateTaskStoppedError()
            for internal_event in self._event_adapter.adapt(public_event):
                if queue_manager.is_stopped():
                    self._cancel_run(run_id)
                    raise GenerateTaskStoppedError()
                if internal_event.type in (
                    AgentBackendInternalEventType.RUN_STARTED,
                    AgentBackendInternalEventType.STREAM_EVENT,
                ):
                    # Stream deltas are accumulated by the backend into the
                    # terminal output; token-level forwarding is an S3 refinement.
                    if isinstance(internal_event, AgentBackendStreamInternalEvent):
                        continue
                    continue
                terminal = internal_event
                break
            if terminal is not None:
                break
        return terminal

    def _cancel_run(self, run_id: str) -> None:
        try:
            self._agent_backend_client.cancel_run(run_id)
        except Exception:
            logger.warning("Failed to cancel stopped Agent App backend run: run_id=%s", run_id, exc_info=True)

    def _publish_answer(self, *, queue_manager: AppQueueManager, model_name: str, answer: str) -> None:
        # MVP: emit the full answer as a single chunk + message-end. The chat
        # task pipeline streams the chunk over SSE and persists the message.
        publish_text_answer(queue_manager=queue_manager, model_name=model_name, answer=answer)

    def _save_session(
        self,
        *,
        scope: AgentAppSessionScope,
        backend_run_id: str,
        snapshot: Any,
        runtime_layer_specs: Any,
        pending_form_id: str | None = None,
        pending_tool_call_id: str | None = None,
    ) -> None:
        try:
            self._session_store.save_active_snapshot(
                scope=scope,
                backend_run_id=backend_run_id,
                snapshot=snapshot,
                runtime_layer_specs=runtime_layer_specs,
                pending_form_id=pending_form_id,
                pending_tool_call_id=pending_tool_call_id,
            )
        except Exception:
            logger.warning(
                "Failed to persist Agent App conversation session snapshot: "
                "tenant_id=%s app_id=%s conversation_id=%s agent_id=%s",
                scope.tenant_id,
                scope.app_id,
                scope.conversation_id,
                scope.agent_id,
                exc_info=True,
            )

    @staticmethod
    def _extract_answer(output: JsonValue) -> str:
        """Normalize the backend's terminal output to assistant text.

        Free-text Agent Apps return a plain string; if a structured output is
        configured the value is a JSON object, which we serialize so the chat
        message always has a string body.
        """
        if isinstance(output, str):
            return output
        if isinstance(output, dict):
            text = output.get("text")
            if isinstance(text, str):
                return text
            return json.dumps(output, ensure_ascii=False)
        return json.dumps(output, ensure_ascii=False)


__all__ = ["AgentAppRunner", "publish_text_answer"]
