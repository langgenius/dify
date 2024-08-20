import os
from time import sleep

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.model_providers.wenxin.text_embedding.text_embedding import WenxinTextEmbeddingModel


def test_invoke_embedding_v1():
    sleep(3)
    model = WenxinTextEmbeddingModel()

    response = model.invoke(
        model='embedding-v1',
        credentials={
            'api_key': os.environ.get('WENXIN_API_KEY'),
            'secret_key': os.environ.get('WENXIN_SECRET_KEY')
        },
        texts=['hello', '你好', 'xxxxx'],
        user="abc-123"
    )

    assert isinstance(response, TextEmbeddingResult)
    assert len(response.embeddings) == 3
    assert isinstance(response.embeddings[0], list)


def test_invoke_embedding_bge_large_en():
    sleep(3)
    model = WenxinTextEmbeddingModel()

    response = model.invoke(
        model='bge-large-en',
        credentials={
            'api_key': os.environ.get('WENXIN_API_KEY'),
            'secret_key': os.environ.get('WENXIN_SECRET_KEY')
        },
        texts=['hello', '你好', 'xxxxx'],
        user="abc-123"
    )

    assert isinstance(response, TextEmbeddingResult)
    assert len(response.embeddings) == 3
    assert isinstance(response.embeddings[0], list)


def test_invoke_embedding_bge_large_zh():
    sleep(3)
    model = WenxinTextEmbeddingModel()

    response = model.invoke(
        model='bge-large-zh',
        credentials={
            'api_key': os.environ.get('WENXIN_API_KEY'),
            'secret_key': os.environ.get('WENXIN_SECRET_KEY')
        },
        texts=['hello', '你好', 'xxxxx'],
        user="abc-123"
    )

    assert isinstance(response, TextEmbeddingResult)
    assert len(response.embeddings) == 3
    assert isinstance(response.embeddings[0], list)


def test_invoke_embedding_tao_8k():
    sleep(3)
    model = WenxinTextEmbeddingModel()

    response = model.invoke(
        model='tao-8k',
        credentials={
            'api_key': os.environ.get('WENXIN_API_KEY'),
            'secret_key': os.environ.get('WENXIN_SECRET_KEY')
        },
        texts=['hello', '你好', 'xxxxx'],
        user="abc-123"
    )

    assert isinstance(response, TextEmbeddingResult)
    assert len(response.embeddings) == 3
    assert isinstance(response.embeddings[0], list)
