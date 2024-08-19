import os
from time import sleep

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.model_providers.wenxin.text_embedding.text_embedding import WenxinTextEmbeddingModel


def test_invoke_embedding_model():
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