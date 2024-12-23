"""
Media Upload Tool for X (Twitter)
"""

import io
from typing import Any, Union

import tweepy

from core.file.enums import FileType
from core.file.file_manager import download
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class MediaUploadTool(BuiltinTool):
    def _get_twitter_api_v1(self, credentials: dict[str, str]) -> tweepy.API:
        """
        Get Twitter API v1.1 connection for media upload
        """
        auth = tweepy.OAuth1UserHandler(
            credentials["consumer_key"],
            credentials["consumer_secret"],
            credentials["access_token"],
            credentials["access_token_secret"],
        )
        return tweepy.API(auth)

    def _validate_file_type(self, file_type: FileType) -> bool:
        """
        Validate if the file type is supported by Twitter
        """
        return file_type in [FileType.IMAGE, FileType.VIDEO]

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Upload media to Twitter
        """
        try:
            # Get file from parameters
            media_file = tool_parameters.get("media_file")
            if not media_file:
                return ToolInvokeMessage(
                    message="No media file provided", status="error"
                )

            # Validate file type
            if not self._validate_file_type(media_file.type):
                return ToolInvokeMessage(
                    message=f"Unsupported file type: {media_file.type}. Supported types: JPG, PNG, GIF, MP4",
                    status="error",
                )

            # Get credentials and initialize API
            api = self._get_twitter_api_v1(self.runtime.credentials)

            try:
                # Download file content
                file_content = download(media_file)
                if not file_content:
                    return ToolInvokeMessage(
                        message="Failed to download media file", status="error"
                    )

                # Upload media
                media = api.media_upload(
                    filename=media_file.filename or "media",  # Use original filename if available
                    file=io.BytesIO(file_content)
                )

                # Set alt text if provided
                alt_text = tool_parameters.get("alt_text")
                if alt_text and media.media_id:
                    api.create_media_metadata(
                        media_id=media.media_id, alt_text=alt_text
                    )

                response_data = {
                    "media_id": str(media.media_id),
                    "type": media_file.type.value,
                    "size": media_file.size,
                    "filename": media_file.filename,
                    "alt_text": alt_text or None,
                }
                return self.create_json_message(response_data)

            except tweepy.TweepyException as te:
                return ToolInvokeMessage(
                    message=f"Twitter API error: {str(te)}", status="error"
                )

        except Exception as e:
            return ToolInvokeMessage(
                message=f"Error uploading media: {str(e)}", status="error"
            )
