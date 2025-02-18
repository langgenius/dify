from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class AnalyticdbConfig(BaseSettings):
    """
    Configuration for connecting to Alibaba Cloud AnalyticDB for PostgreSQL.
    Refer to the following documentation for details on obtaining credentials:
    https://www.alibabacloud.com/help/en/analyticdb-for-postgresql/getting-started/create-an-instance-instances-with-vector-engine-optimization-enabled
    """

    ANALYTICDB_KEY_ID: Optional[str] = Field(
        default=None, description="The Access Key ID provided by Alibaba Cloud for API authentication."
    )
    ANALYTICDB_KEY_SECRET: Optional[str] = Field(
        default=None, description="The Secret Access Key corresponding to the Access Key ID for secure API access."
    )
    ANALYTICDB_REGION_ID: Optional[str] = Field(
        default=None,
        description="The region where the AnalyticDB instance is deployed (e.g., 'cn-hangzhou', 'ap-southeast-1').",
    )
    ANALYTICDB_INSTANCE_ID: Optional[str] = Field(
        default=None,
        description="The unique identifier of the AnalyticDB instance you want to connect to.",
    )
    ANALYTICDB_ACCOUNT: Optional[str] = Field(
        default=None,
        description="The account name used to log in to the AnalyticDB instance"
        " (usually the initial account created with the instance).",
    )
    ANALYTICDB_PASSWORD: Optional[str] = Field(
        default=None, description="The password associated with the AnalyticDB account for database authentication."
    )
    ANALYTICDB_NAMESPACE: Optional[str] = Field(
        default=None, description="The namespace within AnalyticDB for schema isolation (if using namespace feature)."
    )
    ANALYTICDB_NAMESPACE_PASSWORD: Optional[str] = Field(
        default=None,
        description="The password for accessing the specified namespace within the AnalyticDB instance"
        " (if namespace feature is enabled).",
    )
    ANALYTICDB_HOST: Optional[str] = Field(
        default=None, description="The host of the AnalyticDB instance you want to connect to."
    )
    ANALYTICDB_PORT: PositiveInt = Field(
        default=5432, description="The port of the AnalyticDB instance you want to connect to."
    )
    ANALYTICDB_MIN_CONNECTION: PositiveInt = Field(default=1, description="Min connection of the AnalyticDB database.")
    ANALYTICDB_MAX_CONNECTION: PositiveInt = Field(default=5, description="Max connection of the AnalyticDB database.")
