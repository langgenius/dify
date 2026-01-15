from .base import BaseServiceError


class AppAssetNodeNotFoundError(BaseServiceError):
    pass


class AppAssetParentNotFoundError(BaseServiceError):
    pass


class AppAssetPathConflictError(BaseServiceError):
    pass


class AppAssetNodeTooLargeError(BaseServiceError):
    pass
