class MetadataResourceNotFoundError(Exception):
    pass


class InvalidMetadataValueError(ValueError):
    """Raised when a document metadata value does not match its field type."""
