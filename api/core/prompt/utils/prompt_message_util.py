from collections.abc import Sequence
from typing import NotRequired, TypedDict, cast

from core.prompt.simple_prompt_transform import ModelMode
from graphon.model_runtime.entities import (
    AssistantPromptMessage,
    AudioPromptMessageContent,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentType,
    PromptMessageRole,
    TextPromptMessageContent,
)

_TRUNCATION_MARKER = "...[TRUNCATED]..."
_TRUNCATION_KEEP = 10


def _truncate_media_data(data: str) -> str:
    """Truncate media data for saving, keeping its head and tail.

    Only truncate when the data is longer than twice the kept length. For
    shorter data the head/tail slices would overlap and otherwise duplicate
    the content (e.g. "abc" -> "abc...[TRUNCATED]...abc").
    """
    if len(data) <= 2 * _TRUNCATION_KEEP:
        return data
    return data[:_TRUNCATION_KEEP] + _TRUNCATION_MARKER + data[-_TRUNCATION_KEEP:]


class SavedPromptFile(TypedDict):
    type: str
    data: str
    detail: NotRequired[str]
    format: NotRequired[str]


class SavedPromptToolCallFunction(TypedDict):
    name: str
    arguments: str


class SavedPromptToolCall(TypedDict):
    id: str
    type: str
    function: SavedPromptToolCallFunction


class SavedPrompt(TypedDict):
    role: str
    text: str
    files: NotRequired[list[SavedPromptFile]]
    tool_calls: NotRequired[list[SavedPromptToolCall]]


class PromptMessageUtil:
    @staticmethod
    def prompt_messages_to_prompt_for_saving(
        model_mode: str, prompt_messages: Sequence[PromptMessage]
    ) -> list[SavedPrompt]:
        """
        Prompt messages to prompt for saving.
        :param model_mode: model mode
        :param prompt_messages: prompt messages
        :return:
        """
        prompts: list[SavedPrompt] = []
        if model_mode == ModelMode.CHAT:
            for prompt_message in prompt_messages:
                tool_calls: list[SavedPromptToolCall] = []
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
                files: list[SavedPromptFile] = []
                if isinstance(prompt_message.content, list):
                    for content in prompt_message.content:
                        match content:
                            case TextPromptMessageContent():
                                text += content.data
                            case ImagePromptMessageContent():
                                files.append(
                                    {
                                        "type": "image",
                                        "data": _truncate_media_data(content.data),
                                        "detail": content.detail.value,
                                    }
                                )
                            case AudioPromptMessageContent():
                                files.append(
                                    {
                                        "type": "audio",
                                        "data": _truncate_media_data(content.data),
                                        "format": content.format,
                                    }
                                )
                            case _:
                                continue
                else:
                    text = cast(str, prompt_message.content)

                prompt: SavedPrompt = {"role": role, "text": text, "files": files}

                if tool_calls:
                    prompt["tool_calls"] = tool_calls

                prompts.append(prompt)
        else:
            prompt_message = prompt_messages[0]
            text = ""
            prompt_files: list[SavedPromptFile] = []
            if isinstance(prompt_message.content, list):
                for content in prompt_message.content:
                    if content.type == PromptMessageContentType.TEXT:
                        text += content.data
                    else:
                        content = cast(ImagePromptMessageContent, content)
                        prompt_files.append(
                            {
                                "type": "image",
                                "data": _truncate_media_data(content.data),
                                "detail": content.detail.value,
                            }
                        )
            else:
                text = cast(str, prompt_message.content)

            params: SavedPrompt = {
                "role": "user",
                "text": text,
            }

            if prompt_files:
                params["files"] = prompt_files

            prompts.append(params)

        return prompts
