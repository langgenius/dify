from libs.exception import BaseHTTPException


class EndUserNotFoundError(BaseHTTPException):
    error_code = "end_user_not_found"
    description = "End user not found."
    code = 404
