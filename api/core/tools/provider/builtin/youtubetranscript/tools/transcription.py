import json
import re
from typing import Any, Union

from youtube_transcript_api import NoTranscriptFound, YouTubeTranscriptApi
from youtube_transcript_api.formatters import JSONFormatter

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class YoutubeVideoTranscriptionTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) \
          -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        link = tool_parameters.get('link', '')
        if not link:
            return self.create_text_message('Please input YouTube video link')
        
        max_output_length = tool_parameters.get('max_output_length', 1000)

        video_id = self.get_youtube_video_id(link)
        if not video_id:
            return self.create_text_message('Invalid YouTube video link')
        
        transcript_json = self.get_transcription(video_id)
        if not transcript_json:
            return self.create_text_message('Transcript not found for this video')
        
        transcription_text = self.convert_json_to_text(transcript_json)

        if len(transcription_text) > max_output_length:
            transcription_text = self.cut_transcription_text(transcription_text, max_output_length)

        return self.create_text_message(transcription_text)
    
    def get_transcription(self, video_id):
        """
            Get the transcript of a YouTube video.
        """
        try:
            transcript = YouTubeTranscriptApi.get_transcript(video_id)
            formatter = JSONFormatter()
            json_formatted = formatter.format_transcript(transcript)

            return json_formatted

        except NoTranscriptFound:
            return "[{\"text\": \"Transcript not found for this video.\"}]"
        except Exception as e:
            return "[{\"text\": \"Error getting the video's transcript.\"}]"
        
    def get_youtube_video_id(self, url):
        """
            Extracts the video ID from a YouTube video URL.
        """
        pattern = r'(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?([^&\s]+)'
        match = re.match(pattern, url)
        
        if match:
            return match.group(1)
        
        return None
    
    def convert_json_to_text(self, json_string):
        """
            Convert a JSON string of transcript data into a single text string.
        """
        data = json.loads(json_string)
        text = ""

        for item in data:
            text += item['text'] + " "

        return text
    
    def cut_transcription_text(self, transcription_text, max_output_length):
        """
            Cut the transcription text to the maximum output length.
        """
        return transcription_text[:max_output_length]