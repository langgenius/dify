from libs.exception import BaseHTTPException


class FilenameNotExistsError(BaseHTTPException):
    error_code = "filename_not_exists_error"
    code = 400
    description = "The specified filename does not exist."


class RemoteFileUploadError(BaseHTTPException):
    error_code = "remote_file_upload_error"
    code = 400
    description = "Error uploading remote file."


class RemoteFileInvalidUrlError(BaseHTTPException):
    error_code = "remote_file_invalid_url"
    description = "The remote file URL is invalid."
    code = 400


class RemoteFileUrlBlockedError(BaseHTTPException):
    error_code = "remote_file_url_blocked"
    description = "The remote file URL is not allowed."
    code = 400


class RemoteFileNotFoundError(BaseHTTPException):
    error_code = "remote_file_not_found"
    description = "The remote file could not be found."
    code = 404


class RemoteFileAccessDeniedError(BaseHTTPException):
    error_code = "remote_file_access_denied"
    description = "The remote file cannot be accessed without authorization."
    code = 400


class RemoteFileUnavailableError(BaseHTTPException):
    error_code = "remote_file_unavailable"
    description = "The remote file is temporarily unavailable."
    code = 502


class RemoteFileInvalidResponseError(BaseHTTPException):
    error_code = "remote_file_invalid_response"
    description = "The remote file server returned an invalid response."
    code = 502


class FileTooLargeError(BaseHTTPException):
    error_code = "file_too_large"
    description = "File size exceeded. {message}"
    code = 413


class UnsupportedFileTypeError(BaseHTTPException):
    error_code = "unsupported_file_type"
    description = "File type not allowed."
    code = 415


class BlockedFileExtensionError(BaseHTTPException):
    error_code = "file_extension_blocked"
    description = "The file extension is blocked for security reasons."
    code = 400


class TooManyFilesError(BaseHTTPException):
    error_code = "too_many_files"
    description = "Only one file is allowed."
    code = 400


class NoFileUploadedError(BaseHTTPException):
    error_code = "no_file_uploaded"
    description = "Please upload your file."
    code = 400


class NotFoundError(BaseHTTPException):
    error_code = "not_found"
    code = 404


class InvalidArgumentError(BaseHTTPException):
    error_code = "invalid_param"
    code = 400
