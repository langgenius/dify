from typing import cast

from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentType,
    PromptMessageRole,
    TextPromptMessageContent,
)
from core.prompt.simple_prompt_transform import ModelMode


class PromptMessageUtil:
    @staticmethod
    def prompt_messages_to_prompt_for_saving(model_mode: str, prompt_messages: list[PromptMessage]) -> list[dict]:
        """
        Prompt messages to prompt for saving.
        :param model_mode: model mode
        :param prompt_messages: prompt messages
        :return:
        """
        prompts = []
        if model_mode == ModelMode.CHAT.value:
            tool_calls = []
            for prompt_message in prompt_messages:
                if prompt_message.role == PromptMessageRole.USER:
                    role = "user"
                elif prompt_message.role == PromptMessageRole.ASSISTANT:
                    role = "assistant"
                    if isinstance(prompt_message, AssistantPromptMessage):
                        tool_calls = [
                            {
                                "id": tool_call.id,
                                "type": "function",
                                "function": {
                                    "name": tool_call.function.name,
                                    "arguments": tool_call.function.arguments,
                                },
                            }
                            for tool_call in prompt_message.tool_calls
                        ]
                elif prompt_message.role == PromptMessageRole.SYSTEM:
                    role = "system"
                elif prompt_message.role == PromptMessageRole.TOOL:
                    role = "tool"
                else:
                    continue

                text = ""
                files = []
                if isinstance(prompt_message.content, list):
                    for content in prompt_message.content:
                        if content.type == PromptMessageContentType.TEXT:
                            content = cast(TextPromptMessageContent, content)
                            text += content.data
                        else:
                            content = cast(ImagePromptMessageContent, content)
                            files.append(
                                {
                                    "type": "image",
                                    "data": content.data[:10] + "...[TRUNCATED]..." + content.data[-10:],
                                    "detail": content.detail.value,
                                }
                            )
                else:
                    text = prompt_message.content

                prompt = {"role": role, "text": text, "files": files}

                if tool_calls:
                    prompt["tool_calls"] = tool_calls

                prompts.append(prompt)
        else:
            prompt_message = prompt_messages[0]
            text = ""
            files = []
            if isinstance(prompt_message.content, list):
                for content in prompt_message.content:
                    if content.type == PromptMessageContentType.TEXT:
                        content = cast(TextPromptMessageContent, content)
                        text += content.data
                    else:
                        content = cast(ImagePromptMessageContent, content)
                        files.append(
                            {
                                "type": "image",
                                "data": content.data[:10] + "...[TRUNCATED]..." + content.data[-10:],
                                "detail": content.detail.value,
                            }
                        )
            else:
                text = prompt_message.content

            params = {
                "role": "user",
                "text": text,
            }

            if files:
                params["files"] = files

            prompts.append(params)

        return prompts
