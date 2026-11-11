"""Translate machine credential application failures at HTTP transport boundaries."""

from collections.abc import Generator
from contextlib import contextmanager

from werkzeug.exceptions import BadRequest, Forbidden, NotFound, Unauthorized

from services.auth.resource_access_token_contracts import (
    ResourceAccessTokenForbiddenError,
    ResourceAccessTokenInputError,
    ResourceAccessTokenInvalidError,
    ResourceAccessTokenNotFoundError,
)


@contextmanager
def resource_access_token_errors() -> Generator[None]:
    try:
        yield
    except ResourceAccessTokenInputError as error:
        raise BadRequest(str(error)) from error
    except ResourceAccessTokenForbiddenError as error:
        raise Forbidden(str(error)) from error
    except ResourceAccessTokenNotFoundError as error:
        raise NotFound(str(error)) from error
    except ResourceAccessTokenInvalidError as error:
        raise Unauthorized(str(error)) from error
