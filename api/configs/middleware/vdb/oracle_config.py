from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class OracleConfig(BaseSettings):
    """
    Configuration settings for Oracle database
    """

    ORACLE_USER: Optional[str] = Field(
        description="Username for authenticating with the Oracle database",
        default=None,
    )

    ORACLE_PASSWORD: Optional[str] = Field(
        description="Password for authenticating with the Oracle database",
        default=None,
    )

    ORACLE_DSN: Optional[str] = Field(
        description="Oracle database connection string. For traditional database, use format 'host:port/service_name'. "
        "For autonomous database, use the service name from tnsnames.ora in the wallet",
        default=None,
    )

    ORACLE_CONFIG_DIR: Optional[str] = Field(
        description="Directory containing the tnsnames.ora configuration file. Only used in thin mode connection",
        default=None,
    )

    ORACLE_WALLET_LOCATION: Optional[str] = Field(
        description="Oracle wallet directory path containing the wallet files for secure connection",
        default=None,
    )

    ORACLE_WALLET_PASSWORD: Optional[str] = Field(
        description="Password to decrypt the Oracle wallet, if it is encrypted",
        default=None,
    )

    ORACLE_IS_AUTONOMOUS: bool = Field(
        description="Flag indicating whether connecting to Oracle Autonomous Database",
        default=False,
    )
