import binascii
from collections import OrderedDict
from collections.abc import Generator, Iterable, Sequence
from hashlib import sha256
from threading import Lock
from typing import IO, Any, Self

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
from core.plugin.impl.base import BasePluginClient
from core.plugin.impl.exc import PluginInvokeError, PluginLLMPollingUnsupportedError
from graphon.model_runtime.entities.llm_entities import LLMPollingResult, LLMResultChunk
from graphon.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from graphon.model_runtime.entities.rerank_entities import MultimodalRerankInput, RerankResult
from graphon.model_runtime.entities.text_embedding_entities import EmbeddingResult
from graphon.model_runtime.protocols.tts_runtime import TTSModelVoice
from graphon.model_runtime.utils.encoders import jsonable_encoder
from services.plugin.dispatch_identity import plugin_dispatch_headers

_POLLING_UNSUPPORTED_INVOKE_ERROR_TYPES = frozenset((NotImplementedError.__name__,))
_POLLING_UNSUPPORTED_ERROR_MESSAGE = "does not support polling"


class PluginModelProviderListing(tuple[PluginModelProviderEntity, ...]):
    """Model providers validated from one daemon listing response.

    ``payload_key`` is the length and SHA-256 of the response body the providers were parsed
    from. Two listings with equal keys hold equal providers, so work derived only from a listing
    can be reused for as long as the daemon keeps returning the same bytes. Listings are shared
    between callers and must be treated as read-only.
    """

    payload_key: tuple[int, bytes]

    def __new__(cls, providers: Iterable[PluginModelProviderEntity], payload_key: tuple[int, bytes]) -> Self:
        listing = super().__new__(cls, providers)
        listing.payload_key = payload_key
        return listing


class PluginModelClient(BasePluginClient):
    # The daemon answers a tenant's provider listing with identical bytes until that tenant's
    # plugins change, and validating the listing costs far more than fetching it. Keep the
    # validated listings of the most recently seen response bodies. A changed body has a
    # different key, so nothing here can go stale; the small LRU bounds per-process memory.
    MODEL_PROVIDER_LISTING_CACHE_MAX_ENTRIES = 8
    _model_provider_listing_cache: OrderedDict[tuple[int, bytes], PluginModelProviderListing] = OrderedDict()
    _model_provider_listing_cache_lock = Lock()

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

        The daemon is asked on every call. The response is validated only when its body differs
        from the bodies seen most recently; otherwise the listing validated earlier is returned.
        Postcondition: the result equals what validating this call's response would produce.
        """
        path = f"plugin/{tenant_id}/management/models"
        response = self._request_plugin_daemon("GET", path, params={"page": 1, "page_size": 256})
        payload = response.content
        payload_key = (len(payload), sha256(payload).digest())

        cache = self._model_provider_listing_cache
        with self._model_provider_listing_cache_lock:
            listing = cache.get(payload_key)
            if listing is not None:
                cache.move_to_end(payload_key)
                return listing

        providers = self._parse_plugin_daemon_response(response, path, list[PluginModelProviderEntity])
        listing = PluginModelProviderListing(providers, payload_key)
        with self._model_provider_listing_cache_lock:
            cache[payload_key] = listing
            cache.move_to_end(payload_key)
            while len(cache) > self.MODEL_PROVIDER_LISTING_CACHE_MAX_ENTRIES:
                cache.popitem(last=False)
        return listing

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
