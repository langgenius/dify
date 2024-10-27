from typing import Optional

from pydantic import BaseModel, Field


class AnalyticdbConfig(BaseModel):
    """
    Configuration for connecting to AnalyticDB.
    Refer to the following documentation for details on obtaining credentials:
    https://www.alibabacloud.com/help/en/analyticdb-for-postgresql/getting-started/create-an-instance-instances-with-vector-engine-optimization-enabled
    """

    ANALYTICDB_KEY_ID: Optional[str] = Field(
        default=None, description="The Access Key ID provided by Alibaba Cloud for authentication."
    )
    ANALYTICDB_KEY_SECRET: Optional[str] = Field(
        default=None, description="The Secret Access Key corresponding to the Access Key ID for secure access."
    )
    ANALYTICDB_REGION_ID: Optional[str] = Field(
        default=None, description="The region where the AnalyticDB instance is deployed (e.g., 'cn-hangzhou')."
    )
    ANALYTICDB_INSTANCE_ID: Optional[str] = Field(
        default=None,
        description="The unique identifier of the AnalyticDB instance you want to connect to (e.g., 'gp-ab123456')..",
    )
    ANALYTICDB_ACCOUNT: Optional[str] = Field(
        default=None, description="The account name used to log in to the AnalyticDB instance."
    )
    ANALYTICDB_PASSWORD: Optional[str] = Field(
        default=None, description="The password associated with the AnalyticDB account for authentication."
    )
    ANALYTICDB_NAMESPACE: Optional[str] = Field(
        default=None, description="The namespace within AnalyticDB for schema isolation."
    )
    ANALYTICDB_NAMESPACE_PASSWORD: Optional[str] = Field(
        default=None, description="The password for accessing the specified namespace within the AnalyticDB instance."
    )
