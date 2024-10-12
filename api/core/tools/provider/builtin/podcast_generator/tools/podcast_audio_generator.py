import concurrent.futures
import random
import struct
from typing import Any, Literal, Optional, Union

import openai

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolParameterValidationError, ToolProviderCredentialValidationError
from core.tools.tool.builtin_tool import BuiltinTool


class PodcastAudioGeneratorTool(BuiltinTool):
    @staticmethod
    def _generate_silence(duration):
        # Generate silent MP3 data
        # This is a simplified version and may not work perfectly with all MP3 players
        # For production use, consider using a proper audio library or pre-generated silence MP3
        sample_rate = 44100
        num_samples = int(duration * sample_rate)
        silence_data = struct.pack("<" + "h" * num_samples, *([0] * num_samples))

        # Add a simple MP3 header (this is not a complete MP3 file, but might work for basic needs)
        mp3_header = b"\xff\xfb\x90\x04"  # A very basic MP3 header
        return mp3_header + silence_data

    @staticmethod
    def _generate_audio_segment(
        client: openai.OpenAI,
        line: str,
        voice: Literal["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
        index: int,
    ) -> tuple[int, Union[bytes, str], Optional[bytes]]:
        try:
            response = client.audio.speech.create(model="tts-1", voice=voice, input=line.strip())
            audio = response.content
            silence_duration = random.uniform(2, 5)
            silence = PodcastAudioGeneratorTool._generate_silence(silence_duration)
            return index, audio, silence
        except Exception as e:
            return index, f"Error generating audio: {str(e)}", None

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        # Extract parameters
        script = tool_parameters.get("script", "")
        host1_voice = tool_parameters.get("host1_voice")
        host2_voice = tool_parameters.get("host2_voice")

        # Split the script into lines
        script_lines = [line for line in script.split("\n") if line.strip()]

        # Ensure voices are provided
        if not host1_voice or not host2_voice:
            raise ToolParameterValidationError("Host voices are required")

        # Get OpenAI API key from credentials
        if not self.runtime or not self.runtime.credentials:
            raise ToolProviderCredentialValidationError("Tool runtime or credentials are missing")
        api_key = self.runtime.credentials.get("api_key")
        if not api_key:
            raise ToolProviderCredentialValidationError("OpenAI API key is missing")

        # Initialize OpenAI client
        client = openai.OpenAI(api_key=api_key)

        # Create a thread pool
        max_workers = 5
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = []
            for i, line in enumerate(script_lines):
                voice = host1_voice if i % 2 == 0 else host2_voice
                future = executor.submit(self._generate_audio_segment, client, line, voice, i)
                futures.append(future)

            # Collect results
            audio_segments: list[Any] = [None] * len(script_lines)
            for future in concurrent.futures.as_completed(futures):
                index, audio, silence = future.result()
                if isinstance(audio, str):  # Error occurred
                    return self.create_text_message(audio)
                audio_segments[index] = (audio, silence)

        # Combine audio segments in the correct order
        combined_audio = b""
        for i, (audio, silence) in enumerate(audio_segments):
            if audio:
                combined_audio += audio
                if i < len(audio_segments) - 1 and silence:
                    combined_audio += silence

        # Create a blob message with the combined audio
        return [
            self.create_text_message("Audio generated successfully"),
            self.create_blob_message(
                blob=combined_audio,
                meta={"mime_type": "audio/mpeg"},
                save_as=self.VariableKey.AUDIO,
            ),
        ]
