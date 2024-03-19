import logging
from typing import Optional

from core.app_runner.app_runner import AppRunner
from core.application_queue_manager import ApplicationQueueManager, PublishFrom
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.entities.application_entities import ApplicationGenerateEntity, DatasetEntity, InvokeFrom, ModelConfigEntity
from core.features.dataset_retrieval.dataset_retrieval import DatasetRetrievalFeature
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.moderation.base import ModerationException
from core.prompt.prompt_transform import AppMode
from extensions.ext_database import db
from models.model import App, Conversation, Message

logger = logging.getLogger(__name__)


class BasicApplicationRunner(AppRunner):
    """
    Basic Application Runner
    """

    def run(self, application_generate_entity: ApplicationGenerateEntity,
            queue_manager: ApplicationQueueManager,
            conversation: Conversation,
            message: Message) -> None:
        """
        Run application
        :param application_generate_entity: application generate entity
        :param queue_manager: application queue manager
        :param conversation: conversation
        :param message: message
        :return:
        """
        app_record = db.session.query(App).filter(App.id == application_generate_entity.app_id).first()
        if not app_record:
            raise ValueError("App not found")

        app_orchestration_config = application_generate_entity.app_orchestration_config_entity

        inputs = application_generate_entity.inputs
        query = application_generate_entity.query
        files = application_generate_entity.files

        # Pre-calculate the number of tokens of the prompt messages,
        # and return the rest number of tokens by model context token size limit and max token size limit.
        # If the rest number of tokens is not enough, raise exception.
        # Include: prompt template, inputs, query(optional), files(optional)
        # Not Include: memory, external data, dataset context
        self.get_pre_calculate_rest_tokens(
            app_record=app_record,
            model_config=app_orchestration_config.model_config,
            prompt_template_entity=app_orchestration_config.prompt_template,
            inputs=inputs,
            files=files,
            query=query
        )

        memory = None
        if application_generate_entity.conversation_id:
            # get memory of conversation (read-only)
            model_instance = ModelInstance(
                provider_model_bundle=app_orchestration_config.model_config.provider_model_bundle,
                model=app_orchestration_config.model_config.model
            )

            memory = TokenBufferMemory(
                conversation=conversation,
                model_instance=model_instance
            )

        # organize all inputs and template to prompt messages
        # Include: prompt template, inputs, query(optional), files(optional)
        #          memory(optional)
        prompt_messages, stop = self.organize_prompt_messages(
            app_record=app_record,
            model_config=app_orchestration_config.model_config,
            prompt_template_entity=app_orchestration_config.prompt_template,
            inputs=inputs,
            files=files,
            query=query,
            memory=memory
        )

        # moderation
        try:
            # process sensitive_word_avoidance
            _, inputs, query = self.moderation_for_inputs(
                app_id=app_record.id,
                tenant_id=application_generate_entity.tenant_id,
                app_orchestration_config_entity=app_orchestration_config,
                inputs=inputs,
                query=query,
            )
        except ModerationException as e:
            self.direct_output(
                queue_manager=queue_manager,
                app_orchestration_config=app_orchestration_config,
                prompt_messages=prompt_messages,
                text=str(e),
                stream=application_generate_entity.stream
            )
            return

        if query:
            # annotation reply
            annotation_reply = self.query_app_annotations_to_reply(
                app_record=app_record,
                message=message,
                query=query,
                user_id=application_generate_entity.user_id,
                invoke_from=application_generate_entity.invoke_from
            )

            if annotation_reply:
                queue_manager.publish_annotation_reply(
                    message_annotation_id=annotation_reply.id,
                    pub_from=PublishFrom.APPLICATION_MANAGER
                )
                self.direct_output(
                    queue_manager=queue_manager,
                    app_orchestration_config=app_orchestration_config,
                    prompt_messages=prompt_messages,
                    text=annotation_reply.content,
                    stream=application_generate_entity.stream
                )
                return

        # fill in variable inputs from external data tools if exists
        external_data_tools = app_orchestration_config.external_data_variables
        if external_data_tools:
            inputs = self.fill_in_inputs_from_external_data_tools(
                tenant_id=app_record.tenant_id,
                app_id=app_record.id,
                external_data_tools=external_data_tools,
                inputs=inputs,
                query=query
            )

        # get context from datasets
        context = None
        if app_orchestration_config.dataset and app_orchestration_config.dataset.dataset_ids:
            context = self.retrieve_dataset_context(
                tenant_id=app_record.tenant_id,
                app_record=app_record,
                queue_manager=queue_manager,
                model_config=app_orchestration_config.model_config,
                show_retrieve_source=app_orchestration_config.show_retrieve_source,
                dataset_config=app_orchestration_config.dataset,
                message=message,
                inputs=inputs,
                query=query,
                user_id=application_generate_entity.user_id,
                invoke_from=application_generate_entity.invoke_from,
                memory=memory
            )

        # reorganize all inputs and template to prompt messages
        # Include: prompt template, inputs, query(optional), files(optional)
        #          memory(optional), external data, dataset context(optional)
        prompt_messages, stop = self.organize_prompt_messages(
            app_record=app_record,
            model_config=app_orchestration_config.model_config,
            prompt_template_entity=app_orchestration_config.prompt_template,
            inputs=inputs,
            files=files,
            query=query,
            context=context,
            memory=memory
        )

        # check hosting moderation
        hosting_moderation_result = self.check_hosting_moderation(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            prompt_messages=prompt_messages
        )

        if hosting_moderation_result:
            return

        # Re-calculate the max tokens if sum(prompt_token +  max_tokens) over model token limit
        self.recalc_llm_max_tokens(
            model_config=app_orchestration_config.model_config,
            prompt_messages=prompt_messages
        )

        # Invoke model
        model_instance = ModelInstance(
            provider_model_bundle=app_orchestration_config.model_config.provider_model_bundle,
            model=app_orchestration_config.model_config.model
        )

        db.session.close()

        invoke_result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters=app_orchestration_config.model_config.parameters,
            stop=stop,
            stream=application_generate_entity.stream,
            user=application_generate_entity.user_id,
        )

        # handle invoke result
        self._handle_invoke_result(
            invoke_result=invoke_result,
            queue_manager=queue_manager,
            stream=application_generate_entity.stream
        )

    def retrieve_dataset_context(self, tenant_id: str,
                                 app_record: App,
                                 queue_manager: ApplicationQueueManager,
                                 model_config: ModelConfigEntity,
                                 dataset_config: DatasetEntity,
                                 show_retrieve_source: bool,
                                 message: Message,
                                 inputs: dict,
                                 query: str,
                                 user_id: str,
                                 invoke_from: InvokeFrom,
                                 memory: Optional[TokenBufferMemory] = None) -> Optional[str]:
        """
        Retrieve dataset context
        :param tenant_id: tenant id
        :param app_record: app record
        :param queue_manager: queue manager
        :param model_config: model config
        :param dataset_config: dataset config
        :param show_retrieve_source: show retrieve source
        :param message: message
        :param inputs: inputs
        :param query: query
        :param user_id: user id
        :param invoke_from: invoke from
        :param memory: memory
        :return:
        """
        hit_callback = DatasetIndexToolCallbackHandler(
            queue_manager,
            app_record.id,
            message.id,
            user_id,
            invoke_from
        )

        if (app_record.mode == AppMode.COMPLETION.value and dataset_config
                and dataset_config.retrieve_config.query_variable):
            query = inputs.get(dataset_config.retrieve_config.query_variable, "")

        dataset_retrieval = DatasetRetrievalFeature()
        return dataset_retrieval.retrieve(
            tenant_id=tenant_id,
            model_config=model_config,
            config=dataset_config,
            query=query,
            invoke_from=invoke_from,
            show_retrieve_source=show_retrieve_source,
            hit_callback=hit_callback,
            memory=memory
        )
    