import re
from collections.abc import Callable, Generator
from typing import cast

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
from core.model_runtime.model_providers.volcengine_maas.legacy.errors import wrap_error
from core.model_runtime.model_providers.volcengine_maas.legacy.volc_sdk import ChatRole, MaasError, MaasService


class MaaSClient(MaasService):
    def __init__(self, host: str, region: str):
        self.endpoint_id = None
        super().__init__(host, region)

    def set_endpoint_id(self, endpoint_id: str):
        self.endpoint_id = endpoint_id

    @classmethod
    def from_credential(cls, credentials: dict) -> "MaaSClient":
        host = credentials["api_endpoint_host"]
        region = credentials["volc_region"]
        ak = credentials["volc_access_key_id"]
        sk = credentials["volc_secret_access_key"]
        endpoint_id = credentials["endpoint_id"]

        client = cls(host, region)
        client.set_endpoint_id(endpoint_id)
        client.set_ak(ak)
        client.set_sk(sk)
        return client

    def chat(self, params: dict, messages: list[PromptMessage], stream=False, **extra_model_kwargs) -> Generator | dict:
        req = {
            "parameters": params,
            "messages": [self.convert_prompt_message_to_maas_message(prompt) for prompt in messages],
            **extra_model_kwargs,
        }
        if not stream:
            return super().chat(
                self.endpoint_id,
                req,
            )
        return super().stream_chat(
            self.endpoint_id,
            req,
        )

    def embeddings(self, texts: list[str]) -> dict:
        req = {"input": texts}
        return super().embeddings(self.endpoint_id, req)

    @staticmethod
    def convert_prompt_message_to_maas_message(message: PromptMessage) -> dict:
        if isinstance(message, UserPromptMessage):
            message = cast(UserPromptMessage, message)
            if isinstance(message.content, str):
                message_dict = {"role": ChatRole.USER, "content": message.content}
            else:
                content = []
                for message_content in message.content:
                    if message_content.type == PromptMessageContentType.TEXT:
                        content.append(
                            {
                                "type": "text",
                                "text": message_content.data,
                            }
                        )
                    elif message_content.type == PromptMessageContentType.IMAGE:
                        message_content = cast(ImagePromptMessageContent, message_content)
                        image_data = re.sub(r"^data:image\/[a-zA-Z]+;base64,", "", message_content.data)
                        content.append(
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": "",
                                    "image_bytes": image_data,
                                    "detail": message_content.detail,
                                },
                            }
                        )

                message_dict = {"role": ChatRole.USER, "content": content}
        elif isinstance(message, AssistantPromptMessage):
            message = cast(AssistantPromptMessage, message)
            message_dict = {"role": ChatRole.ASSISTANT, "content": message.content}
            if message.tool_calls:
                message_dict["tool_calls"] = [
                    {"name": call.function.name, "arguments": call.function.arguments} for call in message.tool_calls
                ]
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            message_dict = {"role": ChatRole.SYSTEM, "content": message.content}
        elif isinstance(message, ToolPromptMessage):
            message = cast(ToolPromptMessage, message)
            message_dict = {"role": ChatRole.FUNCTION, "content": message.content, "name": message.tool_call_id}
        else:
            raise ValueError(f"Got unknown PromptMessage type {message}")

        return message_dict

    @staticmethod
    def wrap_exception(fn: Callable[[], dict | Generator]) -> dict | Generator:
        try:
            resp = fn()
        except MaasError as e:
            raise wrap_error(e)

        return resp

    @staticmethod
    def transform_tool_prompt_to_maas_config(tool: PromptMessageTool):
        return {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        }
