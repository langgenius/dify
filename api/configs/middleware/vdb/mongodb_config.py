from urllib.parse import quote, quote_plus

from pydantic import Field, NonNegativeInt, computed_field, model_validator
from pydantic_settings import BaseSettings


class MongoDBConfig(BaseSettings):
    """Configuration settings for MongoDB Atlas vector database."""

    MONGODB_URI: str | None = Field(
        description=(
            "MongoDB Connection URI "
            "(e.g., 'mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority')"
        ),
        default=None,
    )

    MONGODB_HOST: str | None = Field(
        description="MongoDB Hostname",
        default=None,
    )

    MONGODB_PORT: int = Field(
        description="MongoDB Port",
        default=27017,
    )

    MONGODB_USERNAME: str | None = Field(
        description="MongoDB Username",
        default=None,
    )

    MONGODB_PASSWORD: str | None = Field(
        description="MongoDB Password",
        default=None,
    )

    MONGODB_DATABASE: str = Field(
        description="MongoDB Database Name",
        default="dify",
    )

    MONGODB_VECTOR_INDEX_NAME: str = Field(
        description="Vector Index Name",
        default="vector_index",
    )

    MONGODB_CONNECTION_RETRY_ATTEMPTS: NonNegativeInt = Field(
        description="Maximum number of connection retry attempts (0 disables retries)",
        default=3,
    )

    MONGODB_CONNECTION_RETRY_BACKOFF_BASE: float = Field(
        description="Base delay in seconds for exponential backoff on connection retries",
        default=1.0,
    )

    MONGODB_CONNECTION_RETRY_MAX_WAIT: float = Field(
        description="Maximum wait time in seconds for connection retry backoff",
        default=30.0,
    )

    MONGODB_SERVER_SELECTION_TIMEOUT_MS: NonNegativeInt = Field(
        description="Server selection timeout in milliseconds for MongoDB client (0 = pymongo default)",
        default=5000,
    )

    MONGODB_INDEX_READY_TIMEOUT: NonNegativeInt = Field(
        description="Maximum time in seconds to wait for index to become ready",
        default=300,
    )

    MONGODB_INDEX_READY_CHECK_DELAY: float = Field(
        description="Initial delay in seconds between index ready checks",
        default=1.0,
    )

    MONGODB_INDEX_READY_MAX_DELAY: float = Field(
        description="Maximum delay in seconds between index ready checks",
        default=10.0,
    )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def MONGODB_CONNECT_URI(self) -> str:
        """Return MONGODB_URI if set, otherwise build from host/port/credentials."""
        if self.MONGODB_URI:
            return self.MONGODB_URI
        return self._build_connection_uri()

    def _build_connection_uri(self) -> str:
        if not self.MONGODB_HOST:
            return "mongodb://localhost:27017"

        auth = ""
        if self.MONGODB_USERNAME:
            username = quote_plus(self.MONGODB_USERNAME)
            password = quote(self.MONGODB_PASSWORD or "", safe="") if self.MONGODB_PASSWORD else ""
            auth = f"{username}:{password}@"

        return f"mongodb://{auth}{self.MONGODB_HOST}:{self.MONGODB_PORT}"

    @model_validator(mode="after")
    def validate_mongodb_config(self) -> "MongoDBConfig":
        if self.MONGODB_URI:
            return self
        if self.MONGODB_HOST:
            has_username = bool(self.MONGODB_USERNAME)
            has_password = bool(self.MONGODB_PASSWORD)
            if has_username != has_password:
                raise ValueError("Both MONGODB_USERNAME and MONGODB_PASSWORD must be provided, or neither.")
        return self
