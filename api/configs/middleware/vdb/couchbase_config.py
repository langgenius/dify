from pydantic import Field
from pydantic_settings import BaseSettings


class CouchbaseConfig(BaseSettings):
    """
    Couchbase configs
    """

    COUCHBASE_CONNECTION_STRING: str | None = Field(
        description="COUCHBASE connection string",
        default=None,
    )

    COUCHBASE_USER: str | None = Field(
        description="COUCHBASE user",
        default=None,
    )

    COUCHBASE_PASSWORD: str | None = Field(
        description="COUCHBASE password",
        default=None,
    )

    COUCHBASE_BUCKET_NAME: str | None = Field(
        description="COUCHBASE bucket name",
        default=None,
    )

    COUCHBASE_SCOPE_NAME: str | None = Field(
        description="COUCHBASE scope name",
        default=None,
    )
