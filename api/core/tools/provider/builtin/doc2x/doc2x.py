from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.doc2x.tools.doc2x_img_ocr import Doc2xImgOCRTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class Doc2Xrovider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            Doc2xImgOCRTool().fork_tool_runtime(
                runtime={
                    'credentials': credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    'image_id': '__test_123',
                    'img_correction': False,
                    'formula': False,
                    'get_limit': True,
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
