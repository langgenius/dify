from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class OracleConfig(BaseSettings):
    """
    Configuration settings for Oracle database
    """

    ORACLE_HOST: Optional[str] = Field(
        description="Hostname or IP address of the Oracle database server (e.g., 'localhost' or 'oracle.example.com')",
        default=None,
    )

    ORACLE_PORT: PositiveInt = Field(
        description="Port number on which the Oracle database server is listening (default is 1521)",
        default=1521,
    )

    ORACLE_USER: Optional[str] = Field(
        description="Username for authenticating with the Oracle database",
        default=None,
    )

    ORACLE_PASSWORD: Optional[str] = Field(
        description="Password for authenticating with the Oracle database",
        default=None,
    )

    ORACLE_DATABASE: Optional[str] = Field(
        description="Name of the Oracle database or service to connect to (e.g., 'ORCL' or 'pdborcl')",
        default=None,
    )
