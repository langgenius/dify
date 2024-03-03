import logging
from typing import cast

from core.app.app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfig
from core.app.apps.base_app_runner import AppRunner
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
)
from core.moderation.base import ModerationException
from extensions.ext_database import db
from models.model import App, Conversation, Message

logger = logging.getLogger(__name__)


class AdvancedChatAppRunner(AppRunner):
    """
    AdvancedChat Application Runner
    """

    def run(self, application_generate_entity: AdvancedChatAppGenerateEntity,
            queue_manager: AppQueueManager,
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
        app_config = application_generate_entity.app_config
        app_config = cast(AdvancedChatAppConfig, app_config)

        app_record = db.session.query(App).filter(App.id == app_config.app_id).first()
        if not app_record:
            raise ValueError("App not found")

        inputs = application_generate_entity.inputs
        query = application_generate_entity.query
        files = application_generate_entity.files

        # moderation
        try:
            # process sensitive_word_avoidance
            _, inputs, query = self.moderation_for_inputs(
                app_id=app_record.id,
                tenant_id=app_config.tenant_id,
                app_generate_entity=application_generate_entity,
                inputs=inputs,
                query=query,
            )
        except ModerationException as e:
            # TODO
            self.direct_output(
                queue_manager=queue_manager,
                app_generate_entity=application_generate_entity,
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

                # TODO
                self.direct_output(
                    queue_manager=queue_manager,
                    app_generate_entity=application_generate_entity,
                    prompt_messages=prompt_messages,
                    text=annotation_reply.content,
                    stream=application_generate_entity.stream
                )
                return

        # check hosting moderation
        # TODO
        hosting_moderation_result = self.check_hosting_moderation(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            prompt_messages=prompt_messages
        )

        if hosting_moderation_result:
            return

        # todo RUN WORKFLOW