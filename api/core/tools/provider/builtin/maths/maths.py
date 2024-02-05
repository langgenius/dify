from typing import Any, Dict

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.maths.tools.eval_expression import EvaluateExpressionTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class MathsProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: Dict[str, Any]) -> None:
        try:
            EvaluateExpressionTool().invoke(
                user_id='',
                tool_parameters={
                    'expression': '1+(2+3)*4',
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
