"""
Enhanced Post Tweet Tool with comprehensive Twitter functionality
"""

from typing import Any, Optional, Union

import tweepy

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class PostTweetTool(BuiltinTool):
    def _validate_tweet_text(self, text: Optional[str]) -> str:
        """Validate tweet text content"""
        if not text:
            raise ValueError("Tweet text cannot be empty")
        if len(text) > 280:
            raise ValueError("Tweet text exceeds 280 characters")
        return text

    def _parse_comma_separated_list(self, value: Optional[str]) -> list[str]:
        """Convert comma-separated string to list"""
        if not value:
            return []
        return [item.strip() for item in value.split(",") if item.strip()]

    def _validate_poll_options(
        self, options_str: Optional[str], duration: Optional[float]
    ) -> tuple[list[str], int]:
        """Validate poll options and duration"""
        options = self._parse_comma_separated_list(options_str)

        if not 2 <= len(options) <= 4:
            raise ValueError("Poll must have between 2 and 4 options")

        try:
            duration_int = (
                int(duration) if duration is not None else 1440
            )  # Default 24 hours
        except (ValueError, TypeError):
            raise ValueError("Poll duration must be a valid number")

        if not 1 <= duration_int <= 10080:  # 7 days in minutes
            raise ValueError("Poll duration must be between 1 minute and 7 days")

        return options, duration_int

    def _handle_media(self, media_ids_str: Optional[str]) -> list[str]:
        """Parse and validate media IDs"""
        if not media_ids_str:
            return []
        return self._parse_comma_separated_list(media_ids_str)

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Post a new tweet with enhanced functionality
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

            # Extract and validate parameters
            text = self._validate_tweet_text(tool_parameters.get("text"))
            reply_to_tweet_id = tool_parameters.get("reply_to_tweet_id")
            quote_tweet_id = tool_parameters.get("quote_tweet_id")

            # Handle poll options
            poll_options_str = tool_parameters.get("poll_options")
            poll_duration = tool_parameters.get("poll_duration_minutes")
            if poll_options_str:
                poll_options, poll_duration = self._validate_poll_options(
                    poll_options_str, poll_duration
                )
            else:
                poll_options, poll_duration = [], None

            # Handle media IDs
            media_ids = self._handle_media(tool_parameters.get("media_ids"))

            # Other parameters
            reply_settings = tool_parameters.get("reply_settings")
            for_super_followers = tool_parameters.get("for_super_followers_only", False)

            # Create tweet with all available options
            response = client.create_tweet(
                text=text,
                media_ids=media_ids or None,
                poll_duration_minutes=poll_duration,
                poll_options=poll_options or None,
                quote_tweet_id=quote_tweet_id,
                in_reply_to_tweet_id=reply_to_tweet_id,
                reply_settings=reply_settings,
                for_super_followers_only=for_super_followers,
                user_auth=True,
            )

            return ToolInvokeMessage(
                message=f"Successfully posted tweet with ID: {response.data['id']}",
                data={
                    "tweet_id": response.data["id"],
                    "text": text,
                    "media_count": len(media_ids) if media_ids else 0,
                    "has_poll": bool(poll_options),
                },
            )

        except ValueError as ve:
            return ToolInvokeMessage(
                message=f"Validation error: {str(ve)}", status="error"
            )
        except tweepy.TweepyException as te:
            return ToolInvokeMessage(
                message=f"Twitter API error: {str(te)}", status="error"
            )
        except Exception as e:
            return ToolInvokeMessage(
                message=f"Unexpected error: {str(e)}", status="error"
            )
