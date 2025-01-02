import concurrent.futures
import io
import random
import warnings
from typing import Any, Literal, Optional, Union

import openai
from yarl import URL

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolParameterValidationError, ToolProviderCredentialValidationError
from core.tools.tool.builtin_tool import BuiltinTool

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from pydub import AudioSegment  # type: ignore


class PodcastAudioGeneratorTool(BuiltinTool):
    @staticmethod
    def _generate_silence(duration: float):
        # Generate silent WAV data using pydub
        silence = AudioSegment.silent(duration=int(duration * 1000))  # pydub uses milliseconds
        return silence

    @staticmethod
    def _generate_audio_segment(
        client: openai.OpenAI,
        line: str,
        voice: Literal["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
        index: int,
    ) -> tuple[int, Union[AudioSegment, str], Optional[AudioSegment]]:
        try:
            response = client.audio.speech.create(model="tts-1", voice=voice, input=line.strip(), response_format="wav")
            audio = AudioSegment.from_wav(io.BytesIO(response.content))
            silence_duration = random.uniform(0.1, 1.5)
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

        # Ensure runtime and credentials
        if not self.runtime or not self.runtime.credentials:
            raise ToolProviderCredentialValidationError("Tool runtime or credentials are missing")

        # Get OpenAI API key from credentials
        api_key = self.runtime.credentials.get("api_key")
        if not api_key:
            raise ToolProviderCredentialValidationError("OpenAI API key is missing")

        # Get OpenAI base URL
        openai_base_url = self.runtime.credentials.get("openai_base_url", None)
        openai_base_url = str(URL(openai_base_url) / "v1") if openai_base_url else None

        # Initialize OpenAI client
        client = openai.OpenAI(
            api_key=api_key,
            base_url=openai_base_url,
        )

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
        combined_audio = AudioSegment.empty()
        for i, (audio, silence) in enumerate(audio_segments):
            if audio:
                combined_audio += audio
                if i < len(audio_segments) - 1 and silence:
                    combined_audio += silence

        # Export the combined audio to a WAV file in memory
        buffer = io.BytesIO()
        combined_audio.export(buffer, format="wav")
        wav_bytes = buffer.getvalue()

        # Create a blob message with the combined audio
        return [
            self.create_text_message("Audio generated successfully"),
            self.create_blob_message(
                blob=wav_bytes,
                meta={"mime_type": "audio/x-wav"},
                save_as=self.VariableKey.AUDIO,
            ),
        ]
