class InvalidAuthenticationError(Exception):
    pass


class InvalidAPIKeyError(Exception):
    pass


class RateLimitReachedError(Exception):
    pass


class InsufficientAccountBalanceError(Exception):
    pass


class InternalServerError(Exception):
    pass


class BadRequestError(Exception):
    pass
