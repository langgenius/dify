from core.entities.llm_application_entities import LLMApplicationGenerateEntity
from core.pub_sub_manager import PubSubManager


class GenerateTaskPipeline:
    """
    GenerateTaskPipeline is a class that generate stream output and state management for Application.
    """
    def __init__(self, llm_application_generate_entity: LLMApplicationGenerateEntity,
                 pubsub_manager: PubSubManager,
                 conversation_id: str,
                 message_id: str) -> None:
        """
        Initialize GenerateTaskPipeline.
        :param llm_application_generate_entity: LLM application generate entity
        :param pubsub_manager: pubsub manager
        :param conversation_id: conversation id
        :param message_id: message id
        """
        self._llm_application_generate_entity = llm_application_generate_entity
        self._pubsub_manager = pubsub_manager
        self._conversation_id = conversation_id
        self._message_id = message_id