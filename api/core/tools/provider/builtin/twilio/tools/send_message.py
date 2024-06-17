from typing import Any, Optional, Union

from pydantic import BaseModel, field_validator

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class TwilioAPIWrapper(BaseModel):
    """Messaging Client using Twilio.

    To use, you should have the ``twilio`` python package installed,
    and the environment variables ``TWILIO_ACCOUNT_SID``, ``TWILIO_AUTH_TOKEN``, and
    ``TWILIO_FROM_NUMBER``, or pass `account_sid`, `auth_token`, and `from_number` as
    named parameters to the constructor.
    """

    client: Any = None  #: :meta private:
    account_sid: Optional[str] = None
    """Twilio account string identifier."""
    auth_token: Optional[str] = None
    """Twilio auth token."""
    from_number: Optional[str] = None
    """A Twilio phone number in [E.164](https://www.twilio.com/docs/glossary/what-e164) 
        format, an 
        [alphanumeric sender ID](https://www.twilio.com/docs/sms/send-messages#use-an-alphanumeric-sender-id), 
        or a [Channel Endpoint address](https://www.twilio.com/docs/sms/channels#channel-addresses) 
        that is enabled for the type of message you want to send. Phone numbers or 
        [short codes](https://www.twilio.com/docs/sms/api/short-code) purchased from 
        Twilio also work here. You cannot, for example, spoof messages from a private 
        cell phone number. If you are using `messaging_service_sid`, this parameter 
        must be empty.
    """

    @field_validator('client', mode='before')
    @classmethod
    def set_validator(cls, values: dict) -> dict:
        """Validate that api key and python package exists in environment."""
        try:
            from twilio.rest import Client
        except ImportError:
            raise ImportError(
                "Could not import twilio python package. "
                "Please install it with `pip install twilio`."
            )
        account_sid = values.get("account_sid")
        auth_token = values.get("auth_token")
        values["from_number"] = values.get("from_number")
        values["client"] = Client(account_sid, auth_token)

        return values

    def run(self, body: str, to: str) -> str:
        """Run body through Twilio and respond with message sid.

        Args:
            body: The text of the message you want to send. Can be up to 1,600
                characters in length.
            to: The destination phone number in
                [E.164](https://www.twilio.com/docs/glossary/what-e164) format for
                SMS/MMS or
                [Channel user address](https://www.twilio.com/docs/sms/channels#channel-addresses)
                for other 3rd-party channels.
        """
        message = self.client.messages.create(to, from_=self.from_number, body=body)
        return message.sid


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
