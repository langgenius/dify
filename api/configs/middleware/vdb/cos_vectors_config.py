from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class COSVectorsConfig(BaseSettings):
    """
    Configuration settings for Tencent Cloud COS Vectors.

    Field names mirror ``qcloud_cos.CosConfig`` parameters so mapping to the
    underlying SDK is one-to-one.
    """

    COS_VECTORS_REGION: str | None = Field(
        description="Region of the Tencent Cloud COS Vectors service (e.g., 'ap-beijing', 'ap-shanghai').",
        default=None,
    )

    COS_VECTORS_SECRET_ID: str | None = Field(
        description="SecretId of the Tencent Cloud CAM credential used to access COS Vectors.",
        default=None,
    )

    COS_VECTORS_SECRET_KEY: str | None = Field(
        description="SecretKey of the Tencent Cloud CAM credential used to access COS Vectors.",
        default=None,
    )

    COS_VECTORS_TOKEN: str | None = Field(
        description="Optional temporary session token when using STS credentials.",
        default=None,
    )

    COS_VECTORS_SCHEME: str | None = Field(
        description="Request scheme for the COS Vectors endpoint ('http' or 'https'). Default is 'https'.",
        default="https",
    )

    COS_VECTORS_ENDPOINT: str | None = Field(
        description=(
            "Custom endpoint of the COS Vectors service "
            "(e.g., 'cos-vectors.ap-beijing.myqcloud.com'). Leave empty to use the default for the region."
        ),
        default=None,
    )

    COS_VECTORS_BUCKET_APPID: str | None = Field(
        description=(
            "Name of the COS Vectors bucket (must include the APPID suffix, e.g., 'examplebucket-1250000000')."
        ),
        default=None,
    )

    COS_VECTORS_TIMEOUT: PositiveInt = Field(
        description="Per-request HTTP timeout in seconds for COS Vectors SDK calls.",
        default=30,
    )

    COS_VECTORS_DISTANCE_METRIC: str = Field(
        description="Distance metric used when creating vector indexes. Options: 'cosine' or 'euclidean'.",
        default="cosine",
    )

    COS_VECTORS_DATA_TYPE: str = Field(
        description="Data type of the vector values. Currently only 'float32' is supported.",
        default="float32",
    )

    COS_VECTORS_MAX_UPSERT_BATCH_SIZE: PositiveInt = Field(
        description="Maximum number of vectors in a single PutVectors / DeleteVectors call.",
        default=500,
    )

    COS_VECTORS_NON_FILTERABLE_METADATA_KEYS: str | None = Field(
        description=(
            "Comma-separated metadata keys to mark as non-filterable when creating an index. "
            "Defaults to 'text' so the raw chunk body does not count against the filterable budget."
        ),
        default="text",
    )
