import logging
from typing import cast

from sqlalchemy import select

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.base_app_runner import AppRunner
from core.app.apps.completion.app_config_manager import CompletionAppConfig
from core.app.entities.app_invoke_entities import (
    CompletionAppGenerateEntity,
)
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.model_manager import ModelInstance
from core.model_runtime.entities.message_entities import ImagePromptMessageContent
from core.moderation.base import ModerationError
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from extensions.ext_database import db
from models.model import App, Message

logger = logging.getLogger(__name__)


class CompletionAppRunner(AppRunner):
    """
    Completion Application Runner
    """

    def run(
        self, application_generate_entity: CompletionAppGenerateEntity, queue_manager: AppQueueManager, message: Message
    ):
        """
        Run application
        :param application_generate_entity: application generate entity
        :param queue_manager: application queue manager
        :param message: message
        :return:
        """
        app_config = application_generate_entity.app_config
        app_config = cast(CompletionAppConfig, app_config)
        stmt = select(App).where(App.id == app_config.app_id)
        app_record = db.session.scalar(stmt)
        if not app_record:
            raise ValueError("App not found")

        inputs = application_generate_entity.inputs
        query = application_generate_entity.query
        files = application_generate_entity.files

        image_detail_config = (
            application_generate_entity.file_upload_config.image_config.detail
            if (
                application_generate_entity.file_upload_config
                and application_generate_entity.file_upload_config.image_config
            )
            else None
        )
        image_detail_config = image_detail_config or ImagePromptMessageContent.DETAIL.LOW

        # organize all inputs and template to prompt messages
        # Include: prompt template, inputs, query(optional), files(optional)
        prompt_messages, stop = self.organize_prompt_messages(
            app_record=app_record,
            model_config=application_generate_entity.model_conf,
            prompt_template_entity=app_config.prompt_template,
            inputs=inputs,
            files=files,
            query=query,
            image_detail_config=image_detail_config,
        )

        # moderation
        try:
            # process sensitive_word_avoidance
            _, inputs, query = self.moderation_for_inputs(
                app_id=app_record.id,
                tenant_id=app_config.tenant_id,
                app_generate_entity=application_generate_entity,
                inputs=inputs,
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

        # get context from datasets
        context = None
        if app_config.dataset and app_config.dataset.dataset_ids:
            hit_callback = DatasetIndexToolCallbackHandler(
                queue_manager,
                app_record.id,
                message.id,
                application_generate_entity.user_id,
                application_generate_entity.invoke_from,
            )

            dataset_config = app_config.dataset
            if dataset_config and dataset_config.retrieve_config.query_variable:
                query = inputs.get(dataset_config.retrieve_config.query_variable, "")

            dataset_retrieval = DatasetRetrieval(application_generate_entity)
            context = dataset_retrieval.retrieve(
                app_id=app_record.id,
                user_id=application_generate_entity.user_id,
                tenant_id=app_record.tenant_id,
                model_config=application_generate_entity.model_conf,
                config=dataset_config,
                query=query or "",
                invoke_from=application_generate_entity.invoke_from,
                show_retrieve_source=app_config.additional_features.show_retrieve_source
                if app_config.additional_features
                else False,
                hit_callback=hit_callback,
                message_id=message.id,
                inputs=inputs,
            )

        # reorganize all inputs and template to prompt messages
        # Include: prompt template, inputs, query(optional), files(optional)
        #          memory(optional), external data, dataset context(optional)
        prompt_messages, stop = self.organize_prompt_messages(
            app_record=app_record,
            model_config=application_generate_entity.model_conf,
            prompt_template_entity=app_config.prompt_template,
            inputs=inputs,
            files=files,
            query=query,
            context=context,
            image_detail_config=image_detail_config,
        )

        # check hosting moderation
        hosting_moderation_result = self.check_hosting_moderation(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            prompt_messages=prompt_messages,
        )

        if hosting_moderation_result:
            return

        # Re-calculate the max tokens if sum(prompt_token +  max_tokens) over model token limit
        self.recalc_llm_max_tokens(model_config=application_generate_entity.model_conf, prompt_messages=prompt_messages)

        # Invoke model
        model_instance = ModelInstance(
            provider_model_bundle=application_generate_entity.model_conf.provider_model_bundle,
            model=application_generate_entity.model_conf.model,
        )

        db.session.close()

        invoke_result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters=application_generate_entity.model_conf.parameters,
            stop=stop,
            stream=application_generate_entity.stream,
            user=application_generate_entity.user_id,
        )

        # handle invoke result
        self._handle_invoke_result(
            invoke_result=invoke_result, queue_manager=queue_manager, stream=application_generate_entity.stream
        )
