"""Application failures raised while preparing or executing indexing."""


class IndexingInputError(Exception):
    """Base class for failures while resolving stored extraction inputs."""


class IndexingInputSourceError(IndexingInputError):
    """Raised when a persisted source cannot form a valid extraction input."""


class UnsupportedStoredSourceError(IndexingInputSourceError):
    def __init__(self, source_type: str) -> None:
        self.source_type = source_type
        super().__init__(f"unsupported data source type: {source_type}")


class SourceCredentialUnavailableError(IndexingInputSourceError):
    """Raised when a datasource cannot resolve its required credential policy."""
