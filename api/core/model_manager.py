import logging
import os
from collections.abc import Callable, Generator
from typing import IO, Optional, Union, cast

from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import ModelLoadBalancingConfiguration
from core.errors.error import ProviderTokenNotInitError
from core.model_runtime.callbacks.base_callback import Callback
from core.model_runtime.entities.llm_entities import LLMResult
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeConnectionError, InvokeRateLimitError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.model_providers.__base.moderation_model import ModerationModel
from core.model_runtime.model_providers.__base.rerank_model import RerankModel
from core.model_runtime.model_providers.__base.speech2text_model import Speech2TextModel
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.model_runtime.model_providers.__base.tts_model import TTSModel
from core.provider_manager import ProviderManager
from extensions.ext_redis import redis_client
from models.provider import ProviderType

logger = logging.getLogger(__name__)


class ModelInstance:
    """
    Model instance class
    """

    def __init__(self, provider_model_bundle: ProviderModelBundle, model: str) -> None:
        self.provider_model_bundle = provider_model_bundle
        self.model = model
        self.provider = provider_model_bundle.configuration.provider.provider
        self.credentials = self._fetch_credentials_from_bundle(provider_model_bundle, model)
        self.model_type_instance = self.provider_model_bundle.model_type_instance
        self.load_balancing_manager = self._get_load_balancing_manager(
            configuration=provider_model_bundle.configuration,
            model_type=provider_model_bundle.model_type_instance.model_type,
            model=model,
            credentials=self.credentials
        )

    def _fetch_credentials_from_bundle(self, provider_model_bundle: ProviderModelBundle, model: str) -> dict:
        """
        Fetch credentials from provider model bundle
        :param provider_model_bundle: provider model bundle
        :param model: model name
        :return:
        """
        configuration = provider_model_bundle.configuration
        model_type = provider_model_bundle.model_type_instance.model_type
        credentials = configuration.get_current_credentials(
            model_type=model_type,
            model=model
        )

        if credentials is None:
            raise ProviderTokenNotInitError(f"Model {model} credentials is not initialized.")

        return credentials

    def _get_load_balancing_manager(self, configuration: ProviderConfiguration,
                                    model_type: ModelType,
                                    model: str,
                                    credentials: dict) -> Optional["LBModelManager"]:
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
                if (model_setting.model_type == model_type
                        and model_setting.model == model):
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
                    managed_credentials=credentials if configuration.custom_configuration.provider else None
                )

                return lb_model_manager

        return None

    def invoke_llm(self, prompt_messages: list[PromptMessage], model_parameters: Optional[dict] = None,
                   tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                   stream: bool = True, user: Optional[str] = None, callbacks: Optional[list[Callback]] = None) \
            -> Union[LLMResult, Generator]:
        """
        Invoke large language model

        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :param callbacks: callbacks
        :return: full response or stream response chunk generator result
        """
        if not isinstance(self.model_type_instance, LargeLanguageModel):
            raise Exception("Model type instance is not LargeLanguageModel")

        self.model_type_instance = cast(LargeLanguageModel, self.model_type_instance)
        return self._round_robin_invoke(
            function=self.model_type_instance.invoke,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
            tools=tools,
            stop=stop,
            stream=stream,
            user=user,
            callbacks=callbacks
        )

    def get_llm_num_tokens(self, prompt_messages: list[PromptMessage],
                           tools: Optional[list[PromptMessageTool]] = None) -> int:
        """
        Get number of tokens for llm

        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return:
        """
        if not isinstance(self.model_type_instance, LargeLanguageModel):
            raise Exception("Model type instance is not LargeLanguageModel")

        self.model_type_instance = cast(LargeLanguageModel, self.model_type_instance)
        return self._round_robin_invoke(
            function=self.model_type_instance.get_num_tokens,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=prompt_messages,
            tools=tools
        )

    def invoke_text_embedding(self, texts: list[str], user: Optional[str] = None) \
            -> TextEmbeddingResult:
        """
        Invoke large language model

        :param texts: texts to embed
        :param user: unique user id
        :return: embeddings result
        """
        if not isinstance(self.model_type_instance, TextEmbeddingModel):
            raise Exception("Model type instance is not TextEmbeddingModel")

        self.model_type_instance = cast(TextEmbeddingModel, self.model_type_instance)
        return self._round_robin_invoke(
            function=self.model_type_instance.invoke,
            model=self.model,
            credentials=self.credentials,
            texts=texts,
            user=user
        )

    def get_text_embedding_num_tokens(self, texts: list[str]) -> int:
        """
        Get number of tokens for text embedding

        :param texts: texts to embed
        :return:
        """
        if not isinstance(self.model_type_instance, TextEmbeddingModel):
            raise Exception("Model type instance is not TextEmbeddingModel")

        self.model_type_instance = cast(TextEmbeddingModel, self.model_type_instance)
        return self._round_robin_invoke(
            function=self.model_type_instance.get_num_tokens,
            model=self.model,
            credentials=self.credentials,
            texts=texts
        )

    def invoke_rerank(self, query: str, docs: list[str], score_threshold: Optional[float] = None,
                      top_n: Optional[int] = None,
                      user: Optional[str] = None) \
            -> RerankResult:
        """
        Invoke rerank model

        :param query: search query
        :param docs: docs for reranking
        :param score_threshold: score threshold
        :param top_n: top n
        :param user: unique user id
        :return: rerank result
        """
        if not isinstance(self.model_type_instance, RerankModel):
            raise Exception("Model type instance is not RerankModel")

        self.model_type_instance = cast(RerankModel, self.model_type_instance)
        return self._round_robin_invoke(
            function=self.model_type_instance.invoke,
            model=self.model,
            credentials=self.credentials,
            query=query,
            docs=docs,
            score_threshold=score_threshold,
            top_n=top_n,
            user=user
        )

    def invoke_moderation(self, text: str, user: Optional[str] = None) \
            -> bool:
        """
        Invoke moderation model

        :param text: text to moderate
        :param user: unique user id
        :return: false if text is safe, true otherwise
        """
        if not isinstance(self.model_type_instance, ModerationModel):
            raise Exception("Model type instance is not ModerationModel")

        self.model_type_instance = cast(ModerationModel, self.model_type_instance)
        return self._round_robin_invoke(
            function=self.model_type_instance.invoke,
            model=self.model,
            credentials=self.credentials,
            text=text,
            user=user
        )

    def invoke_speech2text(self, file: IO[bytes], user: Optional[str] = None) \
            -> str:
        """
        Invoke large language model

        :param file: audio file
        :param user: unique user id
        :return: text for given audio file
        """
        if not isinstance(self.model_type_instance, Speech2TextModel):
            raise Exception("Model type instance is not Speech2TextModel")

        self.model_type_instance = cast(Speech2TextModel, self.model_type_instance)
        return self._round_robin_invoke(
            function=self.model_type_instance.invoke,
            model=self.model,
            credentials=self.credentials,
            file=file,
            user=user
        )

    def invoke_tts(self, content_text: str, tenant_id: str, voice: str, streaming: bool, user: Optional[str] = None) \
            -> str:
        """
        Invoke large language tts model

        :param content_text: text content to be translated
        :param tenant_id: user tenant id
        :param user: unique user id
        :param voice: model timbre
        :param streaming: output is streaming
        :return: text for given audio file
        """
        if not isinstance(self.model_type_instance, TTSModel):
            raise Exception("Model type instance is not TTSModel")

        self.model_type_instance = cast(TTSModel, self.model_type_instance)
        return self._round_robin_invoke(
            function=self.model_type_instance.invoke,
            model=self.model,
            credentials=self.credentials,
            content_text=content_text,
            user=user,
            tenant_id=tenant_id,
            voice=voice,
            streaming=streaming
        )

    def _round_robin_invoke(self, function: Callable, *args, **kwargs):
        """
        Round-robin invoke
        :param function: function to invoke
        :param args: function args
        :param kwargs: function kwargs
        :return:
        """
        if not self.load_balancing_manager:
            return function(*args, **kwargs)

        last_exception = None
        while True:
            lb_config = self.load_balancing_manager.fetch_next()
            if not lb_config:
                if not last_exception:
                    raise ProviderTokenNotInitError("Model credentials is not initialized.")
                else:
                    raise last_exception

            try:
                if 'credentials' in kwargs:
                    del kwargs['credentials']
                return function(*args, **kwargs, credentials=lb_config.credentials)
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

    def get_tts_voices(self, language: Optional[str] = None) -> list:
        """
        Invoke large language tts model voices

        :param language: tts language
        :return: tts model voices
        """
        if not isinstance(self.model_type_instance, TTSModel):
            raise Exception("Model type instance is not TTSModel")

        self.model_type_instance = cast(TTSModel, self.model_type_instance)
        return self.model_type_instance.get_tts_model_voices(
            model=self.model,
            credentials=self.credentials,
            language=language
        )


class ModelManager:
    def __init__(self) -> None:
        self._provider_manager = ProviderManager()

    def get_model_instance(self, tenant_id: str, provider: str, model_type: ModelType, model: str) -> ModelInstance:
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
            tenant_id=tenant_id,
            provider=provider,
            model_type=model_type
        )

        return ModelInstance(provider_model_bundle, model)

    def get_default_model_instance(self, tenant_id: str, model_type: ModelType) -> ModelInstance:
        """
        Get default model instance
        :param tenant_id: tenant id
        :param model_type: model type
        :return:
        """
        default_model_entity = self._provider_manager.get_default_model(
            tenant_id=tenant_id,
            model_type=model_type
        )

        if not default_model_entity:
            raise ProviderTokenNotInitError(f"Default model not found for {model_type}")

        return self.get_model_instance(
            tenant_id=tenant_id,
            provider=default_model_entity.provider.provider,
            model_type=model_type,
            model=default_model_entity.model
        )


class LBModelManager:
    def __init__(self, tenant_id: str,
                 provider: str,
                 model_type: ModelType,
                 model: str,
                 load_balancing_configs: list[ModelLoadBalancingConfiguration],
                 managed_credentials: Optional[dict] = None) -> None:
        """
        Load balancing model manager
        :param load_balancing_configs: all load balancing configurations
        :param managed_credentials: credentials if load balancing configuration name is __inherit__
        """
        self._tenant_id = tenant_id
        self._provider = provider
        self._model_type = model_type
        self._model = model
        self._load_balancing_configs = load_balancing_configs

        for load_balancing_config in self._load_balancing_configs:
            if load_balancing_config.name == "__inherit__":
                if not managed_credentials:
                    # remove __inherit__ if managed credentials is not provided
                    self._load_balancing_configs.remove(load_balancing_config)
                else:
                    load_balancing_config.credentials = managed_credentials

    def fetch_next(self) -> Optional[ModelLoadBalancingConfiguration]:
        """
        Get next model load balancing config
        Strategy: Round Robin
        :return:
        """
        cache_key = "model_lb_index:{}:{}:{}:{}".format(
            self._tenant_id,
            self._provider,
            self._model_type.value,
            self._model
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

            config = self._load_balancing_configs[real_index]

            if self.in_cooldown(config):
                cooldown_load_balancing_configs.append(config)
                if len(cooldown_load_balancing_configs) >= len(self._load_balancing_configs):
                    # all configs are in cooldown
                    return None

                continue

            if bool(os.environ.get("DEBUG", 'False').lower() == 'true'):
                logger.info(f"Model LB\nid: {config.id}\nname:{config.name}\n"
                            f"tenant_id: {self._tenant_id}\nprovider: {self._provider}\n"
                            f"model_type: {self._model_type.value}\nmodel: {self._model}")

            return config

        return None

    def cooldown(self, config: ModelLoadBalancingConfiguration, expire: int = 60) -> None:
        """
        Cooldown model load balancing config
        :param config: model load balancing config
        :param expire: cooldown time
        :return:
        """
        cooldown_cache_key = "model_lb_index:cooldown:{}:{}:{}:{}:{}".format(
            self._tenant_id,
            self._provider,
            self._model_type.value,
            self._model,
            config.id
        )

        redis_client.setex(cooldown_cache_key, expire, 'true')

    def in_cooldown(self, config: ModelLoadBalancingConfiguration) -> bool:
        """
        Check if model load balancing config is in cooldown
        :param config: model load balancing config
        :return:
        """
        cooldown_cache_key = "model_lb_index:cooldown:{}:{}:{}:{}:{}".format(
            self._tenant_id,
            self._provider,
            self._model_type.value,
            self._model,
            config.id
        )


        res = redis_client.exists(cooldown_cache_key)
        res = cast(bool, res)
        return res

    @classmethod
    def get_config_in_cooldown_and_ttl(cls, tenant_id: str,
                                       provider: str,
                                       model_type: ModelType,
                                       model: str,
                                       config_id: str) -> tuple[bool, int]:
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
            tenant_id,
            provider,
            model_type.value,
            model,
            config_id
        )

        ttl = redis_client.ttl(cooldown_cache_key)
        if ttl == -2:
            return False, 0

        ttl = cast(int, ttl)
        return True, ttl
