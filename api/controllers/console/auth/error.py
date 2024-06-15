from libs.exception import BaseHTTPException


class ApiKeyAuthFailedError(BaseHTTPException):
    error_code = 'auth_failed'
    description = "{message}"
    code = 500
