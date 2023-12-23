import logging

from core.entities.application_entities import ApplicationGenerateEntity
from core.application_queue_manager import ApplicationQueueManager
from models.model import Conversation, Message

logger = logging.getLogger(__name__)


class AgentApplicationRunner:
    """
    Agent Application Runner
    """

    def run(self, application_generate_entity: ApplicationGenerateEntity,
            queue_manager: ApplicationQueueManager,
            conversation: Conversation,
            message: Message) -> None:
        """
        Run agent application
        :param application_generate_entity: application generate entity
        :param queue_manager: application queue manager
        :param conversation: conversation
        :param message: message
        :return:
        """
