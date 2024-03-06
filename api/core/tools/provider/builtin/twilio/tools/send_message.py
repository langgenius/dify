from typing import Any, Union

from langchain.utilities import TwilioAPIWrapper

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class SendMessageTool(BuiltinTool):
    """
    A tool for sending messages using Twilio API.

    Args:
        user_id (str): The ID of the user invoking the tool.
        tool_parameters (Dict[str, Any]): The parameters required for sending the message.

    Returns:
        Union[ToolInvokeMessage, List[ToolInvokeMessage]]: The result of invoking the tool, which includes the status of the message sending operation.
    """

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        account_sid = self.runtime.credentials["account_sid"]
        auth_token = self.runtime.credentials["auth_token"]
        from_number = self.runtime.credentials["from_number"]

        message = tool_parameters["message"]
        to_number = tool_parameters["to_number"]

        if to_number.startswith("whatsapp:"):
            from_number = f"whatsapp: {from_number}"

        twilio = TwilioAPIWrapper(
            account_sid=account_sid, auth_token=auth_token, from_number=from_number
        )

        # Sending the message through Twilio
        result = twilio.run(message, to_number)

        return self.create_text_message(text="Message sent successfully.")
