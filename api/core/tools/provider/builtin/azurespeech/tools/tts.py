import io
from typing import Any

import azure.cognitiveservices.speech as speechsdk

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class AzureTTSTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> list[ToolInvokeMessage]:
        speech_config = speechsdk.SpeechConfig(
            subscription=self.runtime.credentials["azure_speech_api_key"],
            region=self.runtime.credentials["azure_speech_region"],
        )
        speech_config.speech_synthesis_voice_name = tool_parameters.get(
            "speech_synthesis_voice_name", "en-US-AvaMultilingualNeural"
        )
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3
        )

        speech_synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=None)

        text: str = tool_parameters.get("text", "")
        speech_synthesis_result = speech_synthesizer.speak_text(text=text)

        if speech_synthesis_result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            stream = speechsdk.AudioDataStream(speech_synthesis_result)
            audio_data = io.BytesIO()
            buffer = bytes(1024)
            filled_size = stream.read_data(buffer)
            while filled_size > 0:
                audio_data.write(buffer[:filled_size])
                filled_size = stream.read_data(buffer)
            return [
                self.create_text_message("Audio generated successfully"),
                self.create_blob_message(
                    blob=audio_data.getvalue(),
                    meta={"mime_type": "audio/mpeg"},
                    save_as=self.VariableKey.AUDIO,
                ),
            ]
        elif speech_synthesis_result.reason == speechsdk.ResultReason.Canceled:
            cancellation_details = speech_synthesis_result.cancellation_details
            msg = "Speech synthesis canceled: {}\n".format(cancellation_details.reason)
            if cancellation_details.reason == speechsdk.CancellationReason.Error:
                if cancellation_details.error_details:
                    msg += "Error details: {}".format(cancellation_details.error_details)
            raise Exception(msg)
        return [self.create_text_message("Audio generation failed")]
