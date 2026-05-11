from __future__ import annotations

import hashlib
import logging
from collections.abc import Generator, Iterable, Sequence
from threading import Lock
from typing import IO, Any, Literal, cast, overload

from pydantic import ValidationError
from redis import RedisError

from configs import dify_config
from core.llm_generator.output_parser.structured_output import (
    invoke_llm_with_structured_output as invoke_llm_with_structured_output_helper,
)
from core.plugin.entities.plugin_daemon import PluginModelProviderEntity
from core.plugin.impl.asset import PluginAssetManager
from core.plugin.impl.model import PluginModelClient
from extensions.ext_redis import redis_client
from graphon.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkWithStructuredOutput,
    LLMResultWithStructuredOutput,
)
from graphon.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from graphon.model_runtime.entities.rerank_entities import MultimodalRerankInput, RerankResult
from graphon.model_runtime.entities.text_embedding_entities import EmbeddingInputType, EmbeddingResult
from graphon.model_runtime.model_providers.base.large_language_model import normalize_non_stream_runtime_result
from graphon.model_runtime.protocols.runtime import ModelRuntime
from models.provider_ids import ModelProviderID

logger = logging.getLogger(__name__)

# `TS` means tenant scope
TENANT_SCOPE_SCHEMA_CACHE_USER_ID = "__DIFY_TS__"


# TODO(-LAN-): Move native structured-output invocation into Graphon's LLM node.
# TODO(-LAN-): Remove this Dify-side adapter once Graphon owns structured output end-to-end.
class _PluginStructuredOutputModelInstance:
    """Bind plugin model identity to the shared structured-output helper.

    The structured-output parser is shared with legacy ``ModelInstance`` flows
    and only needs an object exposing ``invoke_llm(...)``. ``PluginModelRuntime``
    intentionally exposes a lower-level API where provider, model, and
    credentials are passed per call. This adapter supplies the small bound
    ``invoke_llm`` surface the helper needs without constructing a full
    ``ModelInstance`` or reintroducing model-manager dependencies into the
    plugin runtime path.
    """

    def __init__(
        self,
        *,
        runtime: PluginModelRuntime,
        provider: str,
        model: str,
        credentials: dict[str, Any],
    ) -> None:
        self._runtime = runtime
        self._provider = provider
        self._model = model
        self._credentials = credentials

    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: dict[str, Any] | None = None,
        tools: Sequence[PromptMessageTool] | None = None,
        stop: Sequence[str] | None = None,
        stream: bool = True,
        callbacks: object | None = None,
    ) -> LLMResult | Generator[LLMResultChunk, None, None]:
        del callbacks
        if stream:
            return self._runtime.invoke_llm(
                provider=self._provider,
                model=self._model,
                credentials=self._credentials,
                model_parameters=model_parameters or {},
                prompt_messages=prompt_messages,
                tools=list(tools) if tools else None,
                stop=stop,
                stream=True,
            )

        return self._runtime.invoke_llm(
            provider=self._provider,
            model=self._model,
            credentials=self._credentials,
            model_parameters=model_parameters or {},
            prompt_messages=prompt_messages,
            tools=list(tools) if tools else None,
            stop=stop,
            stream=False,
        )


class PluginModelRuntime(ModelRuntime):
    """Plugin-backed runtime adapter bound to tenant context and optional caller scope."""

    tenant_id: str
    user_id: str | None
    client: PluginModelClient
    _provider_entities: tuple[ProviderEntity, ...] | None
    _provider_entities_lock: Lock

    def __init__(self, tenant_id: str, user_id: str | None, client: PluginModelClient) -> None:
        if client is None:
            raise ValueError("client is required.")
        self.tenant_id = tenant_id
        self.user_id = user_id
        self.client = client
        self._provider_entities = None
        self._provider_entities_lock = Lock()

    def fetch_model_providers(self) -> Sequence[ProviderEntity]:
        if self._provider_entities is not None:
            return self._provider_entities

        with self._provider_entities_lock:
            if self._provider_entities is None:
                self._provider_entities = tuple(
                    self._to_provider_entity(provider) for provider in self.client.fetch_model_providers(self.tenant_id)
                )

        return self._provider_entities

    def get_provider_icon(self, *, provider: str, icon_type: str, lang: str) -> tuple[bytes, str]:
        provider_schema = self._get_provider_schema(provider)

        if icon_type.lower() == "icon_small":
            if not provider_schema.icon_small:
                raise ValueError(f"Provider {provider} does not have small icon.")
            file_name = (
                provider_schema.icon_small.zh_hans if lang.lower() == "zh_hans" else provider_schema.icon_small.en_us
            )
        elif icon_type.lower() == "icon_small_dark":
            if not provider_schema.icon_small_dark:
                raise ValueError(f"Provider {provider} does not have small dark icon.")
            file_name = (
                provider_schema.icon_small_dark.zh_hans
                if lang.lower() == "zh_hans"
                else provider_schema.icon_small_dark.en_us
            )
        else:
            raise ValueError(f"Unsupported icon type: {icon_type}.")

        if not file_name:
            raise ValueError(f"Provider {provider} does not have icon.")

        image_mime_types = {
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "png": "image/png",
            "gif": "image/gif",
            "bmp": "image/bmp",
            "tiff": "image/tiff",
            "tif": "image/tiff",
            "webp": "image/webp",
            "svg": "image/svg+xml",
            "ico": "image/vnd.microsoft.icon",
            "heif": "image/heif",
            "heic": "image/heic",
        }

        extension = file_name.split(".")[-1]
        mime_type = image_mime_types.get(extension, "image/png")
        return PluginAssetManager().fetch_asset(tenant_id=self.tenant_id, id=file_name), mime_type

    def validate_provider_credentials(self, *, provider: str, credentials: dict[str, Any]) -> None:
        plugin_id, provider_name = self._split_provider(provider)
        self.client.validate_provider_credentials(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            credentials=credentials,
        )

    def validate_model_credentials(
        self,
        *,
        provider: str,
        model_type: ModelType,
        model: str,
        credentials: dict[str, Any],
    ) -> None:
        plugin_id, provider_name = self._split_provider(provider)
        self.client.validate_model_credentials(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            model_type=model_type.value,
            model=model,
            credentials=credentials,
        )

    def get_model_schema(
        self,
        *,
        provider: str,
        model_type: ModelType,
        model: str,
        credentials: dict[str, Any],
    ) -> AIModelEntity | None:
        cache_key = self._get_schema_cache_key(
            provider=provider,
            model_type=model_type,
            model=model,
            credentials=credentials,
        )

        cached_schema_json = None
        try:
            cached_schema_json = redis_client.get(cache_key)
        except (RedisError, RuntimeError) as exc:
            logger.warning(
                "Failed to read plugin model schema cache for model %s: %s",
                model,
                str(exc),
                exc_info=True,
            )

        if cached_schema_json:
            try:
                return AIModelEntity.model_validate_json(cached_schema_json)
            except ValidationError:
                logger.warning("Failed to validate cached plugin model schema for model %s", model, exc_info=True)
                try:
                    redis_client.delete(cache_key)
                except (RedisError, RuntimeError) as exc:
                    logger.warning(
                        "Failed to delete invalid plugin model schema cache for model %s: %s",
                        model,
                        str(exc),
                        exc_info=True,
                    )

        plugin_id, provider_name = self._split_provider(provider)
        schema = self.client.get_model_schema(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            model_type=model_type.value,
            model=model,
            credentials=credentials,
        )

        if schema:
            try:
                redis_client.setex(cache_key, dify_config.PLUGIN_MODEL_SCHEMA_CACHE_TTL, schema.model_dump_json())
            except (RedisError, RuntimeError) as exc:
                logger.warning(
                    "Failed to write plugin model schema cache for model %s: %s",
                    model,
                    str(exc),
                    exc_info=True,
                )

        return schema

    @overload
    def invoke_llm(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        model_parameters: dict[str, Any],
        prompt_messages: Sequence[PromptMessage],
        tools: list[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: Literal[False],
    ) -> LLMResult: ...

    @overload
    def invoke_llm(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        model_parameters: dict[str, Any],
        prompt_messages: Sequence[PromptMessage],
        tools: list[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: Literal[True],
    ) -> Generator[LLMResultChunk, None, None]: ...

    def invoke_llm(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        model_parameters: dict[str, Any],
        prompt_messages: Sequence[PromptMessage],
        tools: list[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: bool,
    ) -> LLMResult | Generator[LLMResultChunk, None, None]:
        plugin_id, provider_name = self._split_provider(provider)
        result = self.client.invoke_llm(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            model=model,
            credentials=credentials,
            model_parameters=model_parameters,
            prompt_messages=list(prompt_messages),
            tools=tools,
            stop=list(stop) if stop else None,
            stream=stream,
        )
        if stream:
            return result

        return normalize_non_stream_runtime_result(
            model=model,
            prompt_messages=prompt_messages,
            result=result,
        )

    @overload
    def invoke_llm_with_structured_output(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        json_schema: dict[str, Any],
        model_parameters: dict[str, Any],
        prompt_messages: Sequence[PromptMessage],
        stop: Sequence[str] | None,
        stream: Literal[False],
    ) -> LLMResultWithStructuredOutput: ...

    @overload
    def invoke_llm_with_structured_output(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        json_schema: dict[str, Any],
        model_parameters: dict[str, Any],
        prompt_messages: Sequence[PromptMessage],
        stop: Sequence[str] | None,
        stream: Literal[True],
    ) -> Generator[LLMResultChunkWithStructuredOutput, None, None]: ...

    def invoke_llm_with_structured_output(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        json_schema: dict[str, Any],
        model_parameters: dict[str, Any],
        prompt_messages: Sequence[PromptMessage],
        stop: Sequence[str] | None,
        stream: bool,
    ) -> LLMResultWithStructuredOutput | Generator[LLMResultChunkWithStructuredOutput, None, None]:
        model_schema = self.get_model_schema(
            provider=provider,
            model_type=ModelType.LLM,
            model=model,
            credentials=credentials,
        )
        if model_schema is None:
            raise ValueError(f"Model schema not found for {model}")

        adapter = _PluginStructuredOutputModelInstance(
            runtime=self,
            provider=provider,
            model=model,
            credentials=credentials,
        )
        return invoke_llm_with_structured_output_helper(
            provider=provider,
            model_schema=model_schema,
            model_instance=cast(Any, adapter),
            prompt_messages=prompt_messages,
            json_schema=json_schema,
            model_parameters=model_parameters,
            tools=None,
            stop=list(stop) if stop else None,
            stream=stream,
        )

    def get_llm_num_tokens(
        self,
        *,
        provider: str,
        model_type: ModelType,
        model: str,
        credentials: dict[str, Any],
        prompt_messages: Sequence[PromptMessage],
        tools: Sequence[PromptMessageTool] | None,
    ) -> int:
        if not dify_config.PLUGIN_BASED_TOKEN_COUNTING_ENABLED:
            return 0

        plugin_id, provider_name = self._split_provider(provider)
        return self.client.get_llm_num_tokens(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            model_type=model_type.value,
            model=model,
            credentials=credentials,
            prompt_messages=list(prompt_messages),
            tools=list(tools) if tools else None,
        )

    def invoke_text_embedding(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        texts: list[str],
        input_type: EmbeddingInputType,
    ) -> EmbeddingResult:
        plugin_id, provider_name = self._split_provider(provider)
        return self.client.invoke_text_embedding(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            model=model,
            credentials=credentials,
            texts=texts,
            input_type=input_type,
        )

    def invoke_multimodal_embedding(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        documents: list[dict[str, Any]],
        input_type: EmbeddingInputType,
    ) -> EmbeddingResult:
        plugin_id, provider_name = self._split_provider(provider)
        return self.client.invoke_multimodal_embedding(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            model=model,
            credentials=credentials,
            documents=documents,
            input_type=input_type,
        )

    def get_text_embedding_num_tokens(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        texts: list[str],
    ) -> list[int]:
        plugin_id, provider_name = self._split_provider(provider)
        return self.client.get_text_embedding_num_tokens(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            model=model,
            credentials=credentials,
            texts=texts,
        )

    def invoke_rerank(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        query: str,
        docs: list[str],
        score_threshold: float | None,
        top_n: int | None,
    ) -> RerankResult:
        plugin_id, provider_name = self._split_provider(provider)
        return self.client.invoke_rerank(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            model=model,
            credentials=credentials,
            query=query,
            docs=docs,
            score_threshold=score_threshold,
            top_n=top_n,
        )

    def invoke_multimodal_rerank(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        query: MultimodalRerankInput,
        docs: list[MultimodalRerankInput],
        score_threshold: float | None,
        top_n: int | None,
    ) -> RerankResult:
        plugin_id, provider_name = self._split_provider(provider)
        return self.client.invoke_multimodal_rerank(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            model=model,
            credentials=credentials,
            query=query,
            docs=docs,
            score_threshold=score_threshold,
            top_n=top_n,
        )

    def invoke_tts(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        content_text: str,
        voice: str,
    ) -> Iterable[bytes]:
        plugin_id, provider_name = self._split_provider(provider)
        return self.client.invoke_tts(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            model=model,
            credentials=credentials,
            content_text=content_text,
            voice=voice,
        )

    def get_tts_model_voices(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        language: str | None,
    ) -> Any:
        plugin_id, provider_name = self._split_provider(provider)
        return self.client.get_tts_model_voices(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            model=model,
            credentials=credentials,
            language=language,
        )

    def invoke_speech_to_text(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        file: IO[bytes],
    ) -> str:
        plugin_id, provider_name = self._split_provider(provider)
        return self.client.invoke_speech_to_text(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            model=model,
            credentials=credentials,
            file=file,
        )

    def invoke_moderation(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        text: str,
    ) -> bool:
        plugin_id, provider_name = self._split_provider(provider)
        return self.client.invoke_moderation(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            model=model,
            credentials=credentials,
            text=text,
        )

    def _get_provider_short_name_alias(self, provider: PluginModelProviderEntity) -> str:
        """
        Expose a bare provider alias only for the canonical provider mapping.

        Multiple plugins can publish the same short provider slug. If every
        provider entity keeps that slug in ``provider_name``, callers that still
        resolve by short name become order-dependent. Restrict the alias to the
        provider selected by ``ModelProviderID`` so legacy short-name lookups
        remain deterministic while the runtime surface stays canonical.
        """
        try:
            canonical_provider_id = ModelProviderID(provider.provider)
        except ValueError:
            return ""

        if canonical_provider_id.plugin_id != provider.plugin_id:
            return ""
        if canonical_provider_id.provider_name != provider.provider:
            return ""

        return provider.provider

    def _to_provider_entity(self, provider: PluginModelProviderEntity) -> ProviderEntity:
        declaration = provider.declaration.model_copy(deep=True)
        declaration.provider = f"{provider.plugin_id}/{provider.provider}"
        declaration.provider_name = self._get_provider_short_name_alias(provider)
        return declaration

    def _get_provider_schema(self, provider: str) -> ProviderEntity:
        providers = self.fetch_model_providers()
        provider_entity = next((item for item in providers if item.provider == provider), None)
        if provider_entity is None:
            provider_entity = next((item for item in providers if provider == item.provider_name), None)
        if provider_entity is None:
            raise ValueError(f"Invalid provider: {provider}")
        return provider_entity

    def _get_schema_cache_key(
        self,
        *,
        provider: str,
        model_type: ModelType,
        model: str,
        credentials: dict[str, Any],
    ) -> str:
        # The plugin daemon distinguishes ``None`` from an explicit empty-string
        # caller id, so the cache must only collapse ``None`` into tenant scope.
        cache_user_id = TENANT_SCOPE_SCHEMA_CACHE_USER_ID if self.user_id is None else self.user_id
        cache_key = f"{self.tenant_id}:{provider}:{model_type.value}:{model}:{cache_user_id}"
        sorted_credentials = sorted(credentials.items()) if credentials else []
        if not sorted_credentials:
            return cache_key
        hashed_credentials = ":".join(
            [hashlib.md5(f"{key}:{value}".encode()).hexdigest() for key, value in sorted_credentials]
        )
        return f"{cache_key}:{hashed_credentials}"

    def _split_provider(self, provider: str) -> tuple[str, str]:
        provider_id = ModelProviderID(provider)
        return provider_id.plugin_id, provider_id.provider_name
