from typing import Any, Union
from urllib.parse import parse_qs, urlparse

from youtube_transcript_api import YouTubeTranscriptApi

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class YouTubeTranscriptTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Invoke the YouTube transcript tool
        """
        try:
            # Extract parameters with defaults
            video_input = tool_parameters["video_id"]
            language = tool_parameters.get("language")
            output_format = tool_parameters.get("format", "text")
            preserve_formatting = tool_parameters.get("preserve_formatting", False)
            proxy = tool_parameters.get("proxy")
            cookies = tool_parameters.get("cookies")

            # Extract video ID from URL if needed
            video_id = self._extract_video_id(video_input)

            # Common kwargs for API calls
            kwargs = {"proxies": {"https": proxy} if proxy else None, "cookies": cookies}

            try:
                if language:
                    transcript_list = YouTubeTranscriptApi.list_transcripts(video_id, **kwargs)
                    try:
                        transcript = transcript_list.find_transcript([language])
                    except:
                        # If requested language not found, try translating from English
                        transcript = transcript_list.find_transcript(["en"]).translate(language)
                    transcript_data = transcript.fetch()
                else:
                    transcript_data = YouTubeTranscriptApi.get_transcript(
                        video_id, preserve_formatting=preserve_formatting, **kwargs
                    )

                # Format output
                formatter_class = {
                    "json": "JSONFormatter",
                    "pretty": "PrettyPrintFormatter",
                    "srt": "SRTFormatter",
                    "vtt": "WebVTTFormatter",
                }.get(output_format)

                if formatter_class:
                    from youtube_transcript_api import formatters

                    formatter = getattr(formatters, formatter_class)()
                    formatted_transcript = formatter.format_transcript(transcript_data)
                else:
                    formatted_transcript = " ".join(entry["text"] for entry in transcript_data)

                return self.create_text_message(text=formatted_transcript)

            except Exception as e:
                return self.create_text_message(text=f"Error getting transcript: {str(e)}")

        except Exception as e:
            return self.create_text_message(text=f"Error processing request: {str(e)}")

    def _extract_video_id(self, video_input: str) -> str:
        """
        Extract video ID from URL or return as-is if already an ID
        """
        if "youtube.com" in video_input or "youtu.be" in video_input:
            # Parse URL
            parsed_url = urlparse(video_input)
            if "youtube.com" in parsed_url.netloc:
                return parse_qs(parsed_url.query)["v"][0]
            else:  # youtu.be
                return parsed_url.path[1:]
        return video_input  # Assume it's already a video ID
