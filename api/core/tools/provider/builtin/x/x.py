"""
X (Twitter) Tool Provider
"""
from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.x.tools.post_tweet import PostTweetTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class XProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        """
        Validate the credentials by attempting to post a test tweet
        """
        try:
            # Try to initialize client with credentials
            PostTweetTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "text": "Test tweet - Please ignore",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))