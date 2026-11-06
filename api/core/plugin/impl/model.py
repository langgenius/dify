import binascii
import json
import re
import time
from collections.abc import Callable, Generator, Sequence
from typing import IO, Any

from core.plugin.entities.plugin_daemon import (
    PluginBasicBooleanResponse,
    PluginDaemonInnerError,
    PluginLLMNumTokensResponse,
    PluginModelProviderBinding,
    PluginModelProviderEntity,
    PluginModelSchemaEntity,
    PluginStringResultResponse,
    PluginTextEmbeddingNumTokensResponse,
    PluginTTSResultResponse,
    PluginVoicesResponse,
    TTSAudioChunk,
)
from core.plugin.impl.base import BasePluginClient, use_plugin_daemon_request_timeout
from core.plugin.impl.exc import PluginInvokeError, PluginLLMPollingUnsupportedError
from graphon.model_runtime.entities.llm_entities import LLMPollingResult, LLMResultChunk
from graphon.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from graphon.model_runtime.entities.rerank_entities import MultimodalRerankInput, RerankResult
from graphon.model_runtime.entities.text_embedding_entities import EmbeddingResult
from graphon.model_runtime.errors.invoke import InvokeServerUnavailableError
from graphon.model_runtime.protocols.tts_runtime import TTSModelVoice
from graphon.model_runtime.utils.encoders import jsonable_encoder
from services.plugin.dispatch_identity import plugin_dispatch_headers

_POLLING_UNSUPPORTED_INVOKE_ERROR_TYPES = frozenset((NotImplementedError.__name__,))
_POLLING_UNSUPPORTED_ERROR_MESSAGE = "does not support polling"
_MODEL_METADATA_READINESS_BUDGET_SECONDS = 10.0


def _metadata_gateway_unavailable(error: PluginInvokeError) -> bool:
    """Recognize only the daemon's bounded exhausted-gateway envelope.

    This identifies a gateway failure, not startup or an unsent inference.
    Callers may use it only to repeat credential-free schema metadata.
    """
    if type(error) is not PluginInvokeError or not isinstance(error.description, str) or len(error.description) > 2048:
        return False
    try:
        envelope = json.loads(error.description)
    except (ValueError, TypeError, RecursionError):
        return False
    if not isinstance(envelope, dict) or envelope.get("error_type") != "PluginDaemonInnerError":
        return False
    message = envelope.get("message")
    if not isinstance(message, str):
        return False
    return (
        re.fullmatch(
            r"Error sending request to serverless: all (?P<count>[1-9]|1[0-6]) attempts failed, "
            r"last error: attempt (?P=count)/(?P=count) failed with status code: 502",
            message,
        )
        is not None
    )


class PluginModelClient(BasePluginClient):
    def ensure_model_metadata_ready(
        self,
        *,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        plugin_unique_identifier: str,
        check: Callable[[], None],
    ) -> None:
        """Read fresh predefined LLM metadata with at most one gateway retry.

        Preconditions: the caller qualified the pinned predefined model and
        supplies current admission checks. Credentials and inference payloads
        are never sent. Success verifies matching fresh metadata; failure never
        dispatches inference or changes credentials, permissions or cache TTLs.
        The body deadline is checked per raw chunk, with up to one final read
        inactivity wait (at most five seconds); it is not a hard wall deadline.
        """
        deadline = time.monotonic() + _MODEL_METADATA_READINESS_BUDGET_SECONDS

        def read() -> None:
            check()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise InvokeServerUnavailableError(description="Plugin model metadata service unavailable.")
            try:
                with use_plugin_daemon_request_timeout(min(remaining, 5.0), metadata_deadline=deadline):
                    schema = self.get_model_schema(
                        tenant_id=tenant_id,
                        user_id=user_id,
                        plugin_id=plugin_id,
                        provider=provider,
                        model_type=ModelType.LLM.value,
                        model=model,
                        credentials={},
                        plugin_unique_identifier=plugin_unique_identifier,
                    )
            finally:
                check()
            if time.monotonic() >= deadline:
                raise InvokeServerUnavailableError(description="Plugin model metadata service unavailable.")
            if schema is None or schema.model != model or schema.model_type != ModelType.LLM:
                raise ValueError("Plugin model metadata schema does not match the prepared model")

        try:
            read()
        except PluginInvokeError as error:
            if not _metadata_gateway_unavailable(error):
                raise
            check()
            time.sleep(min(0.5, max(0.0, deadline - time.monotonic())))
            check()
            try:
                read()
            except PluginInvokeError as retry_error:
                if not _metadata_gateway_unavailable(retry_error):
                    raise
                raise InvokeServerUnavailableError(
                    description="Plugin model metadata service unavailable."
                ) from retry_error

    @staticmethod
    def _dispatch_payload(*, user_id: str | None, data: dict[str, Any], app_id: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"data": data}
        if user_id is not None:
            payload["user_id"] = user_id
        if app_id is not None:
            payload["app_id"] = app_id
        return payload

    def fetch_model_providers(self, tenant_id: str) -> Sequence[PluginModelProviderEntity]:
        """
        Fetch model providers for the given tenant.
        """
        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/models",
            list[PluginModelProviderEntity],
            params={"page": 1, "page_size": 256},
        )
        return response

    def fetch_model_provider_bindings(self, tenant_id: str) -> Sequence[PluginModelProviderBinding]:
        """Fetch only model-provider installation identities from the daemon."""
        return self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/models/bindings",
            list[PluginModelProviderBinding],
        )

    def get_model_schema(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict[str, Any],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> AIModelEntity | None:
        """
        Get model schema
        """
        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/model/schema",
            PluginModelSchemaEntity,
            data=self._dispatch_payload(
                user_id=user_id,
                data={
                    "provider": provider,
                    "model_type": model_type,
                    "model": model,
                    "credentials": credentials,
                },
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp.model_schema

        return None

    def validate_provider_credentials(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        credentials: dict[str, Any],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> bool:
        """
        validate the credentials of the provider
        """
        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/model/validate_provider_credentials",
            PluginBasicBooleanResponse,
            data=self._dispatch_payload(
                user_id=user_id,
                data={
                    "provider": provider,
                    "credentials": credentials,
                },
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            if resp.credentials and isinstance(resp.credentials, dict):
                credentials.update(resp.credentials)

            return resp.result

        return False

    def validate_model_credentials(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict[str, Any],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> bool:
        """
        validate the credentials of the provider
        """
        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/model/validate_model_credentials",
            PluginBasicBooleanResponse,
            data=self._dispatch_payload(
                user_id=user_id,
                data={
                    "provider": provider,
                    "model_type": model_type,
                    "model": model,
                    "credentials": credentials,
                },
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            if resp.credentials and isinstance(resp.credentials, dict):
                credentials.update(resp.credentials)

            return resp.result

        return False

    def invoke_llm(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, Any] | None = None,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        app_id: str | None = None,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> Generator[LLMResultChunk]:
        """
        Invoke llm
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/llm/invoke",
            type_=LLMResultChunk,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "llm",
                        "model": model,
                        "credentials": credentials,
                        "prompt_messages": prompt_messages,
                        "model_parameters": model_parameters,
                        "tools": tools,
                        "stop": stop,
                        "stream": stream,
                    },
                    app_id=app_id,
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        try:
            yield from response
        except PluginDaemonInnerError as e:
            raise ValueError(e.message + str(e.code)) from e

    def start_llm_polling(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, Any] | None = None,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        json_schema: dict[str, Any] | None = None,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> LLMPollingResult:
        """Start an LLM polling request for plugin-backed long-running jobs."""
        try:
            return self._request_with_plugin_daemon_response(
                method="POST",
                path=f"plugin/{tenant_id}/dispatch/model/polling/start",
                type_=LLMPollingResult,
                data=jsonable_encoder(
                    self._dispatch_payload(
                        user_id=user_id,
                        data={
                            "provider": provider,
                            "model_type": ModelType.LLM.value,
                            "model": model,
                            "credentials": credentials,
                            "prompt_messages": prompt_messages,
                            "model_parameters": model_parameters,
                            "tools": tools,
                            "stop": stop,
                            "stream": False,
                            "json_schema": json_schema,
                        },
                    )
                ),
                headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
            )
        except PluginInvokeError as error:
            self._raise_typed_polling_unsupported_error(error)
            raise

    def check_llm_polling(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        plugin_state: dict[str, Any],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> LLMPollingResult:
        """Check the latest state for a plugin-backed LLM polling job."""
        try:
            return self._request_with_plugin_daemon_response(
                method="POST",
                path=f"plugin/{tenant_id}/dispatch/model/polling/check",
                type_=LLMPollingResult,
                data=jsonable_encoder(
                    self._dispatch_payload(
                        user_id=user_id,
                        data={
                            "provider": provider,
                            "model_type": ModelType.LLM.value,
                            "model": model,
                            "credentials": credentials,
                            "plugin_state": plugin_state,
                        },
                    )
                ),
                headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
            )
        except PluginInvokeError as error:
            self._raise_typed_polling_unsupported_error(error)
            raise

    @staticmethod
    def _raise_typed_polling_unsupported_error(error: PluginInvokeError) -> None:
        """Convert plugin polling capability failures into a dedicated Dify exception."""
        if error.get_error_type() == PluginLLMPollingUnsupportedError.__name__:
            raise PluginLLMPollingUnsupportedError(description=error.description) from error

        if (
            error.get_error_type() in _POLLING_UNSUPPORTED_INVOKE_ERROR_TYPES
            # This is ugly, we should not rely on error messages while checking
            # error types.
            and _POLLING_UNSUPPORTED_ERROR_MESSAGE in error.get_error_message().lower()
        ):
            raise PluginLLMPollingUnsupportedError(description=error.description) from error

    def get_llm_num_tokens(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict[str, Any],
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool] | None = None,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> int:
        """
        Get number of tokens for llm
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/llm/num_tokens",
            type_=PluginLLMNumTokensResponse,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": model_type,
                        "model": model,
                        "credentials": credentials,
                        "prompt_messages": prompt_messages,
                        "tools": tools,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp.num_tokens

        return 0

    def invoke_text_embedding(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        texts: list[str],
        input_type: str,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> EmbeddingResult:
        """
        Invoke text embedding
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/text_embedding/invoke",
            type_=EmbeddingResult,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "text-embedding",
                        "model": model,
                        "credentials": credentials,
                        "texts": texts,
                        "input_type": input_type,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp

        raise ValueError("Failed to invoke text embedding")

    def invoke_multimodal_embedding(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        documents: list[dict],
        input_type: str,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> EmbeddingResult:
        """
        Invoke file embedding
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/multimodal_embedding/invoke",
            type_=EmbeddingResult,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "text-embedding",
                        "model": model,
                        "credentials": credentials,
                        "documents": documents,
                        "input_type": input_type,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp

        raise ValueError("Failed to invoke file embedding")

    def get_text_embedding_num_tokens(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        texts: list[str],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> list[int]:
        """
        Get number of tokens for text embedding
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/text_embedding/num_tokens",
            type_=PluginTextEmbeddingNumTokensResponse,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "text-embedding",
                        "model": model,
                        "credentials": credentials,
                        "texts": texts,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp.num_tokens

        return []

    def invoke_rerank(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        query: str,
        docs: list[str],
        score_threshold: float | None = None,
        top_n: int | None = None,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> RerankResult:
        """
        Invoke rerank
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/rerank/invoke",
            type_=RerankResult,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "rerank",
                        "model": model,
                        "credentials": credentials,
                        "query": query,
                        "docs": docs,
                        "score_threshold": score_threshold,
                        "top_n": top_n,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp

        raise ValueError("Failed to invoke rerank")

    def invoke_multimodal_rerank(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        query: MultimodalRerankInput,
        docs: list[MultimodalRerankInput],
        score_threshold: float | None = None,
        top_n: int | None = None,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> RerankResult:
        """
        Invoke multimodal rerank
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/multimodal_rerank/invoke",
            type_=RerankResult,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "rerank",
                        "model": model,
                        "credentials": credentials,
                        "query": query,
                        "docs": docs,
                        "score_threshold": score_threshold,
                        "top_n": top_n,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )
        for resp in response:
            return resp

        raise ValueError("Failed to invoke multimodal rerank")

    def invoke_tts(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        content_text: str,
        voice: str,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> Generator[TTSAudioChunk]:
        """
        Invoke tts
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/tts/invoke",
            type_=PluginTTSResultResponse,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "tts",
                        "model": model,
                        "credentials": credentials,
                        "tenant_id": tenant_id,
                        "content_text": content_text,
                        "voice": voice,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        try:
            for result in response:
                hex_str = result.result
                yield TTSAudioChunk(binascii.unhexlify(hex_str), mime_type=result.mime_type)
        except PluginDaemonInnerError as e:
            raise ValueError(e.message + str(e.code)) from e

    def get_tts_model_voices(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        language: str | None = None,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> list[TTSModelVoice]:
        """
        Get tts model voices
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/tts/model/voices",
            type_=PluginVoicesResponse,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "tts",
                        "model": model,
                        "credentials": credentials,
                        "language": language,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            voices: list[TTSModelVoice] = []
            for voice in resp.voices:
                voices.append({"name": voice.name, "value": voice.value})

            return voices

        return []

    def invoke_speech_to_text(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        file: IO[bytes],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> str:
        """
        Invoke speech to text
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/speech2text/invoke",
            type_=PluginStringResultResponse,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "speech2text",
                        "model": model,
                        "credentials": credentials,
                        "file": binascii.hexlify(file.read()).decode(),
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp.result

        raise ValueError("Failed to invoke speech to text")

    def invoke_moderation(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        text: str,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> bool:
        """
        Invoke moderation
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/moderation/invoke",
            type_=PluginBasicBooleanResponse,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "moderation",
                        "model": model,
                        "credentials": credentials,
                        "text": text,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp.result

        raise ValueError("Failed to invoke moderation")
