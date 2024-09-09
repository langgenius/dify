import re
from collections.abc import Generator
from typing import Optional, cast

from volcenginesdkarkruntime import Ark
from volcenginesdkarkruntime.types.chat import (
    ChatCompletion,
    ChatCompletionAssistantMessageParam,
    ChatCompletionChunk,
    ChatCompletionContentPartImageParam,
    ChatCompletionContentPartTextParam,
    ChatCompletionMessageParam,
    ChatCompletionMessageToolCallParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionToolMessageParam,
    ChatCompletionToolParam,
    ChatCompletionUserMessageParam,
)
from volcenginesdkarkruntime.types.chat.chat_completion_content_part_image_param import ImageURL
from volcenginesdkarkruntime.types.chat.chat_completion_message_tool_call_param import Function
from volcenginesdkarkruntime.types.create_embedding_response import CreateEmbeddingResponse
from volcenginesdkarkruntime.types.shared_params import FunctionDefinition

from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentType,
    PromptMessageTool,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)

DEFAULT_V2_ENDPOINT = "maas-api.ml-platform-cn-beijing.volces.com"
DEFAULT_V3_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3"


class ArkClientV3:
    endpoint_id: Optional[str] = None
    ark: Optional[Ark] = None

    def __init__(self, *args, **kwargs):
        self.ark = Ark(*args, **kwargs)
        self.endpoint_id = None

    @staticmethod
    def is_legacy(credentials: dict) -> bool:
        # match default v2 endpoint
        if ArkClientV3.is_compatible_with_legacy(credentials):
            return False
        # match default v3 endpoint
        if credentials.get("api_endpoint_host") == DEFAULT_V3_ENDPOINT:
            return False
        # only v3 support api_key
        if credentials.get("auth_method") == "api_key":
            return False
        # these cases are considered as sdk v2
        # - modified default v2 endpoint
        # - modified default v3 endpoint and auth without api_key
        return True

    @staticmethod
    def is_compatible_with_legacy(credentials: dict) -> bool:
        endpoint = credentials.get("api_endpoint_host")
        return endpoint == DEFAULT_V2_ENDPOINT

    @classmethod
    def from_credentials(cls, credentials):
        """Initialize the client using the credentials provided."""
        args = {
            "base_url": credentials['api_endpoint_host'],
            "region": credentials['volc_region'],
        }
        if credentials.get("auth_method") == "api_key":
            args = {
                **args,
                "api_key": credentials['volc_api_key'],
            }
        else:
            args = {
                **args,
                "ak": credentials['volc_access_key_id'],
                "sk": credentials['volc_secret_access_key'],
            }

        if cls.is_compatible_with_legacy(credentials):
            args = {
                **args,
                "base_url": DEFAULT_V3_ENDPOINT
            }

        client = ArkClientV3(
            **args
        )
        client.endpoint_id = credentials['endpoint_id']
        return client

    @staticmethod
    def convert_prompt_message(message: PromptMessage) -> ChatCompletionMessageParam:
        """Converts a PromptMessage to a ChatCompletionMessageParam"""
        if isinstance(message, UserPromptMessage):
            message = cast(UserPromptMessage, message)
            if isinstance(message.content, str):
                content = message.content
            else:
                content = []
                for message_content in message.content:
                    if message_content.type == PromptMessageContentType.TEXT:
                        content.append(ChatCompletionContentPartTextParam(
                            text=message_content.text,
                            type='text',
                        ))
                    elif message_content.type == PromptMessageContentType.IMAGE:
                        message_content = cast(
                            ImagePromptMessageContent, message_content)
                        image_data = re.sub(
                            r'^data:image\/[a-zA-Z]+;base64,', '', message_content.data)
                        content.append(ChatCompletionContentPartImageParam(
                            image_url=ImageURL(
                                url=image_data,
                                detail=message_content.detail.value,
                            ),
                            type='image_url',
                        ))
            message_dict = ChatCompletionUserMessageParam(
                role='user',
                content=content
            )
        elif isinstance(message, AssistantPromptMessage):
            message = cast(AssistantPromptMessage, message)
            message_dict = ChatCompletionAssistantMessageParam(
                content=message.content,
                role='assistant',
                tool_calls=None if not message.tool_calls else [
                    ChatCompletionMessageToolCallParam(
                        id=call.id,
                        function=Function(
                            name=call.function.name,
                            arguments=call.function.arguments
                        ),
                        type='function'
                    ) for call in message.tool_calls
                ]
            )
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            message_dict = ChatCompletionSystemMessageParam(
                content=message.content,
                role='system'
            )
        elif isinstance(message, ToolPromptMessage):
            message = cast(ToolPromptMessage, message)
            message_dict = ChatCompletionToolMessageParam(
                content=message.content,
                role='tool',
                tool_call_id=message.tool_call_id
            )
        else:
            raise ValueError(f"Got unknown PromptMessage type {message}")

        return message_dict

    @staticmethod
    def _convert_tool_prompt(message: PromptMessageTool) -> ChatCompletionToolParam:
        return ChatCompletionToolParam(
            type='function',
            function=FunctionDefinition(
                name=message.name,
                description=message.description,
                parameters=message.parameters,
            )
        )

    def chat(self, messages: list[PromptMessage],
             tools: Optional[list[PromptMessageTool]] = None,
             stop: Optional[list[str]] = None,
             frequency_penalty: Optional[float] = None,
             max_tokens: Optional[int] = None,
             presence_penalty: Optional[float] = None,
             top_p: Optional[float] = None,
             temperature: Optional[float] = None,
             ) -> ChatCompletion:
        """Block chat"""
        return self.ark.chat.completions.create(
            model=self.endpoint_id,
            messages=[self.convert_prompt_message(message) for message in messages],
            tools=[self._convert_tool_prompt(tool) for tool in tools] if tools else None,
            stop=stop,
            frequency_penalty=frequency_penalty,
            max_tokens=max_tokens,
            presence_penalty=presence_penalty,
            top_p=top_p,
            temperature=temperature,
        )

    def stream_chat(self, messages: list[PromptMessage],
                    tools: Optional[list[PromptMessageTool]] = None,
                    stop: Optional[list[str]] = None,
                    frequency_penalty: Optional[float] = None,
                    max_tokens: Optional[int] = None,
                    presence_penalty: Optional[float] = None,
                    top_p: Optional[float] = None,
                    temperature: Optional[float] = None,
                    ) -> Generator[ChatCompletionChunk]:
        """Stream chat"""
        chunks = self.ark.chat.completions.create(
            stream=True,
            model=self.endpoint_id,
            messages=[self.convert_prompt_message(message) for message in messages],
            tools=[self._convert_tool_prompt(tool) for tool in tools] if tools else None,
            stop=stop,
            frequency_penalty=frequency_penalty,
            max_tokens=max_tokens,
            presence_penalty=presence_penalty,
            top_p=top_p,
            temperature=temperature,
        )
        for chunk in chunks:
            if not chunk.choices:
                continue
            yield chunk

    def embeddings(self, texts: list[str]) -> CreateEmbeddingResponse:
        return self.ark.embeddings.create(model=self.endpoint_id, input=texts)
