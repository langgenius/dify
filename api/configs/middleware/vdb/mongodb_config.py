from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class MongoDBConfig(BaseSettings):
    """
    Configuration settings for MongoDB connection and database.
    """

    # MongoURI and MONGO_DATABASE
    MONGO_URI: Optional[str] = Field(
        description="MongoDB connection URI",
        default="mongodb://localhost:27017/?retryWrites=true&w=majority&directConnection=true",
    )

    MONGO_DATABASE: Optional[str] = Field(
        description="Name of the MongoDB database to connect to",
        default="sample_mflix",
    )
