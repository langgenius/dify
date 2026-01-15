from werkzeug.exceptions import HTTPException


class BaseHTTPException(HTTPException):
    error_code: str = "unknown"
    data: dict | None = None

    def __init__(self, description=None, response=None):
        super().__init__(description, response)

        self.data = {
            "code": self.error_code,
            "message": self.description,
            "status": self.code,
        }
