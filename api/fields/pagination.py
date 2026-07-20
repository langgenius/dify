from pydantic import Field, PositiveInt


class PaginationParamsMixin:
    page: PositiveInt = Field(1, description="1-based page number.")
    limit: PositiveInt = Field(default=20, le=100, description="Maximum number of records returned per page.")


class PaginationResultMixin:
    limit: int = Field(description="Page size used for the current query.")
    total: int = Field(description="Total number of candidates matching the current query.")
    page: int = Field(description="Current 1-based page number.")
