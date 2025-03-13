import logging

from core.model_runtime.model_providers.openai_api_compatible.llm.llm import OAIAPICompatLargeLanguageModel

logger = logging.getLogger(__name__)


class NVIDIANIMProvider(OAIAPICompatLargeLanguageModel):
    """
    Model class for NVIDIA NIM large language model.
    """

    pass
