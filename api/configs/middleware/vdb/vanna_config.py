from typing import Optional

from pydantic import Field,PositiveInt
from pydantic_settings import BaseSettings

class VannaConfig(BaseSettings):
    """
    Configuration settings for Milvus vector database
    """

    VANNA_EMBEDDING_HOST: Optional[str] = Field(
        description="vanna 向量模型地址",
        default="http://127.0.0.1:19042",
    )

    VANNA_EMBEDDING_MODEL: Optional[str] = Field(
        description="vanna 向量模型名称",
        default='bge-m3',
    )

    VANNA_EMBEDDING_TYPE: Optional[str] = Field(
        description="vanna 向量模型类型，默认是localhost,可以是ollama或其他类型",
        default="localhost",
    )

    VANNA_LLM_TYPE: Optional[str] = Field(
        description="vanna 语言模型类型，默认是deepseek,可以是ollama或其他类型",
        default="deepseek",
    )

    VANNA_MODEL: str = Field(
        description="vanna 语言模型版本，默认是deepseek-coder",
        default="deepseek-coder",
    )

    VANNA_API_KEY: str = Field(
        description="vanna 大模型API KEY",
        default=None,
    )

    VANNA_SQL_TYPE: Optional[str] = Field(
        description='vanna 训练数据库类型，默认是 postgres',
        default="postgres",
    )
    VANNA_DB_USERNAME: Optional[str] = Field(
        description='vanna 训练数据库用户名，默认是 postgres',
        default='postgres',
    )
    VANNA_DB_PASSWORD: Optional[str] = Field(
        description='vanna 训练数据库 postgres',
        default='difyai123456',
    )
    VANNA_DB_HOST: Optional[str] = Field(
        description='vanna 训练数据库地址，默认是 localhost',
        default='localhost',
    )
    VANNA_DB_PORT: PositiveInt = Field(
        description='vanna 训练数据库端口号，默认是 5432',
        default=5432,
    )
    VANNA_DB_DATABASE: Optional[str] = Field(
        description='vanna 训练数据库名称，默认是 vanna_demo',
        default='vanna_demo',
    )
    VANNA_MILVUS_URI: Optional[str] = Field(
        description='vanna 训练向量数据库地址，默认是 localhost:19530',
        default='localhost:19530',
    )
    VANNA_MILVUS_USER: Optional[str] = Field(
        description='vanna 训练向量数据库用户名，默认是 vanna_demo',
        default='root',
    )
    VANNA_MILVUS_PASSWORD: Optional[str] = Field(
        description='vanna 训练向量数据库密码，默认是 Milvus',
        default='Milvus',
    )
    VANNA_MILVUS_DATABASE: str = Field(
        description='vanna 训练向量数据库名称，默认是 vanna_demo',
        default='vanna_demo',
    )
