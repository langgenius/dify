import logging
from typing import cast

from sqlalchemy import select

from core.agent.cot_chat_agent_runner import CotChatAgentRunner
from core.agent.cot_completion_agent_runner import CotCompletionAgentRunner
from core.agent.entities import AgentEntity
from core.agent.fc_agent_runner import FunctionCallAgentRunner
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.base_app_runner import AppRunner
from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity
from core.app.entities.queue_entities import QueueAnnotationReplyEvent
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.entities.model_entities import ModelFeature, ModelPropertyKey
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.moderation.base import ModerationError
from extensions.ext_database import db
from models.model import App, Conversation, Message

logger = logging.getLogger(__name__)


class AgentChatAppRunner(AppRunner):
    """
    Agent Application Runner
    """

    def run(
        self,
        application_generate_entity: AgentChatAppGenerateEntity,
        queue_manager: AppQueueManager,
        conversation: Conversation,
        message: Message,
    ):
        """
        Run assistant application
        """
        app_config = application_generate_entity.app_config
        app_config = cast(AgentChatAppConfig, app_config)

        app_stmt = select(App).where(App.id == app_config.app_id)
        app_record = db.session.scalar(app_stmt)
        if not app_record:
            raise ValueError("App not found")

        # -------------------------
        # Base inputs
        # -------------------------
        inputs = dict(application_generate_entity.inputs)
        query = application_generate_entity.query
        files = application_generate_entity.files

        # -------------------------
        # Inject agent media (NEW)
        # -------------------------
        if application_generate_entity.media:
            inputs["_media"] = [
                {
                    "file_id": m.file_id,
                    "filename": m.filename,
                    "content_type": m.content_type,
                    "size": m.size,
                    "duration": m.duration,
                }
                for m in application_generate_entity.media
            ]

        # -------------------------
        # Memory
        # -------------------------
        memory = None
        if application_generate_entity.conversation_id:
            model_instance = ModelInstance(
                provider_model_bundle=application_generate_entity.model_conf.provider_model_bundle,
                model=application_generate_entity.model_conf.model,
            )
            memory = TokenBufferMemory(conversation=conversation, model_instance=model_instance)

        # -------------------------
        # Prompt messages (initial)
        # -------------------------
        prompt_messages, _ = self.organize_prompt_messages(
            app_record=app_record,
            model_config=application_generate_entity.model_conf,
            prompt_template_entity=app_config.prompt_template,
            inputs=dict(inputs),
            files=list(files),
            query=query,
            memory=memory,
        )

        # -------------------------
        # Moderation
        # -------------------------
        try:
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

        # -------------------------
        # Annotation reply
        # -------------------------
        if query:
            annotation_reply = self.query_app_annotations_to_reply(
                app_record=app_record,
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

                self.direct_output(
                    queue_manager=queue_manager,
                    app_generate_entity=application_generate_entity,
                    prompt_messages=prompt_messages,
                    text=annotation_reply.content,
                    stream=application_generate_entity.stream,
                )
                return

        # -------------------------
        # External data tools
        # -------------------------
        external_data_tools = app_config.external_data_variables
        if external_data_tools:
            inputs = self.fill_in_inputs_from_external_data_tools(
                tenant_id=app_record.tenant_id,
                app_id=app_record.id,
                external_data_tools=external_data_tools,
                inputs=inputs,
                query=query,
            )

        # -------------------------
        # Prompt messages (final)
        # -------------------------
        prompt_messages, _ = self.organize_prompt_messages(
            app_record=app_record,
            model_config=application_generate_entity.model_conf,
            prompt_template_entity=app_config.prompt_template,
            inputs=dict(inputs),
            files=list(files),
            query=query,
            memory=memory,
        )

        # -------------------------
        # Hosting moderation
        # -------------------------
        hosting_moderation_result = self.check_hosting_moderation(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            prompt_messages=prompt_messages,
        )
        if hosting_moderation_result:
            return

        agent_entity = app_config.agent
        assert agent_entity is not None

        # -------------------------
        # Model instance
        # -------------------------
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

        llm_model = cast(LargeLanguageModel, model_instance.model_type_instance)
        model_schema = llm_model.get_model_schema(model_instance.model, model_instance.credentials)
        if not model_schema:
            raise ValueError("Model schema not found")

        if {ModelFeature.MULTI_TOOL_CALL, ModelFeature.TOOL_CALL}.intersection(model_schema.features or []):
            agent_entity.strategy = AgentEntity.Strategy.FUNCTION_CALLING

        conversation_stmt = select(Conversation).where(Conversation.id == conversation.id)
        conversation_result = db.session.scalar(conversation_stmt)
        if conversation_result is None:
            raise ValueError("Conversation not found")

        msg_stmt = select(Message).where(Message.id == message.id)
        message_result = db.session.scalar(msg_stmt)
        if message_result is None:
            raise ValueError("Message not found")

        db.session.close()

        runner_cls: type[FunctionCallAgentRunner | CotChatAgentRunner | CotCompletionAgentRunner]

        if agent_entity.strategy == AgentEntity.Strategy.CHAIN_OF_THOUGHT:
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
            tenant_id=app_config.tenant_id,
            application_generate_entity=application_generate_entity,
            conversation=conversation_result,
            app_config=app_config,
            model_config=application_generate_entity.model_conf,
            config=agent_entity,
            queue_manager=queue_manager,
            message=message_result,
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

        self._handle_invoke_result(
            invoke_result=invoke_result,
            queue_manager=queue_manager,
            stream=application_generate_entity.stream,
            agent=True,
            message_id=message.id,
            user_id=application_generate_entity.user_id,
            tenant_id=app_config.tenant_id,
        )
