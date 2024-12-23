"""
Like Tweet Tool for liking/unliking tweets
"""

from typing import Any, Union

import tweepy

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class LikeTweetTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Like or unlike a tweet

        Args:
            user_id: The ID of the user making the request
            tool_parameters: Dictionary containing tweet_id and action parameters

        Returns:
            ToolInvokeMessage with the result of the operation
        """
        try:
            # Initialize client
            client = tweepy.Client(
                bearer_token=self.runtime.credentials["bearer_token"],
                consumer_key=self.runtime.credentials["consumer_key"],
                consumer_secret=self.runtime.credentials["consumer_secret"],
                access_token=self.runtime.credentials["access_token"],
                access_token_secret=self.runtime.credentials["access_token_secret"],
            )

            # Get and validate parameters
            tweet_id = tool_parameters.get("tweet_id")
            action = tool_parameters.get("action")

            if not tweet_id:
                return ToolInvokeMessage(message="Tweet ID is required", status="error")

            if action not in ["like", "unlike"]:
                return ToolInvokeMessage(
                    message="Invalid action. Must be either 'like' or 'unlike'",
                    status="error",
                )

            try:
                if action == "like":
                    response = client.like(tweet_id=tweet_id, user_auth=True)
                    message = f"Successfully liked tweet {tweet_id}"
                else:
                    response = client.unlike(tweet_id=tweet_id, user_auth=True)
                    message = f"Successfully unliked tweet {tweet_id}"

                return ToolInvokeMessage(
                    message=message,
                    data={"tweet_id": tweet_id, "action": action, "success": True},
                )

            except tweepy.TweepyException as te:
                return ToolInvokeMessage(
                    message=f"Twitter API error: {str(te)}", status="error"
                )

        except Exception as e:
            return ToolInvokeMessage(
                message=f"Error performing {action} action: {str(e)}", status="error"
            )
