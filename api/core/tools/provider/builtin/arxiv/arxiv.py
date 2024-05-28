from core.tools.entities.values import ToolLabelEnum
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.arxiv.tools.arxiv_search import ArxivSearchTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class ArxivProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            ArxivSearchTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "query": "John Doe",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
        
    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.SEARCH,
        ]