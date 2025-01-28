from core.tools.provider.builtin.url_to_base64.tools.url_to_base64_converter import URLToBase64Converter
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class URLToBase64Provider(BuiltinToolProviderController):
    @property
    def need_credentials(self) -> bool:
        """
        Whether the provider needs credentials
        """
        return False

    def _tools(self) -> list:
        return [
            URLToBase64Converter(),
        ]

    def _validate_credentials(self, credentials: dict) -> bool:
        """
        Validate the credentials.
        Our tool doesn't require any credentials, so we always return True.
        """
        return True
