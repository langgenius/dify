import base64
import binascii
import hashlib
import math
import secrets
from os import environ

import numpy as np
import qdrant_client
from langchain.embeddings import MiniMaxEmbeddings, OpenAIEmbeddings
from langchain.vectorstores import Milvus
from numpy import average

from core.index.vector_index.qdrant import Qdrant

OPENAI_API_KEY = "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"  # example: "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
## Set up environment variables
environ["OPENAI_API_KEY"] = OPENAI_API_KEY
environ["MINIMAX_GROUP_ID"] = "1686736670459291"
environ["MINIMAX_API_KEY"] = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJOYW1lIjoiIiwiU3ViamVjdElEIjoiMTY4NjczNjY3MDQ0NzEyNSIsIlBob25lIjoiTVRVd01UZzBNREU1TlRFPSIsIkdyb3VwSUQiOiIiLCJQYWdlTmFtZSI6IiIsIk1haWwiOiJwYW5wYW5AZGlmeS5haSIsIkNyZWF0ZVRpbWUiOiIiLCJpc3MiOiJtaW5pbWF4In0.i9gRKYmOW3zM8vEcT7lD-Ym-0eE6UUU3vb-gVxpWfSMkdc6ObbRnkP5nYumZJbV9L-yRA00GW6nMWYcWkY3IbDWWFAi-hRmzAtl-orpkz5DxPzjRJbwAPy9snYlqBWYQ4hOQ-53zmA5wgsm0ga5pMpBTN9SCkm7EnBQDEsPEY1m121tuwXe6LhAMjdX0Kic-UI-KTYbDdWGAl6nu8h8lrSHVuEEYA6Lz3VDyJTcYfME-B435vw-x1UXSb5-V-YhMEhIixEO8ezUQXaERq0mErtIQEoZN4r7OeNNGjocsfwiHRiw_EdxbfYUWjpvAytmmekIuL3tfvfhbif-EZc4E5w"

def test_query():
    #embeddings = MiniMaxEmbeddings()
    embeddings = OpenAIEmbeddings(model="text-embedding-ada-002")
    query = '电影排名:4'
    # search_params = {"metric_type": "IP", "params": {"level": 2}}
    # docs = Milvus(embedding_function=embeddings, collection_name='jytest4').similarity_search(query)
    result = Milvus(embedding_function=embeddings, collection_name='jytest5', connection_args={"uri": 'https://in01-7af631b9d591cb7.aws-us-west-2.vectordb.zillizcloud.com:19541',
                           'user': 'db_admin', 'password': 'difyai123!'}).similarity_search(query, param={"metric_type": "IP"})
    print(result)
    print(result)
    client = qdrant_client.QdrantClient(
        "https://7cceb067-61b5-4d74-9a4c-c82b683ed4d5.eu-central-1-0.aws.cloud.qdrant.io",
        api_key="xA7RZJa2-uJIPMHoCRiZf8t4Se7J_CAHezeaGKbnx6qcglg9ssEjRA",  # For Qdrant Cloud, None for local instance
    )
    result = Qdrant(embeddings=embeddings, client=client, collection_name="texts2").similarity_search(query)
    print(result)
