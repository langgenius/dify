from typing import Any, Optional

from pydantic import BaseModel, Field, PositiveInt, computed_field


class DatabaseConfigs(BaseModel):
    """
    Database configs
    """

    DB_USERNAME: str = Field(
        description='Database',
        default='postgres',
    )

    DB_PASSWORD: str = Field(
        description='Database',
        default='',
    )

    DB_HOST: str = Field(
        description='Database',
        default='',
    )

    DB_PORT: PositiveInt = Field(
        description='Database',
        default=5432,
    )

    DB_DATABASE: str = Field(
        description='Database',
        default='dify',
    )

    DB_CHARSET: Optional[str] = Field(
        description='Database',
        default=None,
    )

    SQLALCHEMY_DATABASE_URI_SCHEME: str = Field(
        description='Database',
        default='postgresql',
    )

    @computed_field
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        db_extras = f"?client_encoding={self.DB_CHARSET}" if self.DB_CHARSET else ""
        return f"{self.SQLALCHEMY_DATABASE_URI_SCHEME}://{self.DB_USERNAME}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_DATABASE}{db_extras}"

    SQLALCHEMY_POOL_SIZE: int = Field(
        description='Database',
        default=0,
    )

    SQLALCHEMY_MAX_OVERFLOW: PositiveInt = Field(
        description='Database',
        default=10,
    )

    SQLALCHEMY_POOL_RECYCLE: PositiveInt = Field(
        description='Database',
        default=3600,
    )

    SQLALCHEMY_POOL_PRE_PING: bool = Field(
        description='Database',
        default=False,
    )

    @computed_field
    @property
    def SQLALCHEMY_ENGINE_OPTIONS(self) -> dict[str, Any]:
        return {
            'pool_size': self.SQLALCHEMY_POOL_SIZE,
            'max_overflow': self.SQLALCHEMY_MAX_OVERFLOW,
            'pool_recycle': self.SQLALCHEMY_POOL_RECYCLE,
            'pool_pre_ping': self.SQLALCHEMY_POOL_PRE_PING,
            'connect_args': {'options': '-c timezone=UTC'},
        }

    SQLALCHEMY_ECHO: bool = Field(
        description='Database',
        default=False,
    )
