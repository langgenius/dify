from core.tools.provider.builtin.email.tools.send_mail import SendMailTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class SmtpProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        SendMailTool()
