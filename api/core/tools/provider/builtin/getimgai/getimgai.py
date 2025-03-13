from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.getimgai.tools.text2image import Text2ImageTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class GetImgAIProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            # Example validation using the text2image tool
            Text2ImageTool().fork_tool_runtime(runtime={"credentials": credentials}).invoke(
                user_id="",
                tool_parameters={
                    "prompt": "A fire egg",
                    "response_format": "url",
                    "style": "photorealism",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
