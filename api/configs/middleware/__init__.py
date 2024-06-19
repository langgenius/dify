from typing import Optional

from pydantic import BaseModel, Field

from configs.middleware.redis_configs import RedisConfigs


class StorageConfigs(BaseModel):
    STORAGE_TYPE: str = Field(
        description='storage type,'
                    ' default to `local`,'
                    ' available values are `local`, `s3`, `azure-blob`, `aliyun-oss`, `google-storage`.',
        default='local',
    )

    STORAGE_LOCAL_PATH: str = Field(
        description='local storage path',
        default='storage',
    )


class VectorStoreConfigs(BaseModel):
    VECTOR_STORE: Optional[str] = Field(
        description='vector store type',
        default=None,
    )


class KeywordStoreConfigs(BaseModel):
    KEYWORD_STORE: str = Field(
        description='keyword store type',
        default='jieba',
    )


class MiddlewareConfigs(
    # place the configs in alphabet order
    KeywordStoreConfigs,
    RedisConfigs,
    StorageConfigs,
    VectorStoreConfigs,
):
    pass
