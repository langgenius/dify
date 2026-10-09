class RagPipelineResourceNotFoundError(Exception):
    pass


class RagPipelinePublicationError(ValueError):
    """The proposed Pipeline cannot be published with its current configuration."""
