"""Enterprise service errors."""

from services.errors.base import BaseServiceError


class EnterpriseServiceError(BaseServiceError):
    """Base exception for enterprise service errors."""

    def __init__(self, description: str = "", status_code: int | None = None):
        super().__init__(description)
        self.status_code = status_code


class EnterpriseAPIError(EnterpriseServiceError):
    """Generic enterprise API error (non-2xx response)."""

    pass


class EnterpriseAPINotFoundError(EnterpriseServiceError):
    """Enterprise API returned 404 Not Found."""

    def __init__(self, description: str = ""):
        super().__init__(description, status_code=404)


class EnterpriseAPIForbiddenError(EnterpriseServiceError):
    """Enterprise API returned 403 Forbidden."""

    def __init__(self, description: str = ""):
        super().__init__(description, status_code=403)


class EnterpriseAPIUnauthorizedError(EnterpriseServiceError):
    """Enterprise API returned 401 Unauthorized."""

    def __init__(self, description: str = ""):
        super().__init__(description, status_code=401)


class EnterpriseAPIBadRequestError(EnterpriseServiceError):
    """Enterprise API returned 400 Bad Request."""

    def __init__(self, description: str = ""):
        super().__init__(description, status_code=400)
