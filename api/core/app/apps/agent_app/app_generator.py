"""Agent App generator: orchestrate one conversation turn for an Agent App.

Mirrors the agent_chat generator (conversation + message + queue + streamed
response over the EasyUI chat pipeline), but the backing config comes from the
bound Agent Soul and the answer is produced by ``AgentAppRunner`` calling the
dify-agent backend rather than an in-process LLM/ReAct loop.
"""

from __future__ import annotations

import contextvars
import logging
import threading
import uuid
from collections.abc import Generator, Mapping
from typing import Any

from flask import Flask, current_app
from sqlalchemy import select

from clients.agent_backend import AgentBackendRunEventAdapter
from clients.agent_backend.factory import create_agent_backend_run_client
from configs import dify_config
from constants import UUID_NIL
from core.app.app_config.easy_ui_based_app.model_config.converter import ModelConfigConverter
from core.app.apps.agent_app.app_config_manager import AgentAppConfigManager
from core.app.apps.agent_app.app_runner import AgentAppRunner
from core.app.apps.agent_app.generate_response_converter import AgentAppGenerateResponseConverter
from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeRequestBuilder
from core.app.apps.agent_app.session_store import AgentAppRuntimeSessionStore
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import (
    AgentAppGenerateEntity,
    DifyRunContext,
    InvokeFrom,
    UserFrom,
)
from core.app.llm.model_access import build_dify_model_access
from core.ops.ops_trace_manager import TraceQueueManager
from extensions.ext_database import db
from models import Account, App, EndUser, Message
from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource, AgentStatus
from models.agent_config_entities import AgentSoulConfig
from services.conversation_service import ConversationService

logger = logging.getLogger(__name__)


class AgentAppGeneratorError(ValueError):
    """Raised when an Agent App turn cannot be set up."""


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

        query = args.get("query")
        if not isinstance(query, str) or not query.strip():
            raise AgentAppGeneratorError("query is required")
        query = query.replace("\x00", "")
        inputs = args["inputs"]

        # Resolve the bound roster Agent + its published Agent Soul snapshot.
        agent, snapshot, agent_soul = self._resolve_agent(app_model)

        conversation = None
        conversation_id = args.get("conversation_id")
        if conversation_id:
            conversation = ConversationService.get_conversation(
                app_model=app_model, conversation_id=conversation_id, user=user
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
            agent_config_snapshot_id=snapshot.id,
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
    ) -> None:
        from libs.flask_utils import preserve_flask_contexts

        with preserve_flask_contexts(flask_app, context_vars=context):
            try:
                conversation = self._get_conversation(conversation_id)
                message = self._get_message(message_id)
                app_config = application_generate_entity.app_config

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

                dify_context = DifyRunContext(
                    tenant_id=app_config.tenant_id,
                    app_id=app_config.app_id,
                    user_id=application_generate_entity.user_id,
                    user_from=user_from,
                    invoke_from=application_generate_entity.invoke_from,
                )
                credentials_provider, _ = build_dify_model_access(dify_context)
                _, _, agent_soul = self._resolve_agent_by_id(
                    tenant_id=app_config.tenant_id,
                    agent_id=application_generate_entity.agent_id,
                    snapshot_id=application_generate_entity.agent_config_snapshot_id,
                )

                runner = AgentAppRunner(
                    request_builder=AgentAppRuntimeRequestBuilder(credentials_provider=credentials_provider),
                    agent_backend_client=create_agent_backend_run_client(
                        base_url=dify_config.AGENT_BACKEND_BASE_URL,
                        use_fake=dify_config.AGENT_BACKEND_USE_FAKE,
                        fake_scenario=dify_config.AGENT_BACKEND_FAKE_SCENARIO,
                    ),
                    event_adapter=AgentBackendRunEventAdapter(),
                    session_store=AgentAppRuntimeSessionStore(),
                )
                runner.run(
                    dify_context=dify_context,
                    agent_id=application_generate_entity.agent_id,
                    agent_config_snapshot_id=application_generate_entity.agent_config_snapshot_id,
                    agent_soul=agent_soul,
                    conversation_id=conversation.id,
                    query=query,
                    message_id=message.id,
                    model_name=application_generate_entity.model_conf.model,
                    queue_manager=queue_manager,
                )
            except GenerateTaskStoppedError:
                pass
            except Exception as e:
                logger.exception("Unknown Error in Agent App generate worker")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            finally:
                db.session.close()

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
        query = application_generate_entity.query

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
            publish_text_answer(queue_manager=queue_manager, model_name=model_name, answer=str(e))
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
                publish_text_answer(queue_manager=queue_manager, model_name=model_name, answer=annotation_reply.content)
                return True, query

        return False, query

    def _resolve_agent(self, app_model: App) -> tuple[Agent, AgentConfigSnapshot, AgentSoulConfig]:
        agent = db.session.scalar(
            select(Agent).where(
                Agent.app_id == app_model.id,
                Agent.scope == AgentScope.ROSTER,
                Agent.source == AgentSource.AGENT_APP,
                Agent.status == AgentStatus.ACTIVE,
            )
        )
        if agent is None:
            raise AgentAppGeneratorError("Agent App has no bound Agent")
        return self._resolve_agent_by_id(
            tenant_id=app_model.tenant_id, agent_id=agent.id, snapshot_id=agent.active_config_snapshot_id
        )

    @staticmethod
    def _resolve_agent_by_id(
        *, tenant_id: str, agent_id: str, snapshot_id: str | None
    ) -> tuple[Agent, AgentConfigSnapshot, AgentSoulConfig]:
        agent = db.session.scalar(select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id))
        if agent is None:
            raise AgentAppGeneratorError("Agent not found")
        if not snapshot_id:
            raise AgentAppGeneratorError("Agent has no published version")
        snapshot = db.session.scalar(select(AgentConfigSnapshot).where(AgentConfigSnapshot.id == snapshot_id))
        if snapshot is None:
            raise AgentAppGeneratorError("Agent published version not found")
        agent_soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
        return agent, snapshot, agent_soul


__all__ = ["AgentAppGenerator", "AgentAppGeneratorError"]
