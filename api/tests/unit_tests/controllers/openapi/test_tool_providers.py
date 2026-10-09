import pytest
from werkzeug.exceptions import BadRequest

from controllers.openapi._errors import CredentialInvalid
from controllers.openapi.tool_providers import _credential_errors
from core.tools.errors import ToolProviderCredentialValidationError


def _rewrapped(error: Exception) -> None:
    """Raise the way BuiltinToolManageService does: every failure becomes a bare ValueError."""
    try:
        raise error
    except Exception as e:
        raise ValueError(str(e))


def test_rejected_credentials_are_credential_invalid() -> None:
    with pytest.raises(CredentialInvalid):
        with _credential_errors():
            _rewrapped(ToolProviderCredentialValidationError("Invalid credentials"))


@pytest.mark.parametrize(
    "message",
    [
        "the credential name 'main' is already used",
        "you have reached the maximum number of providers for tavily",
        "provider tavily does not need credentials",
    ],
)
def test_other_failures_are_bad_request_with_the_service_message(message: str) -> None:
    with pytest.raises(BadRequest, match=message):
        with _credential_errors():
            _rewrapped(ValueError(message))
