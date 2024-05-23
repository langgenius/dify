from core.tools.entities.values import ToolLabelEnum
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.devdocs.tools.searchDevDocs import SearchDevDocsTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class DevDocsProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            SearchDevDocsTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "doc": "python~3.12",
                    "topic": "library/code",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
    
    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.SEARCH, ToolLabelEnum.PRODUCTIVITY
        ]