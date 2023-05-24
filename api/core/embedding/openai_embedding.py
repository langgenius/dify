from typing import Optional, Any, List

import openai
from llama_index.embeddings.base import BaseEmbedding
from llama_index.embeddings.openai import OpenAIEmbeddingMode, OpenAIEmbeddingModelType, _QUERY_MODE_MODEL_DICT, \
    _TEXT_MODE_MODEL_DICT
from tenacity import wait_random_exponential, retry, stop_after_attempt

from core.llm.error_handle_wraps import handle_llm_exceptions, handle_llm_exceptions_async


@retry(reraise=True, wait=wait_random_exponential(min=1, max=20), stop=stop_after_attempt(6))
def get_embedding(
        text: str,
        engine: Optional[str] = None,
        api_key: Optional[str] = None,
        **kwargs
) -> List[float]:
    """Get embedding.

    NOTE: Copied from OpenAI's embedding utils:
    https://github.com/openai/openai-python/blob/main/openai/embeddings_utils.py

    Copied here to avoid importing unnecessary dependencies
    like matplotlib, plotly, scipy, sklearn.

    """
    text = text.replace("\n", " ")
    return openai.Embedding.create(input=[text], engine=engine, api_key=api_key, **kwargs)["data"][0]["embedding"]


@retry(reraise=True, wait=wait_random_exponential(min=1, max=20), stop=stop_after_attempt(6))
async def aget_embedding(text: str, engine: Optional[str] = None, api_key: Optional[str] = None, **kwargs) -> List[
    float]:
    """Asynchronously get embedding.

    NOTE: Copied from OpenAI's embedding utils:
    https://github.com/openai/openai-python/blob/main/openai/embeddings_utils.py

    Copied here to avoid importing unnecessary dependencies
    like matplotlib, plotly, scipy, sklearn.

    """
    # replace newlines, which can negatively affect performance.
    text = text.replace("\n", " ")

    return (await openai.Embedding.acreate(input=[text], engine=engine, api_key=api_key, **kwargs))["data"][0][
        "embedding"
    ]


@retry(reraise=True, wait=wait_random_exponential(min=1, max=20), stop=stop_after_attempt(6))
def get_embeddings(
        list_of_text: List[str],
        engine: Optional[str] = None,
        api_key: Optional[str] = None,
        **kwargs
) -> List[List[float]]:
    """Get embeddings.

    NOTE: Copied from OpenAI's embedding utils:
    https://github.com/openai/openai-python/blob/main/openai/embeddings_utils.py

    Copied here to avoid importing unnecessary dependencies
    like matplotlib, plotly, scipy, sklearn.

    """
    assert len(list_of_text) <= 2048, "The batch size should not be larger than 2048."

    # replace newlines, which can negatively affect performance.
    list_of_text = [text.replace("\n", " ") for text in list_of_text]

    data = openai.Embedding.create(input=list_of_text, engine=engine, api_key=api_key, **kwargs).data
    data = sorted(data, key=lambda x: x["index"])  # maintain the same order as input.
    return [d["embedding"] for d in data]


@retry(reraise=True, wait=wait_random_exponential(min=1, max=20), stop=stop_after_attempt(6))
async def aget_embeddings(
        list_of_text: List[str], engine: Optional[str] = None, api_key: Optional[str] = None, **kwargs
) -> List[List[float]]:
    """Asynchronously get embeddings.

    NOTE: Copied from OpenAI's embedding utils:
    https://github.com/openai/openai-python/blob/main/openai/embeddings_utils.py

    Copied here to avoid importing unnecessary dependencies
    like matplotlib, plotly, scipy, sklearn.

    """
    assert len(list_of_text) <= 2048, "The batch size should not be larger than 2048."

    # replace newlines, which can negatively affect performance.
    list_of_text = [text.replace("\n", " ") for text in list_of_text]

    data = (await openai.Embedding.acreate(input=list_of_text, engine=engine, api_key=api_key, **kwargs)).data
    data = sorted(data, key=lambda x: x["index"])  # maintain the same order as input.
    return [d["embedding"] for d in data]


class OpenAIEmbedding(BaseEmbedding):

    def __init__(
            self,
            mode: str = OpenAIEmbeddingMode.TEXT_SEARCH_MODE,
            model: str = OpenAIEmbeddingModelType.TEXT_EMBED_ADA_002,
            deployment_name: Optional[str] = None,
            openai_api_key: Optional[str] = None,
            **kwargs: Any,
    ) -> None:
        """Init params."""
        new_kwargs = {}

        if 'embed_batch_size' in kwargs:
            new_kwargs['embed_batch_size'] = kwargs['embed_batch_size']

        if 'tokenizer' in kwargs:
            new_kwargs['tokenizer'] = kwargs['tokenizer']

        super().__init__(**new_kwargs)
        self.mode = OpenAIEmbeddingMode(mode)
        self.model = OpenAIEmbeddingModelType(model)
        self.deployment_name = deployment_name
        self.openai_api_key = openai_api_key
        self.openai_api_type = kwargs.get('openai_api_type')
        self.openai_api_version = kwargs.get('openai_api_version')
        self.openai_api_base = kwargs.get('openai_api_base')

    @handle_llm_exceptions
    def _get_query_embedding(self, query: str) -> List[float]:
        """Get query embedding."""
        if self.deployment_name is not None:
            engine = self.deployment_name
        else:
            key = (self.mode, self.model)
            if key not in _QUERY_MODE_MODEL_DICT:
                raise ValueError(f"Invalid mode, model combination: {key}")
            engine = _QUERY_MODE_MODEL_DICT[key]
        return get_embedding(query, engine=engine, api_key=self.openai_api_key,
                             api_type=self.openai_api_type, api_version=self.openai_api_version,
                             api_base=self.openai_api_base)

    def _get_text_embedding(self, text: str) -> List[float]:
        """Get text embedding."""
        if self.deployment_name is not None:
            engine = self.deployment_name
        else:
            key = (self.mode, self.model)
            if key not in _TEXT_MODE_MODEL_DICT:
                raise ValueError(f"Invalid mode, model combination: {key}")
            engine = _TEXT_MODE_MODEL_DICT[key]
        return get_embedding(text, engine=engine, api_key=self.openai_api_key,
                             api_type=self.openai_api_type, api_version=self.openai_api_version,
                             api_base=self.openai_api_base)

    async def _aget_text_embedding(self, text: str) -> List[float]:
        """Asynchronously get text embedding."""
        if self.deployment_name is not None:
            engine = self.deployment_name
        else:
            key = (self.mode, self.model)
            if key not in _TEXT_MODE_MODEL_DICT:
                raise ValueError(f"Invalid mode, model combination: {key}")
            engine = _TEXT_MODE_MODEL_DICT[key]
        return await aget_embedding(text, engine=engine, api_key=self.openai_api_key,
                                    api_type=self.openai_api_type, api_version=self.openai_api_version,
                                    api_base=self.openai_api_base)

    def _get_text_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Get text embeddings.

        By default, this is a wrapper around _get_text_embedding.
        Can be overriden for batch queries.

        """
        if self.openai_api_type and self.openai_api_type == 'azure':
            embeddings = []
            for text in texts:
                embeddings.append(self._get_text_embedding(text))

            return embeddings

        if self.deployment_name is not None:
            engine = self.deployment_name
        else:
            key = (self.mode, self.model)
            if key not in _TEXT_MODE_MODEL_DICT:
                raise ValueError(f"Invalid mode, model combination: {key}")
            engine = _TEXT_MODE_MODEL_DICT[key]
        embeddings = get_embeddings(texts, engine=engine, api_key=self.openai_api_key,
                                    api_type=self.openai_api_type, api_version=self.openai_api_version,
                                    api_base=self.openai_api_base)
        return embeddings

    async def _aget_text_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Asynchronously get text embeddings."""
        if self.openai_api_type and self.openai_api_type == 'azure':
            embeddings = []
            for text in texts:
                embeddings.append(await self._aget_text_embedding(text))

            return embeddings

        if self.deployment_name is not None:
            engine = self.deployment_name
        else:
            key = (self.mode, self.model)
            if key not in _TEXT_MODE_MODEL_DICT:
                raise ValueError(f"Invalid mode, model combination: {key}")
            engine = _TEXT_MODE_MODEL_DICT[key]
        embeddings = await aget_embeddings(texts, engine=engine, api_key=self.openai_api_key,
                                           api_type=self.openai_api_type, api_version=self.openai_api_version,
                                           api_base=self.openai_api_base)
        return embeddings
