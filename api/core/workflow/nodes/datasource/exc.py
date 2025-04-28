class DatasourceNodeError(ValueError):
    """Base exception for datasource node errors."""

    pass


class DatasourceParameterError(DatasourceNodeError):
    """Exception raised for errors in datasource parameters."""

    pass


class DatasourceFileError(DatasourceNodeError):
    """Exception raised for errors related to datasource files."""

    pass
