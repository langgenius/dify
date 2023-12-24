from core.model_runtime.model_providers.__base.model_provider import ModelProvider
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
import logging

logger = logging.getLogger(__name__)

class OpenLLMProvider(ModelProvider):
    pass