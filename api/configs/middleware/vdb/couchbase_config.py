from typing import Optional

from pydantic import BaseModel, Field


class CouchbaseConfig(BaseModel):
    """
    Couchbase configs
    """

    COUCHBASE_CONNECTION_STRING: Optional[str] = Field(
        description="COUCHBASE connection string",
        default=None,
    )

    COUCHBASE_USER: Optional[str] = Field(
        description="COUCHBASE user",
        default=None,
    )

    COUCHBASE_PASSWORD: Optional[str] = Field(
        description="COUCHBASE password",
        default=None,
    )

    COUCHBASE_BUCKET_NAME: Optional[str] = Field(
        description="COUCHBASE bucket name",
        default=None,
    )

    COUCHBASE_SCOPE_NAME: Optional[str] = Field(
        description="COUCHBASE scope name",
        default=None,
    )
