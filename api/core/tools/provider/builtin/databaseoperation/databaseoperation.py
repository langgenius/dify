from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.databaseoperation.tools.databasecontrol_sqlexec import DatabaseControlSqlExecTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class DatabaseOperationProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            DatabaseControlSqlExecTool().fork_tool_runtime(runtime={})
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
