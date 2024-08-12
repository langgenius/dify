from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.did.tools.talks import TalksTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class DIDProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            # Example validation using the D-ID talks tool
            TalksTool().fork_tool_runtime(
                runtime={"credentials": credentials}
            ).invoke(
                user_id='',
                tool_parameters={
                    "source_url": "https://www.d-id.com/wp-content/uploads/2023/11/Hero-image-1.png",
                    "text_input": "Hello, welcome to use D-ID tool in Dify",
                }
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
        