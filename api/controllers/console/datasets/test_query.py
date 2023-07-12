import base64
import binascii
import hashlib
import secrets
from os import environ

import numpy as np
from langchain.embeddings import MiniMaxEmbeddings
from numpy import average
from sentence_transformers import SentenceTransformer

from core.index.vector_index.milvus import Milvus

environ["MINIMAX_GROUP_ID"] = "1686736670459291"
environ["MINIMAX_API_KEY"] = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJOYW1lIjoiIiwiU3ViamVjdElEIjoiMTY4NjczNjY3MDQ0NzEyNSIsIlBob25lIjoiTVRVd01UZzBNREU1TlRFPSIsIkdyb3VwSUQiOiIiLCJQYWdlTmFtZSI6IiIsIk1haWwiOiJwYW5wYW5AZGlmeS5haSIsIkNyZWF0ZVRpbWUiOiIiLCJpc3MiOiJtaW5pbWF4In0.i9gRKYmOW3zM8vEcT7lD-Ym-0eE6UUU3vb-gVxpWfSMkdc6ObbRnkP5nYumZJbV9L-yRA00GW6nMWYcWkY3IbDWWFAi-hRmzAtl-orpkz5DxPzjRJbwAPy9snYlqBWYQ4hOQ-53zmA5wgsm0ga5pMpBTN9SCkm7EnBQDEsPEY1m121tuwXe6LhAMjdX0Kic-UI-KTYbDdWGAl6nu8h8lrSHVuEEYA6Lz3VDyJTcYfME-B435vw-x1UXSb5-V-YhMEhIixEO8ezUQXaERq0mErtIQEoZN4r7OeNNGjocsfwiHRiw_EdxbfYUWjpvAytmmekIuL3tfvfhbif-EZc4E5w"

def test_query():
    # embeddings = MiniMaxEmbeddings()
    # query = '你对这部电影有什么感悟'
    # # search_params = {"metric_type": "IP", "params": {"level": 2}}
    # # docs = Milvus(embedding_function=embeddings, collection_name='jytest4').similarity_search(query)
    # docs = Milvus(embedding_function=embeddings, collection_name='jytest5',
    #               connection_args={"uri": 'https://in01-706333b4f51fa0b.aws-us-west-2.vectordb.zillizcloud.com:19530',
    #                                'user': 'db_admin', 'password': 'dify123456!'}).similarity_search(query)
    # print(docs)

    # generate password salt
    def hash_password(password_str, salt_byte):
        dk = hashlib.pbkdf2_hmac('sha256', password_str.encode('utf-8'), salt_byte, 10000)
        return binascii.hexlify(dk)
    salt = secrets.token_bytes(16)
    base64_salt = base64.b64encode(salt).decode()

    # encrypt password with salt
    password_hashed = hash_password('dify123456!', salt)
    base64_password_hashed = base64.b64encode(password_hashed).decode()
    print(base64_password_hashed)
    print('*******************')
    print(base64_salt)
