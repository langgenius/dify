from typing import cast

from core.entities.application_entities import ModelConfigEntity
from core.model_runtime.entities.message_entities import PromptMessage
from core.model_runtime.entities.model_entities import ModelPropertyKey
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel


class CalcTokenMixin:

    def get_message_rest_tokens(self, model_config: ModelConfigEntity, messages: list[PromptMessage], **kwargs) -> int:
        """
        Got the rest tokens available for the model after excluding messages tokens and completion max tokens

        :param model_config:
        :param messages:
        :return:
        """
        model_type_instance = model_config.provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        model_context_tokens = model_config.model_schema.model_properties.get(ModelPropertyKey.CONTEXT_SIZE)

        max_tokens = 0
        for parameter_rule in model_config.model_schema.parameter_rules:
            if (parameter_rule.name == 'max_tokens'
                    or (parameter_rule.use_template and parameter_rule.use_template == 'max_tokens')):
                max_tokens = (model_config.parameters.get(parameter_rule.name)
                              or model_config.parameters.get(parameter_rule.use_template)) or 0

        if model_context_tokens is None:
            return 0

        if max_tokens is None:
            max_tokens = 0

        prompt_tokens = model_type_instance.get_num_tokens(
            model_config.model,
            model_config.credentials,
            messages
        )

        rest_tokens = model_context_tokens - max_tokens - prompt_tokens

        return rest_tokens


class ExceededLLMTokensLimitError(Exception):
    pass
