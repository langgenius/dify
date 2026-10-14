import json
import re
from collections.abc import Generator, Mapping
from html import escape, unescape

from dify_plugin import OAICompatLargeLanguageModel
from dify_plugin.entities.model import AIModelEntity, ModelFeature
from dify_plugin.entities.model.llm import LLMResult
from dify_plugin.entities.model.message import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageFunction,
    PromptMessageTool,
)
from dify_plugin.errors.model import (
    CredentialsValidateFailedError,
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from requests import Response

from models._catalog import discover_models
from models._credentials import (
    ENDPOINT_URL,
    SOURCE_HEADER,
    SOURCE_VALUE,
    normalize_api_key,
    validate_model_access,
)
from models._transport import (
    CHAT_COMPLETIONS_URL,
    MAX_COMPLETION_RESPONSE_BYTES,
    SSEReader,
    read_json_response,
    request_response,
    valid_usage,
)


class AMDGPUCloudLargeLanguageModel(OAICompatLargeLanguageModel):
    _THINK_MARKER = "<!--dify-amdgpucloud-reasoning-->"
    # Decode persisted conversations from the old provider without rewriting their content.
    _LEGACY_THINK_MARKER = "<!--dify-radeon-reasoning-->"
    _THINK_PATTERN = re.compile(
        rf"<think>\n(?:{re.escape(_THINK_MARKER)}|{re.escape(_LEGACY_THINK_MARKER)})(.*?)\n</think>",
        re.DOTALL | re.IGNORECASE,
    )

    def _invoke(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        user: str | None = None,
    ) -> LLMResult | Generator:
        return super()._invoke(
            model=model,
            credentials=self._model_credentials(model, credentials),
            prompt_messages=prompt_messages,
            model_parameters=dict(model_parameters),
            tools=tools,
            stop=stop,
            stream=stream,
            user=user,
        )

    def _generate(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        user: str | None = None,
    ) -> LLMResult | Generator:
        parameters = dict(model_parameters)
        if "response_format" in parameters:
            response_format = parameters["response_format"]
            if response_format not in {"text", "json_object"}:
                raise InvokeBadRequestError(
                    "AMDGPUCloud preview supports text or JSON Object output"
                )
            parameters["response_format"] = {"type": response_format}
        parameters.pop("json_schema", None)
        payload = {
            **parameters,
            "model": model,
            "stream": stream,
            "messages": [
                self._convert_prompt_message_to_dict(message, credentials)
                for message in prompt_messages
            ],
        }
        if stream:
            payload["stream_options"] = {"include_usage": True}
        if tools:
            payload["tools"] = [PromptMessageFunction(function=tool).model_dump() for tool in tools]
            payload["tool_choice"] = "auto"
        if stop:
            payload["stop"] = list(stop)
        if user:
            payload["user"] = user
        try:
            body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (ValueError, TypeError, UnicodeError):
            raise InvokeBadRequestError(
                "AMDGPUCloud request contains invalid parameters"
            ) from None
        if stream:
            return self._generate_stream(model, credentials, prompt_messages, body)

        response = self._send_completion(credentials, body)
        try:
            result = read_json_response(
                response, MAX_COMPLETION_RESPONSE_BYTES, "completion response"
            )
            choices = result.get("choices")
            if not (
                isinstance(choices, list)
                and choices
                and isinstance(choices[0], dict)
                and isinstance(choices[0].get("message"), dict)
                and valid_usage(result.get("usage"))
            ):
                raise InvokeServerUnavailableError(
                    "AMDGPUCloud returned an invalid completion response"
                )
            choices[0]["message"].setdefault("content", None)
            response._content = json.dumps(result, ensure_ascii=False).encode("utf-8")
            return self._handle_generate_response(model, credentials, response, prompt_messages)
        except InvokeError:
            raise
        except Exception:
            raise InvokeServerUnavailableError(
                "AMDGPUCloud returned an invalid completion response"
            ) from None
        finally:
            response.close()

    def _send_completion(self, credentials: dict, body: bytes) -> Response:
        return request_response(
            CHAT_COMPLETIONS_URL,
            headers={
                **credentials["extra_headers"],
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "Authorization": f"Bearer {credentials['api_key']}",
            },
            timeout=(10, 600),
            operation="model request",
            data=body,
        )

    def _generate_stream(
        self, model: str, credentials: dict, prompt_messages: list[PromptMessage], body: bytes
    ) -> Generator:
        # Open the connection only when iteration starts, so an unstarted generator owns no socket.
        response = self._send_completion(credentials, body)
        try:
            yield from super()._handle_generate_stream_response(
                model, credentials, SSEReader(response), prompt_messages
            )
        except InvokeError:
            raise
        except Exception:
            raise InvokeServerUnavailableError(
                "AMDGPUCloud returned an invalid stream response"
            ) from None
        finally:
            response.close()

    def _transform_invoke_error(self, error: Exception) -> InvokeError:
        if isinstance(
            error,
            (
                InvokeAuthorizationError,
                InvokeBadRequestError,
                InvokeConnectionError,
                InvokeRateLimitError,
                InvokeServerUnavailableError,
            ),
        ):
            return error
        if isinstance(error, CredentialsValidateFailedError):
            return InvokeAuthorizationError("Invalid AMDGPUCloud API key")
        return InvokeError("AMDGPUCloud request failed; no upstream details are exposed")

    def get_customizable_model_schema(
        self, model: str, credentials: Mapping
    ) -> AIModelEntity | None:
        for schema in discover_models(credentials):
            if schema["model"] == model:
                return AIModelEntity.model_validate(schema)
        raise InvokeBadRequestError("Model is not available in the current AMDGPUCloud catalog")

    def validate_credentials(self, model: str, credentials: dict) -> None:
        validate_model_access(credentials, model)

    def get_num_tokens(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool] | None = None,
    ) -> int:
        return super().get_num_tokens(
            model,
            self._model_credentials(model, credentials),
            prompt_messages,
            tools,
        )

    def _model_credentials(self, model: str, credentials: Mapping) -> dict:
        extra_headers = credentials.get("extra_headers")
        headers = dict(extra_headers) if isinstance(extra_headers, Mapping) else {}
        headers = {
            key: value
            for key, value in headers.items()
            if isinstance(key, str)
            and isinstance(value, str)
            and key.lower()
            not in {"x-source", "authorization", "cookie", "host", "proxy-authorization"}
            and "\r" not in key + value
            and "\n" not in key + value
        }
        headers[SOURCE_HEADER] = SOURCE_VALUE

        resolved = {
            **credentials,
            "api_key": normalize_api_key(credentials),
            "endpoint_url": ENDPOINT_URL,
            "mode": "chat",
            "extra_headers": headers,
            "_current_model": model,
        }
        resolved.pop("endpoint_model_name", None)
        resolved.pop("stream_mode_delimiter", None)
        schema = self.get_model_schema(model, resolved)
        if schema is None:
            raise InvokeBadRequestError("Model is not in the AMDGPUCloud plugin catalog")
        features = set(schema.features or []) if schema else set()
        if {ModelFeature.TOOL_CALL, ModelFeature.MULTI_TOOL_CALL} & features:
            resolved["function_calling_type"] = "tool_call"
        if ModelFeature.STREAM_TOOL_CALL in features:
            resolved["stream_function_calling"] = "supported"
        return resolved

    def _handle_generate_response(
        self,
        model: str,
        credentials: dict,
        response: Response,
        prompt_messages: list[PromptMessage],
    ) -> LLMResult:
        result = super()._handle_generate_response(
            model,
            credentials,
            response,
            prompt_messages,
        )
        response_message = response.json()["choices"][0].get("message", {})
        reasoning_content = response_message.get("reasoning_content")
        if not isinstance(reasoning_content, str):
            reasoning_content = response_message.get("reasoning")
        if not isinstance(reasoning_content, str):
            return result

        opaque_body = (
            result.message.opaque_body
            if isinstance(result.message.opaque_body, dict)
            else {}
        )
        result.message.opaque_body = {
            **opaque_body,
            "reasoning_content": reasoning_content,
        }
        if reasoning_content:
            result.message.content = (
                f"<think>\n{self._THINK_MARKER}"
                f"{escape(reasoning_content, quote=False)}\n</think>"
                f"{result.message.content or ''}"
            )
        return result

    def _wrap_thinking_by_reasoning_content(
        self,
        delta: dict,
        is_reasoning: bool,
    ) -> tuple[str, bool]:
        content = delta.get("content") or ""
        reasoning_content = delta.get("reasoning_content") or delta.get("reasoning")
        if not reasoning_content:
            return ("\n</think>" if is_reasoning else "") + content, False

        output = escape(str(reasoning_content), quote=False)
        if not is_reasoning:
            output = f"<think>\n{self._THINK_MARKER}" + output
        if content or delta.get("tool_calls") or delta.get("function_call"):
            return output + "\n</think>" + content, False
        return output, True

    def _convert_prompt_message_to_dict(
        self,
        message: PromptMessage,
        credentials: dict | None = None,
    ) -> dict:
        credentials = credentials or {}
        message_dict = super()._convert_prompt_message_to_dict(message, credentials)
        if not isinstance(message, AssistantPromptMessage):
            return message_dict

        content = message.content or ""
        reasoning_content = None
        if isinstance(message.opaque_body, dict):
            raw_reasoning = message.opaque_body.get("reasoning_content")
            if isinstance(raw_reasoning, str):
                reasoning_content = raw_reasoning
        if isinstance(content, str):
            content, extracted_reasoning = self._extract_reasoning_content(content)
            if reasoning_content is None:
                reasoning_content = extracted_reasoning

        message_dict["content"] = content
        if self._replays_reasoning(credentials.get("_current_model"), credentials):
            message_dict["reasoning_content"] = reasoning_content or ""
        return message_dict

    def _replays_reasoning(self, model: object, credentials: Mapping) -> bool:
        if not isinstance(model, str) or not model.startswith("DeepSeek-"):
            return False
        schema = self.get_model_schema(model, credentials)
        return bool(schema and ModelFeature.AGENT_THOUGHT in (schema.features or []))

    def _extract_reasoning_content(self, text: str) -> tuple[str, str | None]:
        if not text:
            return text, None
        matches = self._THINK_PATTERN.findall(text)
        reasoning_content = "\n\n".join(map(unescape, matches)) if matches else None
        return self._THINK_PATTERN.sub("", text), reasoning_content