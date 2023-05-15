import os
from typing import Optional

import langchain
from flask import Flask
from jieba.analyse import default_tfidf
from langchain import set_handler
from langchain.prompts.base import DEFAULT_FORMATTER_MAPPING
from llama_index import IndexStructType, QueryMode
from llama_index.indices.registry import INDEX_STRUT_TYPE_TO_QUERY_MAP
from pydantic import BaseModel

from core.callback_handler.std_out_callback_handler import DifyStdOutCallbackHandler
from core.index.keyword_table.jieba_keyword_table import GPTJIEBAKeywordTableIndex
from core.index.keyword_table.stopwords import STOPWORDS
from core.prompt.prompt_template import OneLineFormatter
from core.vector_store.vector_store import VectorStore
from core.vector_store.vector_store_index_query import EnhanceGPTVectorStoreIndexQuery


class HostedOpenAICredential(BaseModel):
    api_key: str


class HostedLLMCredentials(BaseModel):
    openai: Optional[HostedOpenAICredential] = None


hosted_llm_credentials = HostedLLMCredentials()


def init_app(app: Flask):
    formatter = OneLineFormatter()
    DEFAULT_FORMATTER_MAPPING['f-string'] = formatter.format
    INDEX_STRUT_TYPE_TO_QUERY_MAP[IndexStructType.KEYWORD_TABLE] = GPTJIEBAKeywordTableIndex.get_query_map()
    INDEX_STRUT_TYPE_TO_QUERY_MAP[IndexStructType.WEAVIATE] = {
        QueryMode.DEFAULT: EnhanceGPTVectorStoreIndexQuery,
        QueryMode.EMBEDDING: EnhanceGPTVectorStoreIndexQuery,
    }
    INDEX_STRUT_TYPE_TO_QUERY_MAP[IndexStructType.QDRANT] = {
        QueryMode.DEFAULT: EnhanceGPTVectorStoreIndexQuery,
        QueryMode.EMBEDDING: EnhanceGPTVectorStoreIndexQuery,
    }

    default_tfidf.stop_words = STOPWORDS

    if os.environ.get("DEBUG") and os.environ.get("DEBUG").lower() == 'true':
        langchain.verbose = True
        set_handler(DifyStdOutCallbackHandler())

    if app.config.get("OPENAI_API_KEY"):
        hosted_llm_credentials.openai = HostedOpenAICredential(api_key=app.config.get("OPENAI_API_KEY"))
