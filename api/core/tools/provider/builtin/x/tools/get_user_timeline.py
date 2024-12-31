"""
Get User Timeline Tool for X (Twitter)
"""

from datetime import datetime
from typing import Any, Union

import tweepy

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GetUserTimelineTool(BuiltinTool):
    def _validate_max_results(self, max_results: str) -> int:
        """
        Validate and normalize max_results parameter
        """
        try:
            max_results = int(max_results)
            if max_results < 5:
                return 5
            elif max_results > 100:
                return 100
            return max_results
        except (TypeError, ValueError):
            return 10

    def _convert_tweet_to_dict(self, tweet: tweepy.Tweet) -> dict[str, Any]:
        """
        Convert tweet object to dictionary, handling datetime serialization
        """
        tweet_dict = {}
        # Convert Tweet object to dictionary
        for field in tweet.data:
            value = tweet.data[field]
            # Skip None values
            if value is None:
                continue
            # Handle datetime fields
            if field == "created_at" and isinstance(value, datetime):
                tweet_dict[field] = value.isoformat()
            else:
                tweet_dict[field] = value

        # Handle media attachments
        if "attachments" in tweet_dict and "media_keys" in tweet_dict["attachments"]:
            media_keys = tweet_dict["attachments"]["media_keys"]
            tweet_dict["media"] = []

            for media_key in media_keys:
                media_info = {"media_key": media_key, "type": None, "url": None}
                tweet_dict["media"].append(media_info)

        return tweet_dict

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Get user timeline from Twitter
        """
        try:
            username = tool_parameters.get("username", "").strip().lstrip("@")
            if not username:
                return ToolInvokeMessage(message="Username is required", status="error")

            max_results = self._validate_max_results(tool_parameters.get("max_results"))

            client = tweepy.Client(
                bearer_token=self.runtime.credentials["bearer_token"],
                consumer_key=self.runtime.credentials["consumer_key"],
                consumer_secret=self.runtime.credentials["consumer_secret"],
                access_token=self.runtime.credentials["access_token"],
                access_token_secret=self.runtime.credentials["access_token_secret"],
            )

            tweet_fields = [
                "attachments",
                "author_id",
                "context_annotations",
                "conversation_id",
                "created_at",
                "entities",
                "geo",
                "id",
                "in_reply_to_user_id",
                "lang",
                "public_metrics",
                "possibly_sensitive",
                "referenced_tweets",
                "reply_settings",
                "source",
                "text",
                "withheld",
            ]

            user_fields = [
                "created_at",
                "description",
                "entities",
                "id",
                "location",
                "name",
                "pinned_tweet_id",
                "profile_image_url",
                "protected",
                "public_metrics",
                "url",
                "username",
                "verified",
                "withheld",
            ]

            media_fields = [
                "duration_ms",
                "height",
                "media_key",
                "preview_image_url",
                "type",
                "url",
                "width",
                "public_metrics",
                "alt_text",
            ]

            try:
                # Get user ID from username
                user_response = client.get_user(
                    username=username,
                )
                if not user_response.data:
                    return ToolInvokeMessage(message=f"User @{username} not found", status="error")

                user_data = user_response.data
                # Get user's tweets
                tweets_response = client.get_users_tweets(
                    id=user_data.id,
                    max_results=max_results,
                    tweet_fields=tweet_fields,
                    user_fields=user_fields,
                    media_fields=media_fields,
                    exclude=["retweets"],  # Exclude retweets to get more original content
                )

                print(tweets_response.data)
                if not tweets_response.data:
                    return ToolInvokeMessage(
                        message=f"No tweets found for user @{username}",
                        status="success",
                    )

                tweets = []
                for tweet in tweets_response.data:
                    tweet_dict = self._convert_tweet_to_dict(tweet)
                    tweets.append(tweet_dict)

                # Convert user data
                user_dict = {}
                for field in user_data:
                    value = user_data[field]
                    if value is None:
                        continue
                    if field == "created_at" and isinstance(value, datetime):
                        user_dict[field] = value.isoformat()
                    else:
                        user_dict[field] = value

                return self.create_json_message(
                    {
                        "message": f"Retrieved {len(tweets)} tweets from user @{username}",
                        "user": user_dict,
                        "tweets": tweets,
                    }
                )
            except tweepy.TweepyException as te:
                return ToolInvokeMessage(message=f"Twitter API error: {str(te)}", status="error")

        except Exception as e:
            return ToolInvokeMessage(message=f"Error retrieving user timeline: {str(e)}", status="error")
