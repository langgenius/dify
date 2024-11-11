from libs.exception import BaseHTTPException


class UnsupportedFileTypeError(BaseHTTPException):
    error_code = "unsupported_file_type"
    description = "File type not allowed."
    code = 415
