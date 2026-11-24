from http import HTTPStatus

from libs.exception import BaseHTTPException


class TagNameAlreadyExistsError(BaseHTTPException):
    error_code = "tag_name_already_exists"
    description = "Tag name already exists"
    code = HTTPStatus.BAD_REQUEST
