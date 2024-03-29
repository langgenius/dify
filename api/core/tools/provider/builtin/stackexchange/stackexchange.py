from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.stackexchange.tools.searchStackExQuestions import SearchStackExQuestionsTool
from core.tools.provider.builtin.stackexchange.tools.fetchAnsByStackExQuesID import FetchAnsByStackExQuesIDTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class StackExchangeProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            SearchStackExQuestionsTool().fork_tool_runtime(
                meta={
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
            FetchAnsByStackExQuesIDTool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "id": "30375",
                    "site": "tex",
                    "filter": "!nNPvSNdWme",
                    "order": "desc",
                    "sort": "votes",
                    "pagesize": 1,
                    "page": 1
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))