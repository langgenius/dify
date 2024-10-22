from services.errors.base import BaseServiceError


class WorkSpaceNotAllowedCreateError(BaseServiceError):
    pass


class WorkSpaceNotFoundError(BaseServiceError):
    pass
