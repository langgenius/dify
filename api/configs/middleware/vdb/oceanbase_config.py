from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class OceanBaseVectorConfig(BaseSettings):
    """
    Configuration settings for OceanBase Vector database
    """

    OCEANBASE_VECTOR_HOST: str | None = Field(
        description="Hostname or IP address of the OceanBase Vector server (e.g. 'localhost')",
        default=None,
    )

    OCEANBASE_VECTOR_PORT: PositiveInt | None = Field(
        description="Port number on which the OceanBase Vector server is listening (default is 2881)",
        default=2881,
    )

    OCEANBASE_VECTOR_USER: str | None = Field(
        description="Username for authenticating with the OceanBase Vector database",
        default=None,
    )

    OCEANBASE_VECTOR_PASSWORD: str | None = Field(
        description="Password for authenticating with the OceanBase Vector database",
        default=None,
    )

    OCEANBASE_VECTOR_DATABASE: str | None = Field(
        description="Name of the OceanBase Vector database to connect to",
        default=None,
    )

    OCEANBASE_ENABLE_HYBRID_SEARCH: bool = Field(
        description="Enable hybrid search features (requires OceanBase >= 4.3.5.1). Set to false for compatibility "
        "with older versions",
        default=False,
    )

    OCEANBASE_FULLTEXT_PARSER: str | None = Field(
        description=(
            "Fulltext parser to use for text indexing. "
            "Built-in options: 'ngram' (N-gram tokenizer for English/numbers), "
            "'beng' (Basic English tokenizer), 'space' (Space-based tokenizer), "
            "'ngram2' (Improved N-gram tokenizer), 'ik' (Chinese tokenizer). "
            "External plugins (require installation): 'japanese_ftparser' (Japanese tokenizer), "
            "'thai_ftparser' (Thai tokenizer). Default is 'ik'"
        ),
        default="ik",
    )
