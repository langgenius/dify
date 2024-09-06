from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.database.tools.sql import SQLTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class DatabaseProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            SQLTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    'sql_string': 'SELECT 1',
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(f"Database connection failed: {str(e)})")
