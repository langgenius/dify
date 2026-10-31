import logging
from collections.abc import Callable
from typing import cast

from core.agent.entities import AgentEntity
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity
from core.app.entities.queue_entities import QueueAnnotationReplyEvent
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.moderation.base import ModerationError
from graphon.model_runtime.entities.llm_entities import LLMMode
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelPropertyKey
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from models import Account
from models.annotation_reply import AnnotationReplies
from models.enums import ConversationFromSource
from models.model import App, Conversation, Message
from services.agent.chat.cot_chat_runner import CotChatAgentRunner
from services.agent.chat.cot_completion_runner import CotCompletionAgentRunner
from services.agent.chat.function_call_runner import FunctionCallAgentRunner
from services.agent.chat.ports import AgentDatasetTools, AgentToolInvoker
from services.app.generation.adapters.base_runner import AppRunner
from services.app.generation.ports import AgentMessageRecords
from services.workflow.execution.ports import WorkflowRuntime

logger = logging.getLogger(__name__)


class AgentChatAppRunner(AppRunner):
    """
    Agent Application Runner
    """

    def __init__(
        self, *, records: AgentMessageRecords, dataset_tools: AgentDatasetTools, tool_invoker: AgentToolInvoker
    ):
        super().__init__(records=records)
        self._dataset_tools = dataset_tools
        self._tool_invoker = tool_invoker

    def run(
        self,
        application_generate_entity: AgentChatAppGenerateEntity,
        queue_manager: AppQueueManager,
        conversation: Conversation,
        message: Message,
        app_record: App,
        annotations: AnnotationReplies,
        *,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory] | None = None,
        workflow_runtime: WorkflowRuntime | None = None,
    ):
        """Run the assistant application with bounded explicit transactions.

        Persistence and dataset adapters own their own bounded transactions.

        :param application_generate_entity: application generate entity
        :param queue_manager: application queue manager
        :param conversation: conversation
        :param message: message
        :return:
        """
        app_config = application_generate_entity.app_config
        app_config = cast(AgentChatAppConfig, app_config)
        inputs = application_generate_entity.inputs
        query = application_generate_entity.query
        files = application_generate_entity.files

        memory = None
        if application_generate_entity.conversation_id:
            # get memory of conversation (read-only)
            model_instance = ModelInstance(
                provider_model_bundle=application_generate_entity.model_conf.provider_model_bundle,
                model=application_generate_entity.model_conf.model,
            )

            memory = TokenBufferMemory(conversation=conversation, model_instance=model_instance)

        # organize all inputs and template to prompt messages
        # Include: prompt template, inputs, query(optional), files(optional)
        #          memory(optional)
        prompt_messages, _ = self.organize_prompt_messages(
            app_record=app_record,
            model_config=application_generate_entity.model_conf,
            prompt_template_entity=app_config.prompt_template,
            inputs=dict(inputs),
            files=list(files),
            query=query,
            memory=memory,
        )

        # moderation
        try:
            # process sensitive_word_avoidance
            _, inputs, query = self.moderation_for_inputs(
                app_id=app_record.id,
                tenant_id=app_config.tenant_id,
                app_generate_entity=application_generate_entity,
                inputs=dict(inputs),
                query=query or "",
                message_id=message.id,
            )
        except ModerationError as e:
            self.direct_output(
                queue_manager=queue_manager,
                app_generate_entity=application_generate_entity,
                prompt_messages=prompt_messages,
                text=str(e),
                stream=application_generate_entity.stream,
            )
            return

        if query:
            # annotation reply
            annotation_reply = annotations.query(
                tenant_id=app_record.tenant_id,
                app_id=app_record.id,
                message_id=message.id,
                query=query,
                user_id=application_generate_entity.user_id,
                from_source=ConversationFromSource.CONSOLE
                if application_generate_entity.invoke_from.runs_as_account()
                else ConversationFromSource.API,
            )

            if annotation_reply:
                queue_manager.publish(
                    QueueAnnotationReplyEvent(message_annotation_id=annotation_reply.id),
                    PublishFrom.APPLICATION_MANAGER,
                )

                self.direct_output(
                    queue_manager=queue_manager,
                    app_generate_entity=application_generate_entity,
                    prompt_messages=prompt_messages,
                    text=annotation_reply.content,
                    stream=application_generate_entity.stream,
                )
                return

        # fill in variable inputs from external data tools if exists
        external_data_tools = app_config.external_data_variables
        if external_data_tools:
            inputs = self.fill_in_inputs_from_external_data_tools(
                tenant_id=app_record.tenant_id,
                app_id=app_record.id,
                external_data_tools=external_data_tools,
                inputs=inputs,
                query=query,
            )

        # reorganize all inputs and template to prompt messages
        # Include: prompt template, inputs, query(optional), files(optional)
        #          memory(optional), external data, dataset context(optional)
        prompt_messages, _ = self.organize_prompt_messages(
            app_record=app_record,
            model_config=application_generate_entity.model_conf,
            prompt_template_entity=app_config.prompt_template,
            inputs=dict(inputs),
            files=list(files),
            query=query,
            memory=memory,
        )

        # check hosting moderation
        hosting_moderation_result = self.check_hosting_moderation(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            prompt_messages=prompt_messages,
        )

        if hosting_moderation_result:
            return

        agent_entity = app_config.agent
        assert agent_entity is not None

        # init model instance
        model_instance = ModelInstance(
            provider_model_bundle=application_generate_entity.model_conf.provider_model_bundle,
            model=application_generate_entity.model_conf.model,
        )
        prompt_message, _ = self.organize_prompt_messages(
            app_record=app_record,
            model_config=application_generate_entity.model_conf,
            prompt_template_entity=app_config.prompt_template,
            inputs=dict(inputs),
            files=list(files),
            query=query,
            memory=memory,
        )

        # change function call strategy based on LLM model
        llm_model = cast(LargeLanguageModel, model_instance.model_type_instance)
        model_schema = llm_model.get_model_schema(model_instance.model_name, model_instance.credentials)
        if not model_schema:
            raise ValueError("Model schema not found")

        if {ModelFeature.MULTI_TOOL_CALL, ModelFeature.TOOL_CALL}.intersection(model_schema.features or []):
            agent_entity.strategy = AgentEntity.Strategy.FUNCTION_CALLING
        runner_cls: type[FunctionCallAgentRunner] | type[CotChatAgentRunner] | type[CotCompletionAgentRunner]
        # start agent runner
        if agent_entity.strategy == AgentEntity.Strategy.CHAIN_OF_THOUGHT:
            # check LLM mode
            if model_schema.model_properties.get(ModelPropertyKey.MODE) == LLMMode.CHAT:
                runner_cls = CotChatAgentRunner
            elif model_schema.model_properties.get(ModelPropertyKey.MODE) == LLMMode.COMPLETION:
                runner_cls = CotCompletionAgentRunner
            else:
                raise ValueError(f"Invalid LLM mode: {model_schema.model_properties.get(ModelPropertyKey.MODE)}")
        elif agent_entity.strategy == AgentEntity.Strategy.FUNCTION_CALLING:
            runner_cls = FunctionCallAgentRunner
        else:
            raise ValueError(f"Invalid agent strategy: {agent_entity.strategy}")

        runner = runner_cls(
            records=self._records,
            dataset_tools=self._dataset_tools,
            tool_invoker=self._tool_invoker,
            draft_variable_saver=draft_variable_saver,
            workflow_runtime=workflow_runtime,
            tenant_id=app_config.tenant_id,
            application_generate_entity=application_generate_entity,
            conversation=conversation,
            app_config=app_config,
            model_config=application_generate_entity.model_conf,
            config=agent_entity,
            queue_manager=queue_manager,
            message=message,
            user_id=application_generate_entity.user_id,
            memory=memory,
            prompt_messages=prompt_message,
            model_instance=model_instance,
        )

        invoke_result = runner.run(
            message=message,
            query=query,
            inputs=inputs,
        )

        # handle invoke result
        self._handle_invoke_result(
            invoke_result=invoke_result,
            queue_manager=queue_manager,
            stream=application_generate_entity.stream,
            agent=True,
            message_id=message.id,
            user_id=application_generate_entity.user_id,
            tenant_id=app_config.tenant_id,
        )
