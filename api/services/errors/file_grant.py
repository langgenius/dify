class AppNotFoundError(Exception):
    pass


class EndUserNotFoundError(Exception):
    pass


class InvalidGrantRequestError(Exception):
    pass


class InvalidFileGrantError(Exception):
    pass


class GrantTtlTooLongError(Exception):
    pass


class GrantedFileNotFoundError(Exception):
    pass


class InvalidSubjectError(Exception):
    pass


class RemoteFileUnavailableError(Exception):
    pass


class TooManyFileRefsError(Exception):
    pass
