from typing import Any

from core.file import File
from core.file.enums import FileTransferMethod, FileType
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.vectorizer.tools.vectorizer import VectorizerTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class VectorizerProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        test_img = File(
            tenant_id="__test_123",
            remote_url="https://cloud.dify.ai/logo/logo-site.png",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
        )
        try:
            VectorizerTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={"mode": "test", "image": test_img},
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
