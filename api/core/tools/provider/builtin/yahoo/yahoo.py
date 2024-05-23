from core.tools.entities.values import ToolLabelEnum
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.yahoo.tools.ticker import YahooFinanceSearchTickerTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class YahooFinanceProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            YahooFinanceSearchTickerTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "ticker": "MSFT",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
    
    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.BUSINESS, ToolLabelEnum.FINANCE
        ]