import matplotlib.pyplot as plt

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.chart.tools.line import LinearChartTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController

# use a business theme
plt.style.use('seaborn-v0_8-darkgrid')

class ChartProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            LinearChartTool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "data": "1,3,5,7,9,2,4,6,8,10",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))