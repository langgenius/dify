from collections.abc import Generator
from typing import IO, Optional, Union, cast

from core.entities.provider_configuration import ProviderModelBundle
from core.errors.error import ProviderTokenNotInitError
from core.model_runtime.callbacks.base_callback import Callback
from core.model_runtime.entities.llm_entities import LLMResult
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.model_providers.__base.moderation_model import ModerationModel
from core.model_runtime.model_providers.__base.rerank_model import RerankModel
from core.model_runtime.model_providers.__base.speech2text_model import Speech2TextModel
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.model_runtime.model_providers.__base.tts_model import TTSModel
from core.provider_manager import ProviderManager


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

    def _fetch_credentials_from_bundle(self, provider_model_bundle: ProviderModelBundle, model: str) -> dict:
        """
        Fetch credentials from provider model bundle
        :param provider_model_bundle: provider model bundle
        :param model: model name
        :return:
        """
        credentials = provider_model_bundle.configuration.get_current_credentials(
            model_type=provider_model_bundle.model_type_instance.model_type,
            model=model
        )

        if credentials is None:
            raise ProviderTokenNotInitError(f"Model {model} credentials is not initialized.")

        return credentials

    def invoke_llm(self, prompt_messages: list[PromptMessage], model_parameters: Optional[dict] = None,
                   tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                   stream: bool = True, user: Optional[str] = None, callbacks: list[Callback] = None) \
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
        return self.model_type_instance.invoke(
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
        return self.model_type_instance.invoke(
            model=self.model,
            credentials=self.credentials,
            texts=texts,
            user=user
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
        return self.model_type_instance.invoke(
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
        return self.model_type_instance.invoke(
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
        return self.model_type_instance.invoke(
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
        return self.model_type_instance.invoke(
            model=self.model,
            credentials=self.credentials,
            content_text=content_text,
            user=user,
            tenant_id=tenant_id,
            voice=voice,
            streaming=streaming
        )

    def get_tts_voices(self, language: str) -> list:
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
