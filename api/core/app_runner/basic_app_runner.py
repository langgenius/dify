from core.app_runner.generate_task_pipeline import GenerateTaskPipeline
from core.entities.application_entities import ApplicationGenerateEntity
from core.application_queue_manager import ApplicationQueueManager
from models.model import Conversation, Message


class BasicApplicationRunner:
    """
    Basic Application Runner
    """

    def run(self, application_generate_entity: ApplicationGenerateEntity,
            queue_manager: ApplicationQueueManager,
            conversation: Conversation,
            message: Message) -> None:
        pass
