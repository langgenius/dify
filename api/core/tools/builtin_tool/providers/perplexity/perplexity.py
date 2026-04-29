from typing import Any

from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderCredentialValidationError


class PerplexityProvider(BuiltinToolProviderController):
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]) -> None:
        try:
            tool = self.get_tool("perplexity_search")
            if tool is None:
                raise ToolProviderCredentialValidationError("perplexity_search tool is not registered")
            forked = tool.fork_tool_runtime(
                runtime=ToolRuntime(tenant_id="", credentials=credentials),
            )
            for _ in forked.invoke(
                user_id=user_id,
                tool_parameters={"query": "ping", "max_results": 1},
            ):
                # Drain the generator so any HTTP error is surfaced.
                pass
        except ToolProviderCredentialValidationError:
            raise
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e)) from e
