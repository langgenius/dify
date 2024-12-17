from werkzeug.exceptions import HTTPException


class FilenameNotExistsError(HTTPException):
    code = 400
    description = "The specified filename does not exist."
