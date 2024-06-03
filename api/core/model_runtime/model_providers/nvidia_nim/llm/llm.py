import logging

from core.model_runtime.model_providers.openai_api_compatible.llm.llm import OAIAPICompatLargeLanguageModel

logger = logging.getLogger(__name__)

class NIMCompatLargeLanguageModel(OAIAPICompatLargeLanguageModel):
    """
    Model class for OpenAI large language model.
    """
