import numpy as np

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.model_providers.__base.tokenizers.gpt2_tokenzier import GPT2Tokenizer
from core.model_runtime.model_providers.wenxin.text_embedding.text_embedding import (
    TextEmbedding,
    WenxinTextEmbeddingModel,
)


def test_max_chunks():
    class _MockTextEmbedding(TextEmbedding):
        def embed_documents(self, model: str, texts: list[str], user: str) -> (list[list[float]], int, int):
            embeddings = [[1.0, 2.0, 3.0] for i in range(len(texts))]
            tokens = 0
            for text in texts:
                tokens += len(text)

            return embeddings, tokens, tokens

    def _create_text_embedding(api_key: str, secret_key: str) -> TextEmbedding:
        return _MockTextEmbedding()

    model = "embedding-v1"
    credentials = {
        "api_key": "xxxx",
        "secret_key": "yyyy",
    }
    embedding_model = WenxinTextEmbeddingModel()
    context_size = embedding_model._get_context_size(model, credentials)
    max_chunks = embedding_model._get_max_chunks(model, credentials)
    embedding_model._create_text_embedding = _create_text_embedding

    texts = ["0123456789" for i in range(0, max_chunks * 2)]
    result: TextEmbeddingResult = embedding_model.invoke(model, credentials, texts, "test")
    assert len(result.embeddings) == max_chunks * 2


def test_context_size():
    def get_num_tokens_by_gpt2(text: str) -> int:
        return GPT2Tokenizer.get_num_tokens(text)

    def mock_text(token_size: int) -> str:
        _text = "".join(["0" for i in range(token_size)])
        num_tokens = get_num_tokens_by_gpt2(_text)
        ratio = int(np.floor(len(_text) / num_tokens))
        m_text = "".join([_text for i in range(ratio)])
        return m_text

    model = "embedding-v1"
    credentials = {
        "api_key": "xxxx",
        "secret_key": "yyyy",
    }
    embedding_model = WenxinTextEmbeddingModel()
    context_size = embedding_model._get_context_size(model, credentials)

    class _MockTextEmbedding(TextEmbedding):
        def embed_documents(self, model: str, texts: list[str], user: str) -> (list[list[float]], int, int):
            embeddings = [[1.0, 2.0, 3.0] for i in range(len(texts))]
            tokens = 0
            for text in texts:
                tokens += get_num_tokens_by_gpt2(text)
            return embeddings, tokens, tokens

    def _create_text_embedding(api_key: str, secret_key: str) -> TextEmbedding:
        return _MockTextEmbedding()

    embedding_model._create_text_embedding = _create_text_embedding
    text = mock_text(context_size * 2)
    assert get_num_tokens_by_gpt2(text) == context_size * 2

    texts = [text]
    result: TextEmbeddingResult = embedding_model.invoke(model, credentials, texts, "test")
    assert result.usage.tokens == context_size
