from collections.abc import Generator
from decimal import Decimal
from typing import Optional, Union

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.llm_entities import LLMMode, LLMResult
from core.model_runtime.entities.message_entities import (
    PromptMessage,
    PromptMessageTool,
)
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    DefaultParameterName,
    FetchFrom,
    ModelFeature,
    ModelPropertyKey,
    ModelType,
    ParameterRule,
    ParameterType,
    PriceConfig,
)
from core.model_runtime.model_providers.openai_api_compatible.llm.llm import OAIAPICompatLargeLanguageModel


class TogetherAILargeLanguageModel(OAIAPICompatLargeLanguageModel):
    def _update_endpoint_url(self, credentials: dict):
        credentials["endpoint_url"] = "https://api.together.xyz/v1"
        return credentials

    def _invoke(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
    ) -> Union[LLMResult, Generator]:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)

        return super()._invoke(model, cred_with_endpoint, prompt_messages, model_parameters, tools, stop, stream, user)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)

        return super().validate_credentials(model, cred_with_endpoint)

    def _generate(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
    ) -> Union[LLMResult, Generator]:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)

        return super()._generate(
            model, cred_with_endpoint, prompt_messages, model_parameters, tools, stop, stream, user
        )

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)
        REPETITION_PENALTY = "repetition_penalty"
        TOP_K = "top_k"
        features: list[ModelFeature] = []

        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            features=features,
            model_properties={
                ModelPropertyKey.CONTEXT_SIZE: int(cred_with_endpoint.get("context_size", "4096")),
                ModelPropertyKey.MODE: cred_with_endpoint.get("mode"),
            },
            parameter_rules=[
                ParameterRule(
                    name=DefaultParameterName.TEMPERATURE.value,
                    label=I18nObject(en_US="Temperature"),
                    type=ParameterType.FLOAT,
                    default=float(cred_with_endpoint.get("temperature", 0.7)),
                    min=0,
                    max=2,
                    precision=2,
                ),
                ParameterRule(
                    name=DefaultParameterName.TOP_P.value,
                    label=I18nObject(en_US="Top P"),
                    type=ParameterType.FLOAT,
                    default=float(cred_with_endpoint.get("top_p", 1)),
                    min=0,
                    max=1,
                    precision=2,
                ),
                ParameterRule(
                    name=TOP_K,
                    label=I18nObject(en_US="Top K"),
                    type=ParameterType.INT,
                    default=int(cred_with_endpoint.get("top_k", 50)),
                    min=-2147483647,
                    max=2147483647,
                    precision=0,
                ),
                ParameterRule(
                    name=REPETITION_PENALTY,
                    label=I18nObject(en_US="Repetition Penalty"),
                    type=ParameterType.FLOAT,
                    default=float(cred_with_endpoint.get("repetition_penalty", 1)),
                    min=-3.4,
                    max=3.4,
                    precision=1,
                ),
                ParameterRule(
                    name=DefaultParameterName.MAX_TOKENS.value,
                    label=I18nObject(en_US="Max Tokens"),
                    type=ParameterType.INT,
                    default=512,
                    min=1,
                    max=int(cred_with_endpoint.get("max_tokens_to_sample", 4096)),
                ),
                ParameterRule(
                    name=DefaultParameterName.FREQUENCY_PENALTY.value,
                    label=I18nObject(en_US="Frequency Penalty"),
                    type=ParameterType.FLOAT,
                    default=float(credentials.get("frequency_penalty", 0)),
                    min=-2,
                    max=2,
                ),
                ParameterRule(
                    name=DefaultParameterName.PRESENCE_PENALTY.value,
                    label=I18nObject(en_US="Presence Penalty"),
                    type=ParameterType.FLOAT,
                    default=float(credentials.get("presence_penalty", 0)),
                    min=-2,
                    max=2,
                ),
            ],
            pricing=PriceConfig(
                input=Decimal(cred_with_endpoint.get("input_price", 0)),
                output=Decimal(cred_with_endpoint.get("output_price", 0)),
                unit=Decimal(cred_with_endpoint.get("unit", 0)),
                currency=cred_with_endpoint.get("currency", "USD"),
            ),
        )

        if cred_with_endpoint["mode"] == "chat":
            entity.model_properties[ModelPropertyKey.MODE] = LLMMode.CHAT.value
        elif cred_with_endpoint["mode"] == "completion":
            entity.model_properties[ModelPropertyKey.MODE] = LLMMode.COMPLETION.value
        else:
            raise ValueError(f"Unknown completion type {cred_with_endpoint['completion_type']}")

        return entity

    def get_num_tokens(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
    ) -> int:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)

        return super().get_num_tokens(model, cred_with_endpoint, prompt_messages, tools)
