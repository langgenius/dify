from typing import Any

from core.file import FileTransferMethod, FileType
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.vectorizer.tools.vectorizer import VectorizerTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from factories import file_factory


class VectorizerProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        mapping = {
            "transfer_method": FileTransferMethod.TOOL_FILE,
            "type": FileType.IMAGE,
            "id": "test_id",
            "url": "https://cloud.dify.ai/logo/logo-site.png",
        }
        test_img = file_factory.build_from_mapping(
            mapping=mapping,
            tenant_id="__test_123",
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
