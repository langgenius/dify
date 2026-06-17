import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import select

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.base_app_runner import AppRunner
from core.app.apps.completion.app_config_manager import CompletionAppConfig
from core.app.apps.completion.graph_event_adapter import CompletionGraphEventAdapter
from core.app.apps.completion.runtime_workflow_builder import RuntimeCompletionWorkflowBuilder
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.workflow_app_runner import init_graph
from core.app.entities.app_invoke_entities import CompletionAppGenerateEntity, UserFrom
from core.entities import DEFAULT_PLUGIN_ID
from core.moderation.base import ModerationError
from core.workflow.node_runtime import DIFY_BEFORE_LLM_INVOKE_KEY
from core.workflow.system_variables import build_bootstrap_variables, build_system_variables
from core.workflow.variable_pool_initializer import add_node_inputs_to_pool, add_variables_to_pool
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_database import db
from extensions.ext_hosting_provider import hosting_configuration
from extensions.ext_redis import redis_client
from graphon.graph_engine.command_channels import RedisChannel
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent, PromptMessage
from graphon.runtime import GraphRuntimeState, VariablePool
from models.model import App, Message
from models.provider import ProviderType


@dataclass(frozen=True, slots=True)
class ModeratedCompletionInputs:
    stopped: bool
    inputs: Mapping[str, Any]
    query: str


class CompletionWorkflowRunner(AppRunner):
    """Run Completion through a transient WorkflowEntry graph."""

    _runtime_workflow_builder: RuntimeCompletionWorkflowBuilder

    def __init__(self, runtime_workflow_builder: RuntimeCompletionWorkflowBuilder | None = None) -> None:
        self._runtime_workflow_builder = runtime_workflow_builder or RuntimeCompletionWorkflowBuilder()

    def run(
        self,
        application_generate_entity: CompletionAppGenerateEntity,
        queue_manager: AppQueueManager,
        message: Message,
    ) -> None:
        app_config = cast(CompletionAppConfig, application_generate_entity.app_config)
        app_record = self._get_app(app_config.app_id)

        moderation_result = self._run_input_moderation(
            app_record=app_record,
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            message=message,
        )
        if moderation_result.stopped:
            return

        runtime_workflow = self._runtime_workflow_builder.build(app_model=app_record, app_config=app_config)
        variable_pool = self._build_variable_pool(
            application_generate_entity=application_generate_entity,
            message=message,
            workflow_id=runtime_workflow.workflow_id,
            root_node_id=runtime_workflow.root_node_id,
            inputs=moderation_result.inputs,
            query=moderation_result.query,
        )
        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
        user_from = self._resolve_user_from(application_generate_entity)
        extra_context: dict[str, Any] = {}
        if self._should_check_hosting_moderation(application_generate_entity):
            extra_context[DIFY_BEFORE_LLM_INVOKE_KEY] = self._build_hosting_moderation_hook(
                application_generate_entity=application_generate_entity,
                queue_manager=queue_manager,
            )

        graph = init_graph(
            app_id=app_config.app_id,
            graph_config=runtime_workflow.graph_dict,
            graph_runtime_state=graph_runtime_state,
            user_from=user_from,
            invoke_from=application_generate_entity.invoke_from,
            workflow_id=runtime_workflow.workflow_id,
            tenant_id=app_config.tenant_id,
            user_id=application_generate_entity.user_id,
            root_node_id=runtime_workflow.root_node_id,
            trace_session_id=application_generate_entity.extras.get("trace_session_id"),
            call_depth=application_generate_entity.call_depth,
            extra_context=extra_context,
        )

        queue_manager.graph_runtime_state = graph_runtime_state
        command_channel = RedisChannel(redis_client, f"workflow:{application_generate_entity.task_id}:commands")
        workflow_entry = WorkflowEntry(
            tenant_id=app_config.tenant_id,
            app_id=app_config.app_id,
            workflow_id=runtime_workflow.workflow_id,
            graph_config=runtime_workflow.graph_dict,
            graph=graph,
            user_id=application_generate_entity.user_id,
            user_from=user_from,
            invoke_from=application_generate_entity.invoke_from,
            call_depth=application_generate_entity.call_depth,
            variable_pool=variable_pool,
            graph_runtime_state=graph_runtime_state,
            command_channel=command_channel,
        )
        adapter = CompletionGraphEventAdapter(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
        )
        for event in workflow_entry.run():
            adapter.handle_event(event)

    def _get_app(self, app_id: str) -> App:
        app_record = db.session.scalar(select(App).where(App.id == app_id))
        if not app_record:
            raise ValueError("App not found")
        return app_record

    def _run_input_moderation(
        self,
        *,
        app_record: App,
        application_generate_entity: CompletionAppGenerateEntity,
        queue_manager: AppQueueManager,
        message: Message,
    ) -> ModeratedCompletionInputs:
        app_config = cast(CompletionAppConfig, application_generate_entity.app_config)
        prompt_messages, _ = self.organize_prompt_messages(
            app_record=app_record,
            model_config=application_generate_entity.model_conf,
            prompt_template_entity=app_config.prompt_template,
            inputs=application_generate_entity.inputs,
            files=application_generate_entity.files,
            query=application_generate_entity.query,
            image_detail_config=self._resolve_image_detail_config(application_generate_entity),
        )

        try:
            _, inputs, query = self.moderation_for_inputs(
                app_id=app_record.id,
                tenant_id=app_config.tenant_id,
                app_generate_entity=application_generate_entity,
                inputs=application_generate_entity.inputs,
                query=application_generate_entity.query or "",
                message_id=message.id,
            )
        except ModerationError as exc:
            self.direct_output(
                queue_manager=queue_manager,
                app_generate_entity=application_generate_entity,
                prompt_messages=prompt_messages,
                text=str(exc),
                stream=application_generate_entity.stream,
            )
            return ModeratedCompletionInputs(
                stopped=True,
                inputs=application_generate_entity.inputs,
                query=application_generate_entity.query or "",
            )

        return ModeratedCompletionInputs(stopped=False, inputs=inputs, query=query)

    def _build_hosting_moderation_hook(
        self,
        *,
        application_generate_entity: CompletionAppGenerateEntity,
        queue_manager: AppQueueManager,
    ) -> Callable[[Sequence[PromptMessage]], None]:
        def check(prompt_messages: Sequence[PromptMessage]) -> None:
            if self.check_hosting_moderation(
                application_generate_entity=application_generate_entity,
                queue_manager=queue_manager,
                prompt_messages=list(prompt_messages),
            ):
                raise GenerateTaskStoppedError()

        return check

    def _should_check_hosting_moderation(self, application_generate_entity: CompletionAppGenerateEntity) -> bool:
        moderation_config = hosting_configuration.moderation_config
        openai_provider_name = f"{DEFAULT_PLUGIN_ID}/openai/openai"
        hosting_provider = hosting_configuration.provider_map.get(openai_provider_name)
        if not (
            moderation_config
            and moderation_config.enabled is True
            and hosting_provider
            and hosting_provider.enabled is True
            and hosting_provider.credentials is not None
        ):
            return False

        model_config = application_generate_entity.model_conf
        provider_model_bundle = getattr(model_config, "provider_model_bundle", None)
        configuration = getattr(provider_model_bundle, "configuration", None)
        using_provider_type = getattr(configuration, "using_provider_type", None)
        return (
            using_provider_type == ProviderType.SYSTEM
            and getattr(model_config, "provider", None) in moderation_config.providers
        )

    def _build_variable_pool(
        self,
        *,
        application_generate_entity: CompletionAppGenerateEntity,
        message: Message,
        workflow_id: str,
        root_node_id: str,
        inputs: Mapping[str, Any],
        query: str,
    ) -> VariablePool:
        variable_pool = VariablePool()
        system_inputs = build_system_variables(
            files=application_generate_entity.files,
            user_id=application_generate_entity.user_id,
            app_id=application_generate_entity.app_config.app_id,
            workflow_id=workflow_id,
            workflow_execution_id=application_generate_entity.task_id,
            timestamp=int(time.time()),
            query=query,
            conversation_id=getattr(message, "conversation_id", None),
        )
        add_variables_to_pool(
            variable_pool,
            build_bootstrap_variables(system_variables=system_inputs, environment_variables=[]),
        )
        add_node_inputs_to_pool(variable_pool, node_id=root_node_id, inputs=inputs)
        return variable_pool

    @staticmethod
    def _resolve_user_from(application_generate_entity: CompletionAppGenerateEntity) -> UserFrom:
        if application_generate_entity.invoke_from.runs_as_account():
            return UserFrom.ACCOUNT
        return UserFrom.END_USER

    @staticmethod
    def _resolve_image_detail_config(
        application_generate_entity: CompletionAppGenerateEntity,
    ) -> ImagePromptMessageContent.DETAIL:
        file_upload_config = application_generate_entity.file_upload_config
        if file_upload_config and file_upload_config.image_config:
            return file_upload_config.image_config.detail or ImagePromptMessageContent.DETAIL.LOW
        return ImagePromptMessageContent.DETAIL.LOW
