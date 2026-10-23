"""HTTP translation for the Account-to-Web login handoff."""

from collections.abc import Generator
from contextlib import contextmanager

from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.end_user_connections import ConnectionLoginRequiredError
from libs.exception import BaseHTTPException
from services.web_login_handoff import WebLoginUnavailableError
from services.web_passport_service import (
    WebPassportAccountExchangeDisabledError,
    WebPassportNotFoundError,
    WebPassportUnauthorizedError,
)


class WebLoginUnavailableHTTPError(BaseHTTPException):
    code = 503
    error_code = "web_login_unavailable"
    description = "Web App login is temporarily unavailable. Please retry."


@contextmanager
def web_login_errors() -> Generator[None]:
    try:
        yield
    except WebLoginUnavailableError as exc:
        raise WebLoginUnavailableHTTPError() from exc
    except WebPassportAccountExchangeDisabledError as exc:
        raise Forbidden("End User login is not enabled.") from exc
    except WebPassportNotFoundError as exc:
        raise NotFound() from exc
    except WebPassportUnauthorizedError as exc:
        raise ConnectionLoginRequiredError() from exc
