import enum
import logging
from typing import List, Dict, Optional, Any

from langchain.callbacks.manager import CallbackManagerForChainRun
from langchain.chains.base import Chain
from pydantic import BaseModel

from core.model_providers.error import LLMBadRequestError
from core.model_providers.model_factory import ModelFactory
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.moderation import openai_moderation


class SensitiveWordAvoidanceRule(BaseModel):
    class Type(enum.Enum):
        MODERATION = "moderation"
        KEYWORDS = "keywords"

    type: Type
    canned_response: str = 'Your content violates our usage policy. Please revise and try again.'
    extra_params: dict = {}


class SensitiveWordAvoidanceChain(Chain):
    input_key: str = "input"  #: :meta private:
    output_key: str = "output"  #: :meta private:

    model_instance: BaseLLM
    sensitive_word_avoidance_rule: SensitiveWordAvoidanceRule

    @property
    def _chain_type(self) -> str:
        return "sensitive_word_avoidance_chain"

    @property
    def input_keys(self) -> List[str]:
        """Expect input key.

        :meta private:
        """
        return [self.input_key]

    @property
    def output_keys(self) -> List[str]:
        """Return output key.

        :meta private:
        """
        return [self.output_key]

    def _check_sensitive_word(self, text: str) -> bool:
        for word in self.sensitive_word_avoidance_rule.extra_params.get('sensitive_words', []):
            if word in text:
                return False
        return True

    def _check_moderation(self, text: str) -> bool:
        moderation_model_instance = ModelFactory.get_moderation_model(
            tenant_id=self.model_instance.model_provider.provider.tenant_id,
            model_provider_name='openai',
            model_name=openai_moderation.DEFAULT_MODEL
        )

        try:
            return moderation_model_instance.run(text=text)
        except Exception as ex:
            logging.exception(ex)
            raise LLMBadRequestError('Rate limit exceeded, please try again later.')

    def _call(
            self,
            inputs: Dict[str, Any],
            run_manager: Optional[CallbackManagerForChainRun] = None,
    ) -> Dict[str, Any]:
        text = inputs[self.input_key]

        if self.sensitive_word_avoidance_rule.type == SensitiveWordAvoidanceRule.Type.KEYWORDS:
            result = self._check_sensitive_word(text)
        else:
            result = self._check_moderation(text)

        if not result:
            raise SensitiveWordAvoidanceError(self.sensitive_word_avoidance_rule.canned_response)

        return {self.output_key: text}


class SensitiveWordAvoidanceError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message
