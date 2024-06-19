from typing import Optional

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
        default=None,
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
    def SQLALCHEMY_DATABASE_URI(self):
        db_extras = f"?client_encoding={self.DB_CHARSET}" if self.DB_CHARSET else ""
        return f"{self.SQLALCHEMY_DATABASE_URI_SCHEME}://{self.DB_USERNAME}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_DATABASE}{db_extras}"
