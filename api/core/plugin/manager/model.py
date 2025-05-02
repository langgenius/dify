import binascii
from collections.abc import Generator, Sequence
from typing import IO, Optional

from core.model_runtime.entities.llm_entities import LLMResultChunk
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from core.model_runtime.entities.model_entities import AIModelEntity
from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.entities.plugin_daemon import (
    PluginBasicBooleanResponse,
    PluginDaemonInnerError,
    PluginLLMNumTokensResponse,
    PluginModelProviderEntity,
    PluginModelSchemaEntity,
    PluginStringResultResponse,
    PluginTextEmbeddingNumTokensResponse,
    PluginVoicesResponse,
)
from core.plugin.manager.base import BasePluginManager


class PluginModelManager(BasePluginManager):
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
        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/model/schema",
            PluginModelSchemaEntity,
            data={
                "user_id": user_id,
                "data": {
                    "provider": provider,
                    "model_type": model_type,
                    "model": model,
                    "credentials": credentials,
                },
            },
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp.model_schema

        return None

    def validate_provider_credentials(
        self, tenant_id: str, user_id: str, plugin_id: str, provider: str, credentials: dict
    ) -> bool:
        """
        validate the credentials of the provider
        """
        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/model/validate_provider_credentials",
            PluginBasicBooleanResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": provider,
                    "credentials": credentials,
                },
            },
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            if resp.credentials and isinstance(resp.credentials, dict):
                credentials.update(resp.credentials)

            return resp.result

        return False

    def validate_model_credentials(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict,
    ) -> bool:
        """
        validate the credentials of the provider
        """
        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/model/validate_model_credentials",
            PluginBasicBooleanResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": provider,
                    "model_type": model_type,
                    "model": model,
                    "credentials": credentials,
                },
            },
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            if resp.credentials and isinstance(resp.credentials, dict):
                credentials.update(resp.credentials)

            return resp.result

        return False

    def invoke_llm(
        self,
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
    ) -> Generator[LLMResultChunk, None, None]:
        """
        Invoke llm
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/llm/invoke",
            type=LLMResultChunk,
            data=jsonable_encoder(
                {
                    "user_id": user_id,
                    "data": {
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
                }
            ),
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        try:
            yield from response
        except PluginDaemonInnerError as e:
            raise ValueError(e.message + str(e.code))

    def get_llm_num_tokens(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
    ) -> int:
        """
        Get number of tokens for llm
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/llm/num_tokens",
            type=PluginLLMNumTokensResponse,
            data=jsonable_encoder(
                {
                    "user_id": user_id,
                    "data": {
                        "provider": provider,
                        "model_type": model_type,
                        "model": model,
                        "credentials": credentials,
                        "prompt_messages": prompt_messages,
                        "tools": tools,
                    },
                }
            ),
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp.num_tokens

        return 0

    def invoke_text_embedding(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict,
        texts: list[str],
        input_type: str,
    ) -> TextEmbeddingResult:
        """
        Invoke text embedding
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/text_embedding/invoke",
            type=TextEmbeddingResult,
            data=jsonable_encoder(
                {
                    "user_id": user_id,
                    "data": {
                        "provider": provider,
                        "model_type": "text-embedding",
                        "model": model,
                        "credentials": credentials,
                        "texts": texts,
                        "input_type": input_type,
                    },
                }
            ),
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp

        raise ValueError("Failed to invoke text embedding")

    def get_text_embedding_num_tokens(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict,
        texts: list[str],
    ) -> list[int]:
        """
        Get number of tokens for text embedding
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/text_embedding/num_tokens",
            type=PluginTextEmbeddingNumTokensResponse,
            data=jsonable_encoder(
                {
                    "user_id": user_id,
                    "data": {
                        "provider": provider,
                        "model_type": "text-embedding",
                        "model": model,
                        "credentials": credentials,
                        "texts": texts,
                    },
                }
            ),
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp.num_tokens

        return []

    def invoke_rerank(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict,
        query: str,
        docs: list[str],
        score_threshold: Optional[float] = None,
        top_n: Optional[int] = None,
    ) -> RerankResult:
        """
        Invoke rerank
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/rerank/invoke",
            type=RerankResult,
            data=jsonable_encoder(
                {
                    "user_id": user_id,
                    "data": {
                        "provider": provider,
                        "model_type": "rerank",
                        "model": model,
                        "credentials": credentials,
                        "query": query,
                        "docs": docs,
                        "score_threshold": score_threshold,
                        "top_n": top_n,
                    },
                }
            ),
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp

        raise ValueError("Failed to invoke rerank")

    def invoke_tts(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict,
        content_text: str,
        voice: str,
    ) -> Generator[bytes, None, None]:
        """
        Invoke tts
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/tts/invoke",
            type=PluginStringResultResponse,
            data=jsonable_encoder(
                {
                    "user_id": user_id,
                    "data": {
                        "provider": provider,
                        "model_type": "tts",
                        "model": model,
                        "credentials": credentials,
                        "tenant_id": tenant_id,
                        "content_text": content_text,
                        "voice": voice,
                    },
                }
            ),
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        try:
            for result in response:
                hex_str = result.result
                yield binascii.unhexlify(hex_str)
        except PluginDaemonInnerError as e:
            raise ValueError(e.message + str(e.code))

    def get_tts_model_voices(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict,
        language: Optional[str] = None,
    ) -> list[dict]:
        """
        Get tts model voices
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/tts/model/voices",
            type=PluginVoicesResponse,
            data=jsonable_encoder(
                {
                    "user_id": user_id,
                    "data": {
                        "provider": provider,
                        "model_type": "tts",
                        "model": model,
                        "credentials": credentials,
                        "language": language,
                    },
                }
            ),
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            voices = []
            for voice in resp.voices:
                voices.append({"name": voice.name, "value": voice.value})

            return voices

        return []

    def invoke_speech_to_text(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict,
        file: IO[bytes],
    ) -> str:
        """
        Invoke speech to text
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/speech2text/invoke",
            type=PluginStringResultResponse,
            data=jsonable_encoder(
                {
                    "user_id": user_id,
                    "data": {
                        "provider": provider,
                        "model_type": "speech2text",
                        "model": model,
                        "credentials": credentials,
                        "file": binascii.hexlify(file.read()).decode(),
                    },
                }
            ),
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp.result

        raise ValueError("Failed to invoke speech to text")

    def invoke_moderation(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict,
        text: str,
    ) -> bool:
        """
        Invoke moderation
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/moderation/invoke",
            type=PluginBasicBooleanResponse,
            data=jsonable_encoder(
                {
                    "user_id": user_id,
                    "data": {
                        "provider": provider,
                        "model_type": "moderation",
                        "model": model,
                        "credentials": credentials,
                        "text": text,
                    },
                }
            ),
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp.result

        raise ValueError("Failed to invoke moderation")
