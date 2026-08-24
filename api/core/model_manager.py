import logging
from collections.abc import Callable, Generator, Iterable, Mapping, Sequence
from copy import deepcopy
from typing import IO, Any, Literal, Optional, ParamSpec, TypeVar, Union, cast, overload, override
from uuid import UUID

from configs import dify_config
from core.entities import PluginCredentialType
from core.entities.embedding_type import EmbeddingInputType
from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import ModelLoadBalancingConfiguration
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from core.provider_manager import ProviderManager
from extensions.ext_redis import redis_client
from graphon.model_runtime.callbacks.base_callback import Callback
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelFeature, ModelType
from graphon.model_runtime.entities.rerank_entities import MultimodalRerankInput, RerankResult
from graphon.model_runtime.entities.text_embedding_entities import EmbeddingResult
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeConnectionError, InvokeRateLimitError
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from graphon.model_runtime.model_providers.base.moderation_model import ModerationModel
from graphon.model_runtime.model_providers.base.rerank_model import RerankModel
from graphon.model_runtime.model_providers.base.speech2text_model import Speech2TextModel
from graphon.model_runtime.model_providers.base.text_embedding_model import TextEmbeddingModel
from graphon.model_runtime.model_providers.base.tts_model import TTSModel
from models.provider import ProviderType

logger = logging.getLogger(__name__)
P = ParamSpec("P")
R = TypeVar("R")


class ModelInstance:
    """
    Model instance class.
    """

    def __init__(self, provider_model_bundle: ProviderModelBundle, model: str, credentials: dict | None = None) -> None:
        self.provider_model_bundle = provider_model_bundle
        self.model_name = model
        self.provider = provider_model_bundle.configuration.provider.provider
        if credentials is None:
            credentials = self._fetch_credentials_from_bundle(provider_model_bundle, model)
        self.credentials = credentials
        # Runtime LLM invocation fields.
        self.parameters: Mapping[str, Any] = {}
        self.stop: Sequence[str] = ()
        self.model_type_instance = self.provider_model_bundle.model_type_instance
        self.load_balancing_manager = self._get_load_balancing_manager(
            configuration=provider_model_bundle.configuration,
            model_type=provider_model_bundle.model_type_instance.model_type,
            model=model,
            credentials=self.credentials,
        )

    def get_model_schema(self) -> AIModelEntity:
        """Return the resolved schema for the current model instance."""
        model_schema = self.model_type_instance.get_model_schema(self.model_name, self.credentials)
        if model_schema is None:
            raise ValueError(f"model schema not found for {self.model_name}")
        return model_schema

    @staticmethod
    def _fetch_credentials_from_bundle(provider_model_bundle: ProviderModelBundle, model: str):
        """
        Fetch credentials from provider model bundle
        :param provider_model_bundle: provider model bundle
        :param model: model name
        :return:
        """
        configuration = provider_model_bundle.configuration
        model_type = provider_model_bundle.model_type_instance.model_type
        credentials = configuration.get_current_credentials(model_type=model_type, model=model)

        if credentials is None:
            raise ProviderTokenNotInitError(f"Model {model} credentials is not initialized.")

        return credentials

    @staticmethod
    def _get_load_balancing_manager(
        configuration: ProviderConfiguration, model_type: ModelType, model: str, credentials: dict[str, Any]
    ) -> Optional["LBModelManager"]:
        """
        Get load balancing model credentials
        :param configuration: provider configuration
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials
        :return:
        """
        if configuration.model_settings and configuration.using_provider_type == ProviderType.CUSTOM:
            current_model_setting = None
            # check if model is disabled by admin
            for model_setting in configuration.model_settings:
                if model_setting.model_type == model_type and model_setting.model == model:
                    current_model_setting = model_setting
                    break

            # check if load balancing is enabled
            if current_model_setting and current_model_setting.load_balancing_configs:
                # use load balancing proxy to choose credentials
                lb_model_manager = LBModelManager(
                    tenant_id=configuration.tenant_id,
                    provider=configuration.provider.provider,
                    model_type=model_type,
                    model=model,
                    load_balancing_configs=current_model_setting.load_balancing_configs,
                    managed_credentials=credentials if configuration.custom_configuration.provider else None,
                )

                return lb_model_manager

        return None

    @overload
    def invoke_llm(
        self,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: dict[str, Any] | None = None,
        tools: Sequence[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: Literal[True] = True,
        callbacks: list[Callback] | None = None,
        request_metadata: Mapping[str, object] | None = None,
    ) -> Generator: ...

    @overload
    def invoke_llm(
        self,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, Any] | None = None,
        tools: Sequence[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: Literal[False] = False,
        callbacks: list[Callback] | None = None,
        request_metadata: Mapping[str, object] | None = None,
    ) -> LLMResult: ...

    @overload
    def invoke_llm(
        self,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, Any] | None = None,
        tools: Sequence[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        callbacks: list[Callback] | None = None,
        request_metadata: Mapping[str, object] | None = None,
    ) -> Union[LLMResult, Generator]: ...

    def invoke_llm(
        self,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: dict[str, Any] | None = None,
        tools: Sequence[PromptMessageTool] | None = None,
        stop: Sequence[str] | None = None,
        stream: bool = True,
        callbacks: list[Callback] | None = None,
        request_metadata: Mapping[str, object] | None = None,
    ) -> Union[LLMResult, Generator]:
        """
        Invoke large language model

        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param callbacks: callbacks
        :param request_metadata: optional request metadata
        :return: full response or stream response chunk generator result
        """
        if not isinstance(self.model_type_instance, LargeLanguageModel):
            raise Exception("Model type instance is not LargeLanguageModel")
        return cast(
            Union[LLMResult, Generator],
            self._round_robin_invoke(
                self.model_type_instance.invoke,
                model=self.model_name,
                credentials=self.credentials,
                prompt_messages=list(prompt_messages),
                model_parameters=model_parameters,
                tools=list(tools) if tools else None,
                stop=list(stop) if stop else None,
                stream=stream,
                callbacks=callbacks,
                request_metadata=request_metadata,
            ),
        )

    def get_llm_num_tokens(
        self, prompt_messages: Sequence[PromptMessage], tools: Sequence[PromptMessageTool] | None = None
    ) -> int:
        """
        Get number of tokens for llm

        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return:
        """
        if not isinstance(self.model_type_instance, LargeLanguageModel):
            raise Exception("Model type instance is not LargeLanguageModel")
        return self._round_robin_invoke(
            self.model_type_instance.get_num_tokens,
            model=self.model_name,
            credentials=self.credentials,
            prompt_messages=list(prompt_messages),
            tools=list(tools) if tools else None,
        )

    def invoke_text_embedding(
        self, texts: list[str], input_type: EmbeddingInputType = EmbeddingInputType.DOCUMENT
    ) -> EmbeddingResult:
        """
        Invoke large language model

        :param texts: texts to embed
        :param input_type: input type
        :return: embeddings result
        """
        if not isinstance(self.model_type_instance, TextEmbeddingModel):
            raise Exception("Model type instance is not TextEmbeddingModel")
        return self._round_robin_invoke(
            self.model_type_instance.invoke,
            model=self.model_name,
            credentials=self.credentials,
            texts=texts,
            input_type=input_type,
        )

    def invoke_multimodal_embedding(
        self,
        multimodel_documents: list[dict],
        input_type: EmbeddingInputType = EmbeddingInputType.DOCUMENT,
    ) -> EmbeddingResult:
        """
        Invoke large language model

        :param multimodel_documents: multimodel documents to embed
        :param input_type: input type
        :return: embeddings result
        """
        if not isinstance(self.model_type_instance, TextEmbeddingModel):
            raise Exception("Model type instance is not TextEmbeddingModel")
        return self._round_robin_invoke(
            self.model_type_instance.invoke,
            model=self.model_name,
            credentials=self.credentials,
            multimodel_documents=multimodel_documents,
            input_type=input_type,
        )

    def get_text_embedding_num_tokens(self, texts: list[str]) -> list[int]:
        """
        Get number of tokens for text embedding

        :param texts: texts to embed
        :return:
        """
        if not isinstance(self.model_type_instance, TextEmbeddingModel):
            raise Exception("Model type instance is not TextEmbeddingModel")
        return self._round_robin_invoke(
            self.model_type_instance.get_num_tokens,
            model=self.model_name,
            credentials=self.credentials,
            texts=texts,
        )

    def invoke_rerank(
        self,
        query: str,
        docs: list[str],
        score_threshold: float | None = None,
        top_n: int | None = None,
    ) -> RerankResult:
        """
        Invoke rerank model

        :param query: search query
        :param docs: docs for reranking
        :param score_threshold: score threshold
        :param top_n: top n
        :return: rerank result
        """
        if not isinstance(self.model_type_instance, RerankModel):
            raise Exception("Model type instance is not RerankModel")
        return self._round_robin_invoke(
            self.model_type_instance.invoke,
            model=self.model_name,
            credentials=self.credentials,
            query=query,
            docs=docs,
            score_threshold=score_threshold,
            top_n=top_n,
        )

    def invoke_multimodal_rerank(
        self,
        query: MultimodalRerankInput,
        docs: list[MultimodalRerankInput],
        score_threshold: float | None = None,
        top_n: int | None = None,
    ) -> RerankResult:
        """
        Invoke rerank model

        :param query: search query
        :param docs: docs for reranking
        :param score_threshold: score threshold
        :param top_n: top n
        :return: rerank result
        """
        if not isinstance(self.model_type_instance, RerankModel):
            raise Exception("Model type instance is not RerankModel")
        return self._round_robin_invoke(
            self.model_type_instance.invoke_multimodal_rerank,
            model=self.model_name,
            credentials=self.credentials,
            query=query,
            docs=docs,
            score_threshold=score_threshold,
            top_n=top_n,
        )

    def invoke_moderation(self, text: str) -> bool:
        """
        Invoke moderation model

        :param text: text to moderate
        :return: false if text is safe, true otherwise
        """
        if not isinstance(self.model_type_instance, ModerationModel):
            raise Exception("Model type instance is not ModerationModel")
        return self._round_robin_invoke(
            self.model_type_instance.invoke,
            model=self.model_name,
            credentials=self.credentials,
            text=text,
        )

    def invoke_speech2text(self, file: IO[bytes]) -> str:
        """
        Invoke large language model

        :param file: audio file
        :return: text for given audio file
        """
        if not isinstance(self.model_type_instance, Speech2TextModel):
            raise Exception("Model type instance is not Speech2TextModel")
        return self._round_robin_invoke(
            self.model_type_instance.invoke,
            model=self.model_name,
            credentials=self.credentials,
            file=file,
        )

    def invoke_tts(self, content_text: str, voice: str = "") -> Iterable[bytes]:
        """
        Invoke large language tts model

        :param content_text: text content to be translated
        :param voice: model timbre
        :return: text for given audio file
        """
        if not isinstance(self.model_type_instance, TTSModel):
            raise Exception("Model type instance is not TTSModel")
        return self._round_robin_invoke(
            self.model_type_instance.invoke,
            model=self.model_name,
            credentials=self.credentials,
            content_text=content_text,
            voice=voice,
        )

    def _round_robin_invoke(self, function: Callable[P, R], *args: P.args, **kwargs: P.kwargs) -> R:
        """
        Round-robin invoke
        :param function: function to invoke
        :param args: function args
        :param kwargs: function kwargs
        :return:
        """
        if not self.load_balancing_manager:
            return function(*args, **kwargs)

        last_exception: Union[InvokeRateLimitError, InvokeAuthorizationError, InvokeConnectionError, None] = None
        while True:
            lb_config = self.load_balancing_manager.fetch_next()
            if not lb_config:
                if not last_exception:
                    raise ProviderTokenNotInitError("Model credentials is not initialized.")
                else:
                    raise last_exception

            # Additional policy compliance check as fallback (in case fetch_next didn't catch it)
            try:
                from core.helper.credential_utils import runtime_check_credential_policy_compliance

                if lb_config.credential_id:
                    runtime_check_credential_policy_compliance(
                        credential_id=lb_config.credential_id,
                        provider=self.provider,
                        credential_type=PluginCredentialType.MODEL,
                    )
            except Exception as e:
                logger.warning(
                    "Load balancing config %s failed policy compliance check in round-robin: %s", lb_config.id, str(e)
                )
                self.load_balancing_manager.cooldown(lb_config, expire=60)
                continue

            try:
                kwargs["credentials"] = lb_config.credentials
                return function(*args, **kwargs)
            except InvokeRateLimitError as e:
                # expire in 60 seconds
                self.load_balancing_manager.cooldown(lb_config, expire=60)
                last_exception = e
                continue
            except (InvokeAuthorizationError, InvokeConnectionError) as e:
                # expire in 10 seconds
                self.load_balancing_manager.cooldown(lb_config, expire=10)
                last_exception = e
                continue
            except Exception as e:
                raise e

    def get_tts_voices(self, language: str | None = None):
        """
        Invoke large language tts model voices

        :param language: tts language
        :return: tts model voices
        """
        if not isinstance(self.model_type_instance, TTSModel):
            raise Exception("Model type instance is not TTSModel")
        return self.model_type_instance.get_tts_model_voices(
            model=self.model_name, credentials=self.credentials, language=language
        )


class QuotaManagedModelInstance(ModelInstance):
    """A system-hosted model instance that owns quota settlement per invocation."""

    def reserve_quota(self, *, request_id: str | None = None):
        from core.app.llm.quota import reserve_model_quota_for_model

        return reserve_model_quota_for_model(
            tenant_id=self.provider_model_bundle.configuration.tenant_id,
            provider=self.provider,
            model_type=self.model_type_instance.model_type,
            model=self.model_name,
            request_id=request_id,
        )

    @staticmethod
    def _get_reservation_request_id(request_metadata: Mapping[str, object] | None) -> str | None:
        request_id = request_metadata.get("invocation_id") if request_metadata else None
        if not isinstance(request_id, str) or not request_id:
            return None
        try:
            return str(UUID(request_id))
        except ValueError:
            return None

    def _reserve_quota_for_request(self, request_metadata: Mapping[str, object] | None):
        request_id = self._get_reservation_request_id(request_metadata)
        if request_id is None:
            return self.reserve_quota()
        return self.reserve_quota(request_id=request_id)

    @staticmethod
    def release_quota_safely(reservation) -> None:
        try:
            reservation.release()
        except Exception:
            logger.exception("Failed to release model quota reservation")

    def _invoke_with_quota(self, function: Callable[P, R], *args: P.args, **kwargs: P.kwargs) -> R:
        reservation = self.reserve_quota()
        try:
            response = function(*args, **kwargs)
            reservation.commit()
            return response
        finally:
            self.release_quota_safely(reservation)

    @overload
    def invoke_llm(
        self,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: dict[str, Any] | None = None,
        tools: Sequence[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: Literal[True] = True,
        callbacks: list[Callback] | None = None,
        request_metadata: Mapping[str, object] | None = None,
    ) -> Generator: ...

    @overload
    def invoke_llm(
        self,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, Any] | None = None,
        tools: Sequence[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: Literal[False] = False,
        callbacks: list[Callback] | None = None,
        request_metadata: Mapping[str, object] | None = None,
    ) -> LLMResult: ...

    @overload
    def invoke_llm(
        self,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, Any] | None = None,
        tools: Sequence[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        callbacks: list[Callback] | None = None,
        request_metadata: Mapping[str, object] | None = None,
    ) -> Union[LLMResult, Generator]: ...

    @override
    def invoke_llm(
        self,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: dict[str, Any] | None = None,
        tools: Sequence[PromptMessageTool] | None = None,
        stop: Sequence[str] | None = None,
        stream: bool = True,
        callbacks: list[Callback] | None = None,
        request_metadata: Mapping[str, object] | None = None,
    ) -> Union[LLMResult, Generator]:
        normalized_prompt_messages = list(prompt_messages)
        normalized_stop = list(stop) if stop else None
        if stream:
            return self._invoke_llm_stream(
                prompt_messages=normalized_prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=normalized_stop,
                callbacks=callbacks,
                request_metadata=request_metadata,
            )

        reservation = self._reserve_quota_for_request(request_metadata)
        try:
            response = super().invoke_llm(
                prompt_messages=normalized_prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=normalized_stop,
                stream=False,
                callbacks=callbacks,
                request_metadata=request_metadata,
            )
            if isinstance(response, Generator):
                raise TypeError("Non-streaming LLM invocation returned a generator.")
            reservation.commit(response.usage)
            return response
        finally:
            self.release_quota_safely(reservation)

    def _invoke_llm_stream(
        self,
        *,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, Any] | None,
        tools: Sequence[PromptMessageTool] | None,
        stop: list[str] | None,
        callbacks: list[Callback] | None,
        request_metadata: Mapping[str, object] | None,
    ) -> Generator:
        reservation = self._reserve_quota_for_request(request_metadata)
        usage: LLMUsage | None = None
        try:
            response = super().invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=stop,
                stream=True,
                callbacks=callbacks,
                request_metadata=request_metadata,
            )
            if not isinstance(response, Generator):
                raise TypeError("Streaming LLM invocation did not return a generator.")

            if reservation.commit_before_delivery:
                for chunk in response:
                    chunk_usage = chunk.delta.usage
                    if chunk_usage is not None:
                        usage = chunk_usage
                    reservation.commit(usage)
                    yield chunk
                return

            buffered_chunks = []
            for chunk in response:
                chunk_usage = chunk.delta.usage
                if chunk_usage is not None:
                    usage = chunk_usage
                buffered_chunks.append(chunk)

            reservation.commit(usage)
            yield from buffered_chunks
        finally:
            self.release_quota_safely(reservation)

    @override
    def invoke_text_embedding(
        self, texts: list[str], input_type: EmbeddingInputType = EmbeddingInputType.DOCUMENT
    ) -> EmbeddingResult:
        return self._invoke_with_quota(super().invoke_text_embedding, texts=texts, input_type=input_type)

    @override
    def invoke_multimodal_embedding(
        self,
        multimodel_documents: list[dict],
        input_type: EmbeddingInputType = EmbeddingInputType.DOCUMENT,
    ) -> EmbeddingResult:
        return self._invoke_with_quota(
            super().invoke_multimodal_embedding,
            multimodel_documents=multimodel_documents,
            input_type=input_type,
        )

    @override
    def invoke_rerank(
        self,
        query: str,
        docs: list[str],
        score_threshold: float | None = None,
        top_n: int | None = None,
    ) -> RerankResult:
        return self._invoke_with_quota(
            super().invoke_rerank,
            query=query,
            docs=docs,
            score_threshold=score_threshold,
            top_n=top_n,
        )

    @override
    def invoke_multimodal_rerank(
        self,
        query: MultimodalRerankInput,
        docs: list[MultimodalRerankInput],
        score_threshold: float | None = None,
        top_n: int | None = None,
    ) -> RerankResult:
        return self._invoke_with_quota(
            super().invoke_multimodal_rerank,
            query=query,
            docs=docs,
            score_threshold=score_threshold,
            top_n=top_n,
        )

    @override
    def invoke_moderation(self, text: str) -> bool:
        return self._invoke_with_quota(super().invoke_moderation, text=text)

    @override
    def invoke_speech2text(self, file: IO[bytes]) -> str:
        return self._invoke_with_quota(super().invoke_speech2text, file=file)

    @override
    def invoke_tts(self, content_text: str, voice: str = "") -> Iterable[bytes]:
        return self._invoke_tts_stream(content_text=content_text, voice=voice)

    def _invoke_tts_stream(self, *, content_text: str, voice: str) -> Generator[bytes, None, None]:
        reservation = self.reserve_quota()
        try:
            response = super().invoke_tts(content_text=content_text, voice=voice)
            for chunk in response:
                reservation.commit()
                yield chunk
        finally:
            self.release_quota_safely(reservation)


class ModelManager:
    """Resolves :class:`ModelInstance` objects for a tenant and provider.

    When ``enable_credentials_cache`` is ``True``, resolved credentials for each
    ``(tenant_id, provider, model_type, model)`` are stored in
    ``_credentials_cache`` and reused. That can return **stale** credentials after
    API keys or provider settings change, so a manager constructed with
    ``enable_credentials_cache=True`` should not be kept for the lifetime of a
    process or shared across unrelated work. Prefer a new manager per request,
    workflow run, or similar bounded scope.

    The default is ``enable_credentials_cache=False``; in that mode the internal
    credential cache is not populated, and each ``get_model_instance`` call
    loads credentials from the current provider configuration.
    """

    def __init__(
        self,
        provider_manager: ProviderManager,
        *,
        enable_credentials_cache: bool = False,
    ) -> None:
        self._provider_manager = provider_manager
        self._credentials_cache: dict[tuple[str, str, str, str], Any] = {}
        self._enable_credentials_cache = enable_credentials_cache

    @classmethod
    def for_tenant(cls, tenant_id: str, user_id: str | None = None) -> "ModelManager":
        return cls(provider_manager=create_plugin_provider_manager(tenant_id=tenant_id, user_id=user_id))

    @staticmethod
    def _validate_system_model_access(
        provider_model_bundle: ProviderModelBundle,
        *,
        model_type: ModelType,
        model: str,
    ) -> None:
        configuration = provider_model_bundle.configuration
        if configuration.using_provider_type != ProviderType.SYSTEM:
            return

        # Hosted allowlists retain the existing comma-separated format. Model names
        # are matched exactly; model-type-specific entries will be introduced later.
        quota_configuration = next(
            (
                quota
                for quota in configuration.system_configuration.quota_configurations
                if quota.quota_type == configuration.system_configuration.current_quota_type
            ),
            None,
        )
        if quota_configuration is None or not quota_configuration.restrict_models:
            return
        if any(restricted_model.model == model for restricted_model in quota_configuration.restrict_models):
            return

        raise ModelCurrentlyNotSupportError(f"System model {model_type.value}/{model} is not allowed.")

    @staticmethod
    def _model_instance_class(provider_model_bundle: ProviderModelBundle, model_type: ModelType) -> type[ModelInstance]:
        if provider_model_bundle.configuration.using_provider_type == ProviderType.SYSTEM:
            return QuotaManagedModelInstance
        return ModelInstance

    def get_model_instance(
        self,
        tenant_id: str,
        provider: str,
        model_type: ModelType,
        model: str,
    ) -> ModelInstance:
        """
        Get model instance
        :param tenant_id: tenant id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :return:
        """
        if not provider:
            return self.get_default_model_instance(tenant_id, model_type)

        provider_model_bundle = self._provider_manager.get_provider_model_bundle(
            tenant_id=tenant_id, provider=provider, model_type=model_type
        )
        self._validate_system_model_access(provider_model_bundle, model_type=model_type, model=model)
        model_instance_class = self._model_instance_class(provider_model_bundle, model_type)

        cred_cache_key = (tenant_id, provider, model_type.value, model)

        if cred_cache_key in self._credentials_cache:
            return model_instance_class(
                provider_model_bundle,
                model,
                deepcopy(self._credentials_cache[cred_cache_key]),
            )

        ret = model_instance_class(provider_model_bundle, model)
        if self._enable_credentials_cache:
            self._credentials_cache[cred_cache_key] = deepcopy(ret.credentials)
        return ret

    def get_default_provider_model_name(self, tenant_id: str, model_type: ModelType) -> tuple[str | None, str | None]:
        """
        Return first provider and the first model in the provider
        :param tenant_id: tenant id
        :param model_type: model type
        :return: provider name, model name
        """
        return self._provider_manager.get_first_provider_first_model(tenant_id, model_type)

    def get_default_model_instance(self, tenant_id: str, model_type: ModelType) -> ModelInstance:
        """
        Get default model instance
        :param tenant_id: tenant id
        :param model_type: model type
        :return:
        """
        default_model_entity = self._provider_manager.get_default_model(tenant_id=tenant_id, model_type=model_type)

        if not default_model_entity:
            raise ProviderTokenNotInitError(f"Default model not found for {model_type}")

        return self.get_model_instance(
            tenant_id=tenant_id,
            provider=default_model_entity.provider.provider,
            model_type=model_type,
            model=default_model_entity.model,
        )

    def check_model_support_vision(self, tenant_id: str, provider: str, model: str, model_type: ModelType) -> bool:
        """
        Check if model supports vision
        :param tenant_id: tenant id
        :param provider: provider name
        :param model: model name
        :return: True if model supports vision, False otherwise
        """
        model_instance = self.get_model_instance(tenant_id, provider, model_type, model)
        model_type_instance = model_instance.model_type_instance
        match model_type:
            case ModelType.LLM:
                model_type_instance = cast(LargeLanguageModel, model_type_instance)
            case ModelType.TEXT_EMBEDDING:
                model_type_instance = cast(TextEmbeddingModel, model_type_instance)
            case ModelType.RERANK:
                model_type_instance = cast(RerankModel, model_type_instance)
            case _:
                raise ValueError(f"Model type {model_type} is not supported")
        model_schema = model_type_instance.get_model_schema(model, model_instance.credentials)
        if not model_schema:
            return False
        if model_schema.features and ModelFeature.VISION in model_schema.features:
            return True
        return False


class LBModelManager:
    def __init__(
        self,
        tenant_id: str,
        provider: str,
        model_type: ModelType,
        model: str,
        load_balancing_configs: list[ModelLoadBalancingConfiguration],
        managed_credentials: dict[str, Any] | None = None,
    ):
        """
        Load balancing model manager
        :param tenant_id: tenant_id
        :param provider: provider
        :param model_type: model_type
        :param model: model name
        :param load_balancing_configs: all load balancing configurations
        :param managed_credentials: credentials if load balancing configuration name is __inherit__
        """
        self._tenant_id = tenant_id
        self._provider = provider
        self._model_type = model_type
        self._model = model
        self._load_balancing_configs = load_balancing_configs

        for load_balancing_config in self._load_balancing_configs[:]:  # Iterate over a shallow copy of the list
            if load_balancing_config.name == "__inherit__":
                if not managed_credentials:
                    # remove __inherit__ if managed credentials is not provided
                    self._load_balancing_configs.remove(load_balancing_config)
                else:
                    load_balancing_config.credentials = managed_credentials

    def fetch_next(self) -> ModelLoadBalancingConfiguration | None:
        """
        Get next model load balancing config
        Strategy: Round Robin
        :return:
        """
        cache_key = "model_lb_index:{}:{}:{}:{}".format(
            self._tenant_id, self._provider, self._model_type.value, self._model
        )

        cooldown_load_balancing_configs = []
        max_index = len(self._load_balancing_configs)

        while True:
            current_index = redis_client.incr(cache_key)
            current_index = cast(int, current_index)
            if current_index >= 10000000:
                current_index = 1
                redis_client.set(cache_key, current_index)

            redis_client.expire(cache_key, 3600)
            if current_index > max_index:
                current_index = current_index % max_index

            real_index = current_index - 1
            if real_index > max_index:
                real_index = 0

            config: ModelLoadBalancingConfiguration = self._load_balancing_configs[real_index]

            if self.in_cooldown(config):
                cooldown_load_balancing_configs.append(config)
                if len(cooldown_load_balancing_configs) >= len(self._load_balancing_configs):
                    # all configs are in cooldown
                    return None

                continue

            # Check policy compliance for the selected configuration
            try:
                from core.helper.credential_utils import runtime_check_credential_policy_compliance

                if config.credential_id:
                    runtime_check_credential_policy_compliance(
                        credential_id=config.credential_id,
                        provider=self._provider,
                        credential_type=PluginCredentialType.MODEL,
                    )
            except Exception:
                logger.warning("Load balancing config %s failed policy compliance check", config.id, exc_info=True)
                cooldown_load_balancing_configs.append(config)
                if len(cooldown_load_balancing_configs) >= len(self._load_balancing_configs):
                    # all configs are in cooldown or failed policy compliance
                    return None
                continue

            if dify_config.DEBUG:
                logger.info(
                    """Model LB
id: %s
name:%s
tenant_id: %s
provider: %s
model_type: %s
model: %s""",
                    config.id,
                    config.name,
                    self._tenant_id,
                    self._provider,
                    self._model_type.value,
                    self._model,
                )

            return config

    def cooldown(self, config: ModelLoadBalancingConfiguration, expire: int = 60):
        """
        Cooldown model load balancing config
        :param config: model load balancing config
        :param expire: cooldown time
        :return:
        """
        cooldown_cache_key = "model_lb_index:cooldown:{}:{}:{}:{}:{}".format(
            self._tenant_id, self._provider, self._model_type.value, self._model, config.id
        )

        redis_client.setex(cooldown_cache_key, expire, "true")

    def in_cooldown(self, config: ModelLoadBalancingConfiguration) -> bool:
        """
        Check if model load balancing config is in cooldown
        :param config: model load balancing config
        :return:
        """
        cooldown_cache_key = "model_lb_index:cooldown:{}:{}:{}:{}:{}".format(
            self._tenant_id, self._provider, self._model_type.value, self._model, config.id
        )

        res: bool = redis_client.exists(cooldown_cache_key)
        return res

    @staticmethod
    def get_config_in_cooldown_and_ttl(
        tenant_id: str, provider: str, model_type: ModelType, model: str, config_id: str
    ) -> tuple[bool, int]:
        """
        Get model load balancing config is in cooldown and ttl
        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param config_id: model load balancing config id
        :return:
        """
        cooldown_cache_key = "model_lb_index:cooldown:{}:{}:{}:{}:{}".format(
            tenant_id, provider, model_type.value, model, config_id
        )

        ttl = redis_client.ttl(cooldown_cache_key)
        if ttl == -2:
            return False, 0

        ttl = cast(int, ttl)
        return True, ttl
