from core.tools.entities.values import ToolLabelEnum
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.stackexchange.tools.searchStackExQuestions import SearchStackExQuestionsTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class StackExchangeProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            SearchStackExQuestionsTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "intitle": "Test",
                    "sort": "relevance",  
                    "order": "desc",
                    "site": "stackoverflow",
                    "accepted": True,
                    "pagesize": 1
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
        
    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.SEARCH, ToolLabelEnum.UTILITIES
        ]