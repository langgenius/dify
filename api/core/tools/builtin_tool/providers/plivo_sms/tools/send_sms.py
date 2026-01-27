from collections.abc import Generator
from typing import Any

import plivo

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError


class SendSmsTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Send an SMS message using Plivo.

        :param user_id: the user id
        :param tool_parameters: the tool parameters containing to, from_number, and message
        :return: generator yielding tool invoke messages
        """
        # Extract parameters
        to_number = tool_parameters.get("to", "").strip()
        from_number = tool_parameters.get("from_number", "").strip()
        message_text = tool_parameters.get("message", "").strip()

        # Validate required parameters
        if not to_number:
            raise ToolInvokeError("Destination phone number (to) is required.")
        if not from_number:
            raise ToolInvokeError("Source phone number (from_number) is required.")
        if not message_text:
            raise ToolInvokeError("Message content is required.")

        # Get credentials from runtime
        if not self.runtime or not self.runtime.credentials:
            raise ToolInvokeError("Tool runtime credentials are not configured.")

        auth_id = self.runtime.credentials.get("auth_id", "")
        auth_token = self.runtime.credentials.get("auth_token", "")

        if not auth_id or not auth_token:
            raise ToolInvokeError("Plivo Auth ID and Auth Token are required.")

        try:
            # Create Plivo client
            client = plivo.RestClient(auth_id=auth_id, auth_token=auth_token)

            # Send SMS
            response = client.messages.create(
                src=from_number,
                dst=to_number,
                text=message_text,
            )

            # Extract response details
            message_uuid = response.message_uuid[0] if response.message_uuid else "unknown"

            # Return success message with details
            result = {
                "status": "success",
                "message_uuid": message_uuid,
                "to": to_number,
                "from": from_number,
                "message": message_text,
            }

            yield self.create_text_message(
                f"SMS sent successfully to {to_number}. Message UUID: {message_uuid}"
            )
            yield self.create_json_message(result)

        except plivo.exceptions.AuthenticationError:
            raise ToolInvokeError("Plivo authentication failed. Please check your credentials.")
        except plivo.exceptions.ValidationError as e:
            raise ToolInvokeError(f"Invalid request parameters: {str(e)}")
        except plivo.exceptions.PlivoRestError as e:
            raise ToolInvokeError(f"Plivo API error: {str(e)}")
        except Exception as e:
            raise ToolInvokeError(f"Failed to send SMS: {str(e)}")
