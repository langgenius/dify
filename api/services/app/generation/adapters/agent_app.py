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
import logging
import threading
import uuid
from collections.abc import Generator, Mapping
from typing import Any

from flask import Flask, current_app

from clients.agent_backend import AgentBackendRunEventAdapter
from clients.agent_backend.factory import create_agent_backend_run_client
from configs import dify_config
from constants import UUID_NIL
from core.app.app_config.easy_ui_based_app.model_config.converter import ModelConfigConverter
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.agent_app.app_config_manager import AgentAppConfigManager
from core.app.apps.agent_app.generate_response_converter import AgentAppGenerateResponseConverter
from core.app.apps.agent_app.session_store import AgentAppWorkspaceStore
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import (
    AgentAppGenerateEntity,
    DifyRunContext,
    InvokeFrom,
    UserFrom,
)
from core.credit_usage import CreditUsageAppType
from core.ops.ops_trace_manager import TraceQueueManager
from factories import file_factory
from models import Account, App, EndUser, Message
from models.agent import (
    AgentConfigVersionKind,
)
from models.annotation_reply import AnnotationReplies, AnnotationReply
from models.enums import ConversationFromSource
from models.human_input_contracts import HumanInputFormFactory
from models.tool_runtime_contracts import WorkflowToolQueries
from services.app.generation.adapters.agent_request_builder import AgentAppRuntimeRequestBuilder
from services.app.generation.adapters.agent_runner import AgentAppRunner
from services.app.generation.agent_config import AgentAppConfigurations
from services.app.generation.errors import (
    AgentAppGeneratorError,
    AgentAppNotPublishedError,
    AgentSessionSnapshotIncompatibleError,
)
from services.app.generation.message_records import MessageBasedAppGenerator
from services.app.generation.ports import ChatRecords
from services.tools.provider_queries import ToolProviders

logger = logging.getLogger(__name__)


from services.workflow.execution.adapters.agent_v2.dify_tools_builder import WorkflowAgentDifyToolsBuilder


class AgentAppGenerator(MessageBasedAppGenerator):
    def __init__(
        self,
        *,
        tool_providers: ToolProviders,
        workflow_queries: WorkflowToolQueries,
        records: ChatRecords,
        annotations: AnnotationReplies,
        forms: HumanInputFormFactory,
        agent_configs: AgentAppConfigurations,
    ) -> None:
        super().__init__(records=records, annotations=annotations)
        self._tool_providers = tool_providers
        self._workflow_queries = workflow_queries
        self._forms = forms
        self._agent_configs = agent_configs

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
        raw_files = args.get("files") or []

        conversation = None
        conversation_id = args.get("conversation_id")
        if conversation_id:
            conversation = self._records.conversation(
                app_id=app_model.id,
                conversation_id=conversation_id,
                account_id=user.id if isinstance(user, Account) else None,
                end_user_id=user.id if isinstance(user, EndUser) else None,
            )

        # New conversations use the current Agent generation. Existing
        # conversations use the immutable generation named by their Binding.
        config = self._agent_configs.resolve(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            account_id=user.id if isinstance(user, Account) else None,
            debug=invoke_from == InvokeFrom.DEBUGGER,
            draft_type=args.get("draft_type"),
            conversation_id=conversation.id if conversation else None,
        )

        # Build the EasyUI-shaped config from the Agent Soul so the chat pipeline
        # can persist usage; the answer itself comes from the agent backend.
        app_model_config = self._get_app_model_config(app_model) if app_model.app_model_config_id else None
        annotation_reply = (
            self._records.annotation_config(tenant_id=app_model.tenant_id, app_id=app_model.id)
            if app_model_config
            else None
        )
        app_config = AgentAppConfigManager.get_app_config(
            app_model=app_model,
            agent_soul=config.soul,
            annotation_reply=annotation_reply,
            app_model_config=app_model_config,
            conversation=conversation,
        )
        model_conf = ModelConfigConverter.convert(app_config)
        with self._bind_file_access_scope(tenant_id=app_model.tenant_id, user=user, invoke_from=invoke_from):
            file_upload_config = (
                FileUploadConfigManager.convert(app_config.app_model_config_dict, is_vision=True) if raw_files else None
            )
            file_objs = (
                file_factory.build_from_mappings(
                    mappings=raw_files,
                    tenant_id=app_model.tenant_id,
                    config=file_upload_config,
                    access_controller=self._file_access_controller,
                )
                if raw_files and file_upload_config is not None
                else []
            )

        trace_manager = TraceQueueManager(app_model.id, user.id if isinstance(user, Account) else user.session_id)
        application_generate_entity = AgentAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            model_conf=model_conf,
            file_upload_config=file_upload_config,
            conversation_id=conversation.id if conversation else None,
            inputs=self._prepare_user_inputs(
                user_inputs=inputs, variables=app_config.variables, tenant_id=app_model.tenant_id
            ),
            query=query,
            files=list(file_objs),
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
            agent_id=config.agent_id,
            agent_config_snapshot_id=config.version_id,
            agent_config_version_kind=config.version_kind,
            agent_session_scope_config_version_id=config.version_id,
            agent_llm_gateway_enabled=True,
        )

        conversation, message = self._init_generate_records(
            application_generate_entity,
            conversation,
        )

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
        form_id: str,
        invoke_from: InvokeFrom,
    ) -> None:
        """Resume an Agent App conversation after a submitted ask_human HITL form.

        ENG-635: triggered by a background task (not an HTTP request). Runs one
        blocking turn with no user query; the runner threads the human's reply
        into the agent run as deferred_tool_results and the assistant answer is
        persisted to the conversation. Live streaming to a reconnected client is
        out of scope here — the message is persisted and can be re-fetched.
        """
        conversation = self._records.conversation(
            app_id=app_model.id,
            conversation_id=conversation_id,
            account_id=user.id if isinstance(user, Account) else None,
            end_user_id=user.id if isinstance(user, EndUser) else None,
        )
        config = self._agent_configs.resolve(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            account_id=user.id if isinstance(user, Account) else None,
            debug=invoke_from == InvokeFrom.DEBUGGER,
            draft_type=None,
            conversation_id=conversation.id,
            form_id=form_id,
        )

        app_model_config = self._get_app_model_config(app_model) if app_model.app_model_config_id else None
        annotation_reply = (
            self._records.annotation_config(tenant_id=app_model.tenant_id, app_id=app_model.id)
            if app_model_config
            else None
        )

        app_config = AgentAppConfigManager.get_app_config(
            app_model=app_model,
            agent_soul=config.soul,
            annotation_reply=annotation_reply,
            app_model_config=app_model_config,
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
        paused_query = self._records.latest_query(
            tenant_id=app_model.tenant_id, app_id=app_model.id, conversation_id=conversation.id
        )
        resume_query = paused_query or "(resumed)"

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
            agent_id=config.agent_id,
            agent_config_snapshot_id=config.version_id,
            agent_config_version_kind=config.version_kind,
            agent_session_scope_config_version_id=config.version_id,
            agent_llm_gateway_enabled=True,
        )

        conversation, message = self._init_generate_records(
            application_generate_entity,
            conversation,
        )

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
                app_config = application_generate_entity.app_config
                app_record, conversation, message = self._records.load(
                    tenant_id=app_config.tenant_id,
                    app_id=app_config.app_id,
                    conversation_id=conversation_id,
                    message_id=message_id,
                )
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
                    handled, query, annotation_reply = self._run_input_guards(
                        application_generate_entity=application_generate_entity,
                        app_model=app_record,
                        message=message,
                        queue_manager=queue_manager,
                    )
                    if annotation_reply:
                        from core.app.entities.queue_entities import QueueAnnotationReplyEvent
                        from services.app.generation.adapters.agent_runner import publish_text_answer

                        queue_manager.publish(
                            QueueAnnotationReplyEvent(message_annotation_id=annotation_reply.id),
                            PublishFrom.APPLICATION_MANAGER,
                        )
                        publish_text_answer(
                            queue_manager=queue_manager,
                            model_name=application_generate_entity.model_conf.model,
                            answer=annotation_reply.content,
                            user_query=query,
                        )
                    if handled:
                        return

                dify_context = DifyRunContext(
                    tenant_id=app_config.tenant_id,
                    app_id=app_config.app_id,
                    user_id=application_generate_entity.user_id,
                    user_from=user_from,
                    invoke_from=application_generate_entity.invoke_from,
                    app_type=CreditUsageAppType.AGENT_V2,
                )
                config = self._agent_configs.version(
                    tenant_id=app_config.tenant_id,
                    app_id=app_config.app_id,
                    agent_id=application_generate_entity.agent_id,
                    version_id=application_generate_entity.agent_config_snapshot_id,
                    version_kind=application_generate_entity.agent_config_version_kind,
                    account_id=application_generate_entity.user_id if user_from == UserFrom.ACCOUNT else None,
                )

                runner = self._build_runner()
                image_detail_config = (
                    application_generate_entity.file_upload_config.image_config.detail
                    if (
                        application_generate_entity.file_upload_config
                        and application_generate_entity.file_upload_config.image_config
                    )
                    else None
                )
                runner.run(
                    dify_context=dify_context,
                    agent_id=application_generate_entity.agent_id,
                    agent_config_snapshot_id=application_generate_entity.agent_config_snapshot_id,
                    agent_config_version_kind=application_generate_entity.agent_config_version_kind,
                    agent_soul=config.soul,
                    home_snapshot_id=config.home_snapshot_id,
                    conversation_id=conversation.id,
                    query=query,
                    message_id=message.id,
                    model_name=application_generate_entity.model_conf.model,
                    queue_manager=queue_manager,
                    files=list(application_generate_entity.files),
                    image_detail_config=image_detail_config,
                    session_scope_snapshot_id=application_generate_entity.agent_session_scope_config_version_id,
                    build_draft_id=(
                        application_generate_entity.agent_config_snapshot_id
                        if application_generate_entity.agent_config_version_kind == AgentConfigVersionKind.BUILD_DRAFT
                        else None
                    ),
                )
            except GenerateTaskStoppedError:
                pass
            except AgentSessionSnapshotIncompatibleError as error:
                logger.info(
                    "Agent App session snapshot no longer matches the current composition",
                    extra={
                        "agent_id": application_generate_entity.agent_id,
                        "conversation_id": conversation_id,
                    },
                )
                queue_manager.publish_error(error, PublishFrom.APPLICATION_MANAGER)
            except Exception as e:
                logger.exception("Unknown Error in Agent App generate worker")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)

    @staticmethod
    def _require_query(args: Mapping[str, Any]) -> str:
        query = args.get("query")
        if not isinstance(query, str) or not query.strip():
            raise AgentAppGeneratorError("query is required")
        return query.replace("\x00", "")

    def _build_runner(self) -> AgentAppRunner:
        return AgentAppRunner(
            forms=self._forms,
            records=self._records,
            request_builder=AgentAppRuntimeRequestBuilder(
                dify_tools_builder=WorkflowAgentDifyToolsBuilder(
                    tool_providers=self._tool_providers, workflow_queries=self._workflow_queries
                )
            ),
            agent_backend_client=create_agent_backend_run_client(
                base_url=dify_config.AGENT_BACKEND_BASE_URL,
                api_token=dify_config.AGENT_BACKEND_API_TOKEN,
                use_fake=dify_config.AGENT_BACKEND_USE_FAKE,
                fake_scenario=dify_config.AGENT_BACKEND_FAKE_SCENARIO,
                stream_read_timeout_seconds=dify_config.AGENT_BACKEND_STREAM_READ_TIMEOUT_SECONDS,
                stream_max_reconnects=dify_config.AGENT_BACKEND_STREAM_MAX_RECONNECTS,
            ),
            event_adapter=AgentBackendRunEventAdapter(),
            session_store=AgentAppWorkspaceStore(),
            text_delta_debounce_seconds=dify_config.AGENT_APP_TEXT_DELTA_DEBOUNCE_SECONDS,
        )

    def _run_input_guards(
        self,
        *,
        application_generate_entity: AgentAppGenerateEntity,
        app_model: App,
        message: Message,
        queue_manager: AppQueueManager,
    ) -> tuple[bool, str, AnnotationReply | None]:
        """Apply input moderation + annotation reply before the backend call.

        Returns ``(handled, query, annotation_reply)``. Annotation output is
        published by the caller after the hit repository commits.
        """
        from core.moderation.base import ModerationError
        from core.moderation.input_moderation import InputModeration
        from services.app.generation.adapters.agent_runner import publish_text_answer

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
            return True, query, None

        # annotation reply: a matching annotation answers the turn deterministically.
        if query:
            annotation_reply = self._annotations.query(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                message_id=message.id,
                query=query,
                user_id=application_generate_entity.user_id,
                from_source=ConversationFromSource.CONSOLE
                if application_generate_entity.invoke_from.runs_as_account()
                else ConversationFromSource.API,
            )
            if annotation_reply:
                return True, query, annotation_reply

        return False, query, None


__all__ = ["AgentAppGenerator", "AgentAppGeneratorError", "AgentAppNotPublishedError"]
