from typing import Any

from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class TwilioProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            # Extract credentials
            account_sid = credentials["account_sid"]
            auth_token = credentials["auth_token"]
            from_number = credentials["from_number"]

            # Initialize twilio client
            client = Client(account_sid, auth_token)

            # fetch account
            client.api.accounts(account_sid).fetch()

        except TwilioRestException as e:
            raise ToolProviderCredentialValidationError(f"Twilio API error: {e.msg}") from e
        except KeyError as e:
            raise ToolProviderCredentialValidationError(f"Missing required credential: {e}") from e
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
