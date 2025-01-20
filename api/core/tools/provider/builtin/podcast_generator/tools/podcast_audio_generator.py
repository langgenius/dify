import concurrent.futures
import io
import random
import warnings
from typing import Any, Optional, Union

from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter, ToolParameterOption
from core.tools.errors import ToolParameterValidationError
from core.tools.tool.builtin_tool import BuiltinTool
from services.model_provider_service import ModelProviderService

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from pydub import AudioSegment  # type: ignore


class PodcastAudioGeneratorTool(BuiltinTool):
    def _generate_audio_segment(
        self,
        model_instance: Any,
        line: str,
        voice: str,
        index: int,
    ) -> tuple[int, Union[bytes, str], Optional[bytes]]:
        try:
            audio_data = model_instance.invoke_tts(
                content_text=line.strip(),
                user="",
                tenant_id=self.runtime.tenant_id or "",
                voice=voice,
            )

            buffer = io.BytesIO()
            for chunk in audio_data:
                buffer.write(chunk)

            audio_bytes = buffer.getvalue()

            # Generate silence
            silence_buffer = io.BytesIO()
            silence = AudioSegment.silent(duration=int(random.uniform(0.1, 1.5) * 1000))
            silence.export(silence_buffer, format="wav")
            silence_bytes = silence_buffer.getvalue()

            return index, audio_bytes, silence_bytes
        except Exception as e:
            return index, f"Error generating audio: {str(e)}", None

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        script = tool_parameters.get("script", "")

        provider1, model1 = tool_parameters.get("host1_model", "").split("#")
        provider2, model2 = tool_parameters.get("host2_model", "").split("#")

        host1_voice = tool_parameters.get(f"host1_voice#{provider1}#{model1}")
        host2_voice = tool_parameters.get(f"host2_voice#{provider2}#{model2}")

        script_lines = [line for line in script.split("\n") if line.strip()]

        if not host1_voice or not host2_voice:
            raise ToolParameterValidationError("Host voices are required")

        model_manager = ModelManager()

        model1_instance = model_manager.get_model_instance(
            tenant_id=self.runtime.tenant_id or "",
            provider=provider1,
            model_type=ModelType.TTS,
            model=model1,
        )

        model2_instance = model_manager.get_model_instance(
            tenant_id=self.runtime.tenant_id or "",
            provider=provider2,
            model_type=ModelType.TTS,
            model=model2,
        )

        max_workers = 5
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = []
            for i, line in enumerate(script_lines):
                model_instance = model1_instance if i % 2 == 0 else model2_instance
                voice = host1_voice if i % 2 == 0 else host2_voice
                future = executor.submit(self._generate_audio_segment, model_instance, line, voice, i)
                futures.append(future)

            audio_segments: list[Any] = [None] * len(script_lines)
            for future in concurrent.futures.as_completed(futures):
                index, audio, silence = future.result()
                if isinstance(audio, str):
                    return self.create_text_message(audio)
                audio_segments[index] = (audio, silence)

        # Combine audio segments
        final_buffer = io.BytesIO()
        for i, (audio, silence) in enumerate(audio_segments):
            if audio:
                final_buffer.write(audio)
                if i < len(audio_segments) - 1 and silence:
                    final_buffer.write(silence)

        wav_bytes = final_buffer.getvalue()

        return [
            self.create_text_message("Audio generated successfully"),
            self.create_blob_message(
                blob=wav_bytes,
                meta={"mime_type": "audio/x-wav"},
                save_as=self.VariableKey.AUDIO,
            ),
        ]

    def get_available_models(self) -> list[tuple[str, str, list[Any]]]:
        if not self.runtime:
            raise ValueError("Runtime is required")
        model_provider_service = ModelProviderService()
        tid: str = self.runtime.tenant_id or ""
        models = model_provider_service.get_models_by_model_type(tenant_id=tid, model_type="tts")
        items = []
        for provider_model in models:
            provider = provider_model.provider
            for model in provider_model.models:
                voices = model.model_properties.get(ModelPropertyKey.VOICES, [])
                items.append((provider, model.model, voices))
        return items

    def get_runtime_parameters(self) -> list[ToolParameter]:
        parameters = []
        options = []

        for provider, model, voices in self.get_available_models():
            option = ToolParameterOption(value=f"{provider}#{model}", label=I18nObject(en_US=f"{model}({provider})"))
            options.append(option)

            # Host 1 voice parameter
            parameters.append(
                ToolParameter(
                    name=f"host1_voice#{provider}#{model}",
                    label=I18nObject(en_US=f"Host 1 Voice for {model}({provider})"),
                    human_description=I18nObject(en_US=f"Select Host 1's voice for {model} model"),
                    placeholder=I18nObject(en_US="Select a voice"),
                    type=ToolParameter.ToolParameterType.SELECT,
                    form=ToolParameter.ToolParameterForm.FORM,
                    options=[
                        ToolParameterOption(value=voice.get("mode"), label=I18nObject(en_US=voice.get("name")))
                        for voice in voices
                    ],
                )
            )

            # Host 2 voice parameter
            parameters.append(
                ToolParameter(
                    name=f"host2_voice#{provider}#{model}",
                    label=I18nObject(en_US=f"Host 2 Voice for {model}({provider})"),
                    human_description=I18nObject(en_US=f"Select Host 2's voice for {model} model"),
                    placeholder=I18nObject(en_US="Select a voice"),
                    type=ToolParameter.ToolParameterType.SELECT,
                    form=ToolParameter.ToolParameterForm.FORM,
                    options=[
                        ToolParameterOption(value=voice.get("mode"), label=I18nObject(en_US=voice.get("name")))
                        for voice in voices
                    ],
                )
            )

        # Add model selection parameters at the beginning
        parameters.insert(
            0,
            ToolParameter(
                name="host1_model",
                label=I18nObject(en_US="Host 1 Model"),
                human_description=I18nObject(
                    en_US="Select TTS model for Host 1. Configure models in Settings > Model Provider.",
                ),
                type=ToolParameter.ToolParameterType.SELECT,
                form=ToolParameter.ToolParameterForm.FORM,
                required=True,
                placeholder=I18nObject(en_US="Select a model"),
                options=options,
            ),
        )

        parameters.insert(
            1,
            ToolParameter(
                name="host2_model",
                label=I18nObject(en_US="Host 2 Model"),
                human_description=I18nObject(
                    en_US="Select TTS model for Host 2. Configure models in Settings > Model Provider.",
                ),
                type=ToolParameter.ToolParameterType.SELECT,
                form=ToolParameter.ToolParameterForm.FORM,
                required=True,
                placeholder=I18nObject(en_US="Select a model"),
                options=options,
            ),
        )

        return parameters
