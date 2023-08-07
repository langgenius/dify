import datetime
import re
from os import environ
from uuid import uuid4

import openai
import qdrant_client
from langchain.document_loaders import WebBaseLoader, UnstructuredFileLoader, TextLoader
from langchain.embeddings import OpenAIEmbeddings, MiniMaxEmbeddings
from langchain.schema import Document
from langchain.text_splitter import CharacterTextSplitter, RecursiveCharacterTextSplitter
from langchain.vectorstores import Milvus, Qdrant
from pymilvus import connections, Collection
from pymilvus.orm import utility

from core.data_loader.loader.excel import ExcelLoader
from core.generator.llm_generator import LLMGenerator
from core.spiltter.fixed_text_splitter import FixedRecursiveCharacterTextSplitter

OPENAI_API_KEY = ""  # example: "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
## Set up environment variables
environ["OPENAI_API_KEY"] = OPENAI_API_KEY
environ["MINIMAX_GROUP_ID"] = "1686736670459291"
environ[
    "MINIMAX_API_KEY"] = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJOYW1lIjoiIiwiU3ViamVjdElEIjoiMTY4NjczNjY3MDQ0NzEyNSIsIlBob25lIjoiTVRVd01UZzBNREU1TlRFPSIsIkdyb3VwSUQiOiIiLCJQYWdlTmFtZSI6IiIsIk1haWwiOiJwYW5wYW5AZGlmeS5haSIsIkNyZWF0ZVRpbWUiOiIiLCJpc3MiOiJtaW5pbWF4In0.i9gRKYmOW3zM8vEcT7lD-Ym-0eE6UUU3vb-gVxpWfSMkdc6ObbRnkP5nYumZJbV9L-yRA00GW6nMWYcWkY3IbDWWFAi-hRmzAtl-orpkz5DxPzjRJbwAPy9snYlqBWYQ4hOQ-53zmA5wgsm0ga5pMpBTN9SCkm7EnBQDEsPEY1m121tuwXe6LhAMjdX0Kic-UI-KTYbDdWGAl6nu8h8lrSHVuEEYA6Lz3VDyJTcYfME-B435vw-x1UXSb5-V-YhMEhIixEO8ezUQXaERq0mErtIQEoZN4r7OeNNGjocsfwiHRiw_EdxbfYUWjpvAytmmekIuL3tfvfhbif-EZc4E5w"

CONVERSATION_PROMPT = (
    "你是出题人.\n"
    "用户会发送一段长文本.\n请一步一步思考"
    'Step1：了解并总结这段文本的主要内容\n'
    'Step2：这段文本提到了哪些关键信息或概念\n'
    'Step3：可分解或结合多个信息与概念\n'
    'Step4：将这些关键信息与概念生成 10 个问题与答案，问题描述清楚并且详细完整,答案详细完整.\n'
    "按格式回答: Q1:\nA1:\nQ2:\nA2:...\n"
)


def test_milvus():

    # 84b2202c-c359-46b7-a810-bce50feaa4d1
    # Use the WebBaseLoader to load specified web pages into documents
    # loader = WebBaseLoader([
    #     "https://milvus.io/docs/overview.md",
    # ])
    loader = ExcelLoader('/Users/jiangyong/Downloads/xiaoming.xlsx')
    #loader = TextLoader('/Users/jiangyong/Downloads/test.txt', autodetect_encoding=True)
    # loader = UnstructuredFileLoader('/Users/jiangyong/Downloads/douban.xlsx')
    docs = loader.load()
    #
    # # Split the documents into smaller chunks
    splitter = FixedRecursiveCharacterTextSplitter.from_tiktoken_encoder(
        chunk_size=1000,
        chunk_overlap=0,
        fixed_separator="###",
        separators=["\n\n", "。", ".", " ", ""]
    )
    embeddings = OpenAIEmbeddings(model="text-embedding-ada-002")
    for doc in docs:
        documents = splitter.split_documents([doc])

        #embeddings = MiniMaxEmbeddings()
        # cont = connections.connect(
        #     alias="default",
        #     user='username',
        #     password='password',
        #     host='localhost',
        #     port='19530'
        # )
        chunk_size = 100
        for i in range(0, len(documents), chunk_size):
            # check document is paused
            chunk_documents = documents[i:i + chunk_size]

            # client = qdrant_client.QdrantClient(
            #     "https://7cceb067-61b5-4d74-9a4c-c82b683ed4d5.eu-central-1-0.aws.cloud.qdrant.io",
            #     api_key="xA7RZJa2-uJIPMHoCRiZf8t4Se7J_CAHezeaGKbnx6qcglg9ssEjRA",  # For Qdrant Cloud, None for local instance
            # )
            #
            # doc_store = Qdrant(
            #     client=client, collection_name="jytest",
            #     embeddings=embeddings,
            # )
            # vector_store = Milvus.from_documents(
            #     chunk_documents,
            #     collection_name='jytest',
            #     embedding=embeddings,
            #     index_params={"metric_type": "IP", "index_type": "HNSW"},
            #
            #     connection_args={"uri": 'https://in01-7af631b9d591cb7.aws-us-west-2.vectordb.zillizcloud.com:19541',
            #                      'user': 'db_admin', 'password': 'difyai123!'}
            # )
            doc_store = Qdrant.from_documents(
                chunk_documents, embeddings, url="https://7cceb067-61b5-4d74-9a4c-c82b683ed4d5.eu-central-1-0.aws.cloud.qdrant.io",
                api_key="xA7RZJa2-uJIPMHoCRiZf8t4Se7J_CAHezeaGKbnx6qcglg9ssEjRA", collection_name="texts2"
            )
    # collection = Collection("jytest4")  # Get an existing collection.
    # collection.release()
    # print(datetime.datetime.utcnow())
    # alias = uuid4().hex
    # # #connection_args = {"host": 'localhost', "port": '19530'}
    # connection_args = {"uri": 'https://in01-91c80c04f4aed06.aws-us-west-2.vectordb.zillizcloud.com:19530',
    #                    'user': 'db_admin', 'password': 'dify123456!'}
    # connections.connect(alias=alias, **connection_args)
    # connection = Collection(
    #     'jytest10',
    #     using=alias,
    # )
    # print(datetime.datetime.utcnow())
    # # connection.release()
    query = '阿甘正传'
    # search_params = {"metric_type": "IP", "params": {"level": 2}}
    # docs = Milvus(embedding_function=embeddings, collection_name='jytest4').similarity_search(query)
    result = Milvus(embedding_function=embeddings, collection_name='jytest1', connection_args={"uri": 'https://in01-7af631b9d591cb7.aws-us-west-2.vectordb.zillizcloud.com:19541',
                           'user': 'db_admin', 'password': 'difyai123!'}).similarity_search(query)
    # docs = Milvus(embedding_function=embeddings, collection_name='jytest10', connection_args={"uri": 'https://in01-91c80c04f4aed06.aws-us-west-2.vectordb.zillizcloud.com:19530',
    #                           'token': '01a3da355f5645fe949b1c6e97339c90b1931b6726094fcac3dd0594ab6312eb4ea314095ca989d7dfc8abfac1092dd1a6d46017', 'db_name':'dify'}).similarity_search(query)
    # print(datetime.datetime.utcnow())
    # docs = vector_store.similarity_search(query)
    # cont = connections.connect(
    #     alias="default",
    #     user='username',
    #     password='password',
    #     host='localhost',
    #     port='19530'
    # )

    # docs = cont.search(query='What is milvus?', search_type='similarity',
    #                    connection_args={"host": 'localhost', "port": '19530'})
    # docs = vector_store.similarity_search(query)

    print(result)

    # connections.connect("default",
    #                     uri='https://in01-617651a0cb211be.aws-us-west-2.vectordb.zillizcloud.com:19533',
    #                     user='db_admin',
    #                     password='dify123456!')
    #
    # # Check if the collection exists
    # collection_name = "jytest"
    # check_collection = utility.has_collection(collection_name)
    # if check_collection:
    #     drop_result = utility.drop_collection(collection_name)
    # print("Success!")
    # collection = Collection(name=collection_name)
    # collection.
    # search_params = {"metric_type": "L2", "params": {"level": 2}}
    # results = collection.search('电影排名50',
    #                             anns_field='page_content',
    #                             param=search_params,
    #                             limit=1,
    #                             guarantee_timestamp=1)
    # connections.disconnect("default")


