from collections.abc import Generator
from json import dumps, loads
from typing import Any, Union

from requests import Response, post

from core.model_runtime.model_providers.minimax.llm.errors import (
    BadRequestError,
    InsufficientAccountBalanceError,
    InternalServerError,
    InvalidAPIKeyError,
    InvalidAuthenticationError,
    RateLimitReachedError,
)
from core.model_runtime.model_providers.minimax.llm.types import MinimaxMessage


class MinimaxChatCompletionPro:
    """
    Minimax Chat Completion Pro API, supports function calling
    however, we do not have enough time and energy to implement it, but the parameters are reserved
    """

    def generate(
        self,
        model: str,
        api_key: str,
        group_id: str,
        prompt_messages: list[MinimaxMessage],
        model_parameters: dict,
        tools: list[dict[str, Any]],
        stop: list[str] | None,
        stream: bool,
        user: str,
    ) -> Union[MinimaxMessage, Generator[MinimaxMessage, None, None]]:
        """
        generate chat completion
        """
        if not api_key or not group_id:
            raise InvalidAPIKeyError("Invalid API key or group ID")

        url = f"https://api.minimax.chat/v1/text/chatcompletion_pro?GroupId={group_id}"

        extra_kwargs = {}

        if "max_tokens" in model_parameters and type(model_parameters["max_tokens"]) == int:
            extra_kwargs["tokens_to_generate"] = model_parameters["max_tokens"]

        if "temperature" in model_parameters and type(model_parameters["temperature"]) == float:
            extra_kwargs["temperature"] = model_parameters["temperature"]

        if "top_p" in model_parameters and type(model_parameters["top_p"]) == float:
            extra_kwargs["top_p"] = model_parameters["top_p"]

        if "mask_sensitive_info" in model_parameters and type(model_parameters["mask_sensitive_info"]) == bool:
            extra_kwargs["mask_sensitive_info"] = model_parameters["mask_sensitive_info"]

        if model_parameters.get("plugin_web_search"):
            extra_kwargs["plugins"] = ["plugin_web_search"]

        bot_setting = {"bot_name": "专家", "content": "你是一个什么都懂的专家"}

        reply_constraints = {"sender_type": "BOT", "sender_name": "专家"}

        # check if there is a system message
        if len(prompt_messages) == 0:
            raise BadRequestError("At least one message is required")

        if prompt_messages[0].role == MinimaxMessage.Role.SYSTEM.value:
            if prompt_messages[0].content:
                bot_setting["content"] = prompt_messages[0].content
            prompt_messages = prompt_messages[1:]

        # check if there is a user message
        if len(prompt_messages) == 0:
            raise BadRequestError("At least one user message is required")

        messages = [message.to_dict() for message in prompt_messages]

        headers = {"Authorization": "Bearer " + api_key, "Content-Type": "application/json"}

        body = {
            "model": model,
            "messages": messages,
            "bot_setting": [bot_setting],
            "reply_constraints": reply_constraints,
            "stream": stream,
            **extra_kwargs,
        }

        if tools:
            body["functions"] = tools
            body["function_call"] = {"type": "auto"}

        try:
            response = post(url=url, data=dumps(body), headers=headers, stream=stream, timeout=(10, 300))
        except Exception as e:
            raise InternalServerError(e)

        if response.status_code != 200:
            raise InternalServerError(response.text)

        if stream:
            return self._handle_stream_chat_generate_response(response)
        return self._handle_chat_generate_response(response)

    def _handle_error(self, code: int, msg: str):
        if code in {1000, 1001, 1013, 1027}:
            raise InternalServerError(msg)
        elif code in {1002, 1039}:
            raise RateLimitReachedError(msg)
        elif code == 1004:
            raise InvalidAuthenticationError(msg)
        elif code == 1008:
            raise InsufficientAccountBalanceError(msg)
        elif code == 2013:
            raise BadRequestError(msg)
        else:
            raise InternalServerError(msg)

    def _handle_chat_generate_response(self, response: Response) -> MinimaxMessage:
        """
        handle chat generate response
        """
        response = response.json()
        if "base_resp" in response and response["base_resp"]["status_code"] != 0:
            code = response["base_resp"]["status_code"]
            msg = response["base_resp"]["status_msg"]
            self._handle_error(code, msg)

        message = MinimaxMessage(content=response["reply"], role=MinimaxMessage.Role.ASSISTANT.value)
        message.usage = {
            "prompt_tokens": 0,
            "completion_tokens": response["usage"]["total_tokens"],
            "total_tokens": response["usage"]["total_tokens"],
        }
        message.stop_reason = response["choices"][0]["finish_reason"]
        return message

    def _handle_stream_chat_generate_response(self, response: Response) -> Generator[MinimaxMessage, None, None]:
        """
        handle stream chat generate response
        """
        for line in response.iter_lines():
            if not line:
                continue
            line: str = line.decode("utf-8")
            if line.startswith("data: "):
                line = line[6:].strip()
            data = loads(line)

            if "base_resp" in data and data["base_resp"]["status_code"] != 0:
                code = data["base_resp"]["status_code"]
                msg = data["base_resp"]["status_msg"]
                self._handle_error(code, msg)

            # final chunk
            if data["reply"] or data.get("usage"):
                total_tokens = data["usage"]["total_tokens"]
                minimax_message = MinimaxMessage(role=MinimaxMessage.Role.ASSISTANT.value, content="")
                minimax_message.usage = {
                    "prompt_tokens": 0,
                    "completion_tokens": total_tokens,
                    "total_tokens": total_tokens,
                }
                minimax_message.stop_reason = data["choices"][0]["finish_reason"]

                choices = data.get("choices", [])
                if len(choices) > 0:
                    for choice in choices:
                        message = choice["messages"][0]
                        # append function_call message
                        if "function_call" in message:
                            function_call_message = MinimaxMessage(content="", role=MinimaxMessage.Role.ASSISTANT.value)
                            function_call_message.function_call = message["function_call"]
                            yield function_call_message

                yield minimax_message
                return

            # partial chunk
            choices = data.get("choices", [])
            if len(choices) == 0:
                continue

            for choice in choices:
                message = choice["messages"][0]
                # append text message
                if "text" in message:
                    minimax_message = MinimaxMessage(content=message["text"], role=MinimaxMessage.Role.ASSISTANT.value)
                    yield minimax_message
