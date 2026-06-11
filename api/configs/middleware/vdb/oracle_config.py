from pydantic import Field, NonNegativeInt, PositiveInt
from pydantic_settings import BaseSettings


class OracleConfig(BaseSettings):
    """
    Configuration settings for the Oracle database.
    """

    ORACLE_USER: str | None = Field(
        description="Username for authenticating with the Oracle database",
        default=None,
    )

    ORACLE_PASSWORD: str | None = Field(
        description="Password for authenticating with the Oracle database",
        default=None,
    )

    ORACLE_DSN: str | None = Field(
        description="Oracle database connection string. For a traditional database, use format "
        "'host:port/service_name'. For an autonomous database, use the service name from tnsnames.ora in the wallet",
        default=None,
    )

    ORACLE_CONFIG_DIR: str | None = Field(
        description="Directory containing the tnsnames.ora configuration file. Only used in thin mode connection",
        default=None,
    )

    ORACLE_WALLET_LOCATION: str | None = Field(
        description="Oracle wallet directory path containing the wallet files for secure connection",
        default=None,
    )

    ORACLE_WALLET_PASSWORD: str | None = Field(
        description="Password to decrypt the Oracle wallet, if it is encrypted",
        default=None,
    )

    ORACLE_IS_AUTONOMOUS: bool = Field(
        description="Flag indicating whether connecting to Oracle Autonomous Database",
        default=False,
    )

    ORACLE_POOL_MIN: PositiveInt = Field(
        description="Minimum number of Oracle connections kept open in the pool",
        default=1,
    )

    ORACLE_POOL_MAX: PositiveInt = Field(
        description="Maximum number of Oracle connections allowed in the pool",
        default=5,
    )

    ORACLE_POOL_INCREMENT: PositiveInt = Field(
        description="Number of Oracle connections to add when the pool needs to grow",
        default=1,
    )

    ORACLE_POOL_PING_INTERVAL: NonNegativeInt = Field(
        description="Seconds before a pooled Oracle connection is pinged on acquire; 0 validates every checkout",
        default=0,
    )
