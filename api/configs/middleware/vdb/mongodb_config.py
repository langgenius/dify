from urllib.parse import quote_plus

from pydantic import Field, computed_field, model_validator
from pydantic_settings import BaseSettings


class MongoDBConfig(BaseSettings):
    """
    Configuration settings for MongoDB vector database
    """

    MONGODB_URI: str | None = Field(
        description="MongoDB Connection URI (e.g., 'mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority')",
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

    @computed_field
    @property
    def MONGODB_CONNECT_URI(self) -> str:
        if self.MONGODB_URI:
            return self.MONGODB_URI
        
        if not self.MONGODB_HOST:
             return "mongodb://localhost:27017"
        
        auth = ""
        if self.MONGODB_USERNAME:
            password = quote_plus(self.MONGODB_PASSWORD) if self.MONGODB_PASSWORD else ""
            auth = f"{quote_plus(self.MONGODB_USERNAME)}:{password}@"
        
        return f"mongodb://{auth}{self.MONGODB_HOST}:{self.MONGODB_PORT}"

    @model_validator(mode="after")
    def validate_mongodb_config(self):
        if not self.MONGODB_URI and self.MONGODB_HOST and not (self.MONGODB_USERNAME and self.MONGODB_PASSWORD):
            # Warn or raise error? For local dev defaults might be loose, but for production it's risky.
            # Given the review, strict validation is preferred. 
            # However, standard mongo often runs without auth in local/test. 
            # I'll allow it if explicitly set to empty strings, but checks are good.
            # Let's just validate that if USERNAME is set, PASSWORD should be too, or vice versa if needed?
            # Actually, standard mongo auth requires both.
            if self.MONGODB_USERNAME and not self.MONGODB_PASSWORD:
                 raise ValueError("MONGODB_PASSWORD is required when MONGODB_USERNAME is set.")
            
        return self
