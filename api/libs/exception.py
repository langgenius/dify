from werkzeug.exceptions import HTTPException


class BaseHTTPException(HTTPException):
    error_code: str = "unknown"
    data: dict | None = None

    def __init__(self, description=None, response=None, *, error_code: str | None = None):
        super().__init__(description, response)

        if error_code is not None:
            self.error_code = error_code

        self.data = {
            "code": self.error_code,
            "message": self.description,
            "status": self.code,
        }
