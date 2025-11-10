from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class OceanBaseVectorConfig(BaseSettings):
    """
    Configuration settings for OceanBase Vector database
    """

    OCEANBASE_HOST: str = Field(
        description="OceanBase hostname or IP address.",
        default="localhost",
    )
    
    OCEANBASE_PORT: PositiveInt = Field(
        description="OceanBase port number.",
        default=2881,
    )
    
    OCEANBASE_USER: str = Field(
        description="OceanBase username.",
        default="root@test",
    )
    
    OCEANBASE_PASSWORD: str = Field(
        description="OceanBase password.",
        default="difyai123456",
    )
    
    OCEANBASE_DATABASE: str = Field(
        description="OceanBase database name.",
        default="test",
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
