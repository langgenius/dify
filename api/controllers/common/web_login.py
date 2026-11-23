"""HTTP translation for the Account-to-Web login handoff."""

from collections.abc import Generator
from contextlib import contextmanager

from pydantic import BaseModel, ConfigDict, Field
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


class WebLoginExchangePayload(BaseModel):
    """Redeem an opaque one-use grant with the original browser's S256 verifier."""

    model_config = ConfigDict(hide_input_in_errors=True)

    login_code: str = Field(min_length=1, max_length=256, repr=False)
    code_verifier: str = Field(pattern=r"^[A-Za-z0-9._~-]{43,128}$", repr=False)


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
