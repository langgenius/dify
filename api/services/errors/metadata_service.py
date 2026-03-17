class MetadataInUseError(ValueError):
    """Raised when metadata is still referenced by a pipeline configuration."""
