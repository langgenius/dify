import json
import re
from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.email.tools.send import (
    SendEmailToolParameters,
    send_mail,
)
from core.tools.tool.builtin_tool import BuiltinTool


class SendMailTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        sender = self.runtime.credentials.get("email_account", "")
        email_rgx = re.compile(r"^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$")
        password = self.runtime.credentials.get("email_password", "")
        smtp_server = self.runtime.credentials.get("smtp_server", "")
        if not smtp_server:
            return self.create_text_message("please input smtp server")
        smtp_port = self.runtime.credentials.get("smtp_port", "")
        try:
            smtp_port = int(smtp_port)
        except ValueError:
            return self.create_text_message("Invalid parameter smtp_port(should be int)")

        if not sender:
            return self.create_text_message("please input sender")
        if not email_rgx.match(sender):
            return self.create_text_message("Invalid parameter userid, the sender is not a mailbox")

        receivers_email = tool_parameters["send_to"]
        if not receivers_email:
            return self.create_text_message("please input receiver email")
        receivers_email = json.loads(receivers_email)
        for receiver in receivers_email:
            if not email_rgx.match(receiver):
                return self.create_text_message(
                    f"Invalid parameter receiver email, the receiver email({receiver}) is not a mailbox"
                )
        email_content = tool_parameters.get("email_content", "")

        if not email_content:
            return self.create_text_message("please input email content")

        subject = tool_parameters.get("subject", "")
        if not subject:
            return self.create_text_message("please input email subject")

        encrypt_method = self.runtime.credentials.get("encrypt_method", "")
        if not encrypt_method:
            return self.create_text_message("please input encrypt method")

        msg = {}
        for receiver in receivers_email:
            send_email_params = SendEmailToolParameters(
                smtp_server=smtp_server,
                smtp_port=smtp_port,
                email_account=sender,
                email_password=password,
                sender_to=receiver,
                subject=subject,
                email_content=email_content,
                encrypt_method=encrypt_method,
            )
            if send_mail(send_email_params):
                msg[receiver] = "send email success"
            else:
                msg[receiver] = "send email failed"
        return self.create_text_message(json.dumps(msg))
