import datetime
import uuid
from collections.abc import Generator, Sequence
from decimal import Decimal
from json import dumps

# import monkeypatch
from typing import Optional

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from core.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage, PromptMessageTool
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    FetchFrom,
    ModelFeature,
    ModelPropertyKey,
    ModelType,
)
from core.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from core.plugin.entities.plugin_daemon import PluginModelProviderEntity
from core.plugin.manager.model import PluginModelManager


class MockModelClass(PluginModelManager):
    def fetch_model_providers(self, tenant_id: str) -> Sequence[PluginModelProviderEntity]:
        """
        Fetch model providers for the given tenant.
        """
        return [
            PluginModelProviderEntity(
                id=uuid.uuid4().hex,
                created_at=datetime.datetime.now(),
                updated_at=datetime.datetime.now(),
                provider="openai",
                tenant_id=tenant_id,
                plugin_unique_identifier="langgenius/openai/openai",
                plugin_id="langgenius/openai",
                declaration=ProviderEntity(
                    provider="openai",
                    label=I18nObject(
                        en_US="OpenAI",
                        zh_Hans="OpenAI",
                    ),
                    description=I18nObject(
                        en_US="OpenAI",
                        zh_Hans="OpenAI",
                    ),
                    icon_small=I18nObject(
                        en_US="https://example.com/icon_small.png",
                        zh_Hans="https://example.com/icon_small.png",
                    ),
                    icon_large=I18nObject(
                        en_US="https://example.com/icon_large.png",
                        zh_Hans="https://example.com/icon_large.png",
                    ),
                    supported_model_types=[ModelType.LLM],
                    configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
                    models=[
                        AIModelEntity(
                            model="gpt-3.5-turbo",
                            label=I18nObject(
                                en_US="gpt-3.5-turbo",
                                zh_Hans="gpt-3.5-turbo",
                            ),
                            model_type=ModelType.LLM,
                            fetch_from=FetchFrom.PREDEFINED_MODEL,
                            model_properties={},
                            features=[ModelFeature.TOOL_CALL, ModelFeature.MULTI_TOOL_CALL],
                        ),
                        AIModelEntity(
                            model="gpt-3.5-turbo-instruct",
                            label=I18nObject(
                                en_US="gpt-3.5-turbo-instruct",
                                zh_Hans="gpt-3.5-turbo-instruct",
                            ),
                            model_type=ModelType.LLM,
                            fetch_from=FetchFrom.PREDEFINED_MODEL,
                            model_properties={
                                ModelPropertyKey.MODE: LLMMode.COMPLETION,
                            },
                            features=[],
                        ),
                    ],
                ),
            )
        ]

    def get_model_schema(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict,
    ) -> AIModelEntity | None:
        """
        Get model schema
        """
        return AIModelEntity(
            model=model,
            label=I18nObject(
                en_US="OpenAI",
                zh_Hans="OpenAI",
            ),
            model_type=ModelType(model_type),
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={},
            features=[ModelFeature.TOOL_CALL, ModelFeature.MULTI_TOOL_CALL] if model == "gpt-3.5-turbo" else [],
        )

    @staticmethod
    def generate_function_call(
        tools: Optional[list[PromptMessageTool]],
    ) -> Optional[AssistantPromptMessage.ToolCall]:
        if not tools or len(tools) == 0:
            return None
        function: PromptMessageTool = tools[0]
        function_name = function.name
        function_parameters = function.parameters
        function_parameters_type = function_parameters["type"]
        if function_parameters_type != "object":
            return None
        function_parameters_properties = function_parameters["properties"]
        function_parameters_required = function_parameters["required"]
        parameters = {}
        for parameter_name, parameter in function_parameters_properties.items():
            if parameter_name not in function_parameters_required:
                continue
            parameter_type = parameter["type"]
            if parameter_type == "string":
                if "enum" in parameter:
                    if len(parameter["enum"]) == 0:
                        continue
                    parameters[parameter_name] = parameter["enum"][0]
                else:
                    parameters[parameter_name] = "kawaii"
            elif parameter_type == "integer":
                parameters[parameter_name] = 114514
            elif parameter_type == "number":
                parameters[parameter_name] = 1919810.0
            elif parameter_type == "boolean":
                parameters[parameter_name] = True

        return AssistantPromptMessage.ToolCall(
            id=str(uuid.uuid4()),
            type="function",
            function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                name=function_name,
                arguments=dumps(parameters),
            ),
        )

    @staticmethod
    def mocked_chat_create_sync(
        model: str,
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
    ) -> LLMResult:
        tool_call = MockModelClass.generate_function_call(tools=tools)

        return LLMResult(
            id=str(uuid.uuid4()),
            model=model,
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(content="elaina", tool_calls=[tool_call] if tool_call else []),
            usage=LLMUsage(
                prompt_tokens=2,
                completion_tokens=1,
                total_tokens=3,
                prompt_unit_price=Decimal(0.0001),
                completion_unit_price=Decimal(0.0002),
                prompt_price_unit=Decimal(1),
                prompt_price=Decimal(0.0001),
                completion_price_unit=Decimal(1),
                completion_price=Decimal(0.0002),
                total_price=Decimal(0.0003),
                currency="USD",
                latency=0.001,
            ),
        )

    @staticmethod
    def mocked_chat_create_stream(
        model: str,
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
    ) -> Generator[LLMResultChunk, None, None]:
        tool_call = MockModelClass.generate_function_call(tools=tools)

        full_text = "Hello, world!\n\n```python\nprint('Hello, world!')\n```"
        for i in range(0, len(full_text) + 1):
            if i == len(full_text):
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(
                            content="",
                            tool_calls=[tool_call] if tool_call else [],
                        ),
                    ),
                )
            else:
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(
                            content=full_text[i],
                            tool_calls=[tool_call] if tool_call else [],
                        ),
                        usage=LLMUsage(
                            prompt_tokens=2,
                            completion_tokens=17,
                            total_tokens=19,
                            prompt_unit_price=Decimal(0.0001),
                            completion_unit_price=Decimal(0.0002),
                            prompt_price_unit=Decimal(1),
                            prompt_price=Decimal(0.0001),
                            completion_price_unit=Decimal(1),
                            completion_price=Decimal(0.0002),
                            total_price=Decimal(0.0003),
                            currency="USD",
                            latency=0.001,
                            ttft=0,
                        ),
                    ),
                )

    def invoke_llm(
        self: PluginModelManager,
        *,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: Optional[dict] = None,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
        stream: bool = True,
    ):
        return MockModelClass.mocked_chat_create_stream(model=model, prompt_messages=prompt_messages, tools=tools)
