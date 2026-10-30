from libs.exception import BaseHTTPException


class OpenUIBlockNotReadyHTTPError(BaseHTTPException):
    error_code = "openui_block_not_ready"
    description = "Only completed OpenUI blocks accept form state."
    code = 409
