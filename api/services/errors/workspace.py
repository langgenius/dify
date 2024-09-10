from services.errors.base import BaseServiceError


class WorkSpaceNotAllowedCreateError(BaseServiceError):
    pass


class WorkSpaceNotFound(BaseServiceError):
    pass
