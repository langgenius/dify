from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class TableStoreConfig(BaseSettings):
    """
    Configuration settings for TableStore.
    """

    TABLESTORE_ENDPOINT: Optional[str] = Field(
        description="Endpoint address of the TableStore server (e.g. 'https://instance-name.cn-hangzhou.ots.aliyuncs.com')",
        default=None,
    )

    TABLESTORE_INSTANCE_NAME: Optional[str] = Field(
        description="Instance name to access TableStore server (eg. 'instance-name')",
        default=None,
    )

    TABLESTORE_ACCESS_KEY_ID: Optional[str] = Field(
        description="AccessKey id for the instance name",
        default=None,
    )

    TABLESTORE_ACCESS_KEY_SECRET: Optional[str] = Field(
        description="AccessKey secret for the instance name",
        default=None,
    )

    TABLESTORE_NORMALIZE_FULLTEXT_BM25_SCORE: bool = Field(
        description="Whether to normalize full-text search scores to [0, 1]",
        default=False,
    )
