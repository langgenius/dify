from decimal import Decimal
from io import BytesIO
from unittest.mock import MagicMock

from dify_graph.model_runtime.entities.common_entities import I18nObject
from dify_graph.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from dify_graph.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from dify_graph.model_runtime.entities.model_entities import ModelType
from dify_graph.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from dify_graph.model_runtime.entities.rerank_entities import RerankResult
from dify_graph.model_runtime.entities.text_embedding_entities import EmbeddingResult, EmbeddingUsage
from dify_graph.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from dify_graph.model_runtime.model_providers.__base.moderation_model import ModerationModel
from dify_graph.model_runtime.model_providers.__base.rerank_model import RerankModel
from dify_graph.model_runtime.model_providers.__base.speech2text_model import Speech2TextModel
from dify_graph.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from dify_graph.model_runtime.model_providers.__base.tts_model import TTSModel


def _provider_schema(model_type: ModelType) -> ProviderEntity:
    return ProviderEntity(
        provider="langgenius/openai/openai",
        provider_name="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[model_type],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )


def _embedding_usage() -> EmbeddingUsage:
    return EmbeddingUsage(
        tokens=1,
        total_tokens=1,
        unit_price=Decimal(0),
        price_unit=Decimal(0),
        total_price=Decimal(0),
        currency="USD",
        latency=0.0,
    )


def test_large_language_model_invokes_runtime_without_user_id() -> None:
    runtime = MagicMock()
    runtime.invoke_llm.return_value = LLMResult(
        model="gpt-4o-mini",
        prompt_messages=[],
        message=AssistantPromptMessage(content="ok"),
        usage=LLMUsage.empty_usage(),
    )
    model = LargeLanguageModel(provider_schema=_provider_schema(ModelType.LLM), model_runtime=runtime)

    model.invoke(
        model="gpt-4o-mini",
        credentials={"api_key": "secret"},
        prompt_messages=[UserPromptMessage(content="hi")],
        stream=False,
    )

    assert "user_id" not in runtime.invoke_llm.call_args.kwargs


def test_text_embedding_model_invokes_runtime_without_user_id_for_text_requests() -> None:
    runtime = MagicMock()
    runtime.invoke_text_embedding.return_value = EmbeddingResult(
        model="text-embedding-3-small",
        embeddings=[[0.1]],
        usage=_embedding_usage(),
    )
    model = TextEmbeddingModel(provider_schema=_provider_schema(ModelType.TEXT_EMBEDDING), model_runtime=runtime)

    model.invoke(
        model="text-embedding-3-small",
        credentials={"api_key": "secret"},
        texts=["hello"],
    )

    assert "user_id" not in runtime.invoke_text_embedding.call_args.kwargs


def test_text_embedding_model_invokes_runtime_without_user_id_for_multimodal_requests() -> None:
    runtime = MagicMock()
    runtime.invoke_multimodal_embedding.return_value = EmbeddingResult(
        model="text-embedding-3-small",
        embeddings=[[0.1]],
        usage=_embedding_usage(),
    )
    model = TextEmbeddingModel(provider_schema=_provider_schema(ModelType.TEXT_EMBEDDING), model_runtime=runtime)

    model.invoke(
        model="text-embedding-3-small",
        credentials={"api_key": "secret"},
        multimodel_documents=[{"content": "hello", "content_type": "text"}],
    )

    assert "user_id" not in runtime.invoke_multimodal_embedding.call_args.kwargs


def test_rerank_model_invokes_runtime_without_user_id_for_text_requests() -> None:
    runtime = MagicMock()
    runtime.invoke_rerank.return_value = RerankResult(model="rerank", docs=[])
    model = RerankModel(provider_schema=_provider_schema(ModelType.RERANK), model_runtime=runtime)

    model.invoke(
        model="rerank",
        credentials={"api_key": "secret"},
        query="q",
        docs=["d1"],
    )

    assert "user_id" not in runtime.invoke_rerank.call_args.kwargs


def test_rerank_model_invokes_runtime_without_user_id_for_multimodal_requests() -> None:
    runtime = MagicMock()
    runtime.invoke_multimodal_rerank.return_value = RerankResult(model="rerank", docs=[])
    model = RerankModel(provider_schema=_provider_schema(ModelType.RERANK), model_runtime=runtime)

    model.invoke_multimodal_rerank(
        model="rerank",
        credentials={"api_key": "secret"},
        query={"content": "q", "content_type": "text"},
        docs=[{"content": "d1", "content_type": "text"}],
    )

    assert "user_id" not in runtime.invoke_multimodal_rerank.call_args.kwargs


def test_tts_model_invokes_runtime_without_user_id() -> None:
    runtime = MagicMock()
    runtime.invoke_tts.return_value = [b"chunk"]
    model = TTSModel(provider_schema=_provider_schema(ModelType.TTS), model_runtime=runtime)

    list(
        model.invoke(
            model="tts-1",
            credentials={"api_key": "secret"},
            content_text="hello",
            voice="alloy",
        )
    )

    assert "user_id" not in runtime.invoke_tts.call_args.kwargs


def test_speech_to_text_model_invokes_runtime_without_user_id() -> None:
    runtime = MagicMock()
    runtime.invoke_speech_to_text.return_value = "transcript"
    model = Speech2TextModel(provider_schema=_provider_schema(ModelType.SPEECH2TEXT), model_runtime=runtime)

    model.invoke(
        model="whisper-1",
        credentials={"api_key": "secret"},
        file=BytesIO(b"audio"),
    )

    assert "user_id" not in runtime.invoke_speech_to_text.call_args.kwargs


def test_moderation_model_invokes_runtime_without_user_id() -> None:
    runtime = MagicMock()
    runtime.invoke_moderation.return_value = True
    model = ModerationModel(provider_schema=_provider_schema(ModelType.MODERATION), model_runtime=runtime)

    model.invoke(
        model="omni-moderation-latest",
        credentials={"api_key": "secret"},
        text="unsafe?",
    )

    assert "user_id" not in runtime.invoke_moderation.call_args.kwargs
