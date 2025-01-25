import io
from typing import Any

from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter, ToolParameterOption
from core.tools.tool.builtin_tool import BuiltinTool
from services.model_provider_service import ModelProviderService


class TTSTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> list[ToolInvokeMessage]:
        provider, model = tool_parameters.get("model", "").split("#")
        voice = tool_parameters.get(f"voice#{provider}#{model}", "")
        model_manager = ModelManager()
        if not self.runtime:
            raise ValueError("Runtime is required")
        model_instance = model_manager.get_model_instance(
            tenant_id=self.runtime.tenant_id or "",
            provider=provider,
            model_type=ModelType.TTS,
            model=model,
        )
        tts = model_instance.invoke_tts(
            content_text=tool_parameters.get("text", ""),
            user=user_id,
            tenant_id=self.runtime.tenant_id or "",
            voice=voice,
        )
        buffer = io.BytesIO()
        for chunk in tts:
            buffer.write(chunk)

        wav_bytes = buffer.getvalue()
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
            parameters.append(
                ToolParameter(
                    name=f"voice#{provider}#{model}",
                    label=I18nObject(en_US=f"Voice of {model}({provider})"),
                    human_description=I18nObject(en_US=f"Select a voice for {model} model"),
                    placeholder=I18nObject(en_US="Select a voice"),
                    type=ToolParameter.ToolParameterType.SELECT,
                    form=ToolParameter.ToolParameterForm.FORM,
                    options=[
                        ToolParameterOption(value=voice.get("mode"), label=I18nObject(en_US=voice.get("name")))
                        for voice in voices
                    ],
                )
            )

        parameters.insert(
            0,
            ToolParameter(
                name="model",
                label=I18nObject(en_US="Model", zh_Hans="Model"),
                human_description=I18nObject(
                    en_US="All available TTS models. You can config model in the Model Provider of Settings.",
                    zh_Hans="所有可用的 TTS 模型。你可以在设置中的模型供应商里配置。",
                ),
                type=ToolParameter.ToolParameterType.SELECT,
                form=ToolParameter.ToolParameterForm.FORM,
                required=True,
                placeholder=I18nObject(en_US="Select a model", zh_Hans="选择模型"),
                options=options,
            ),
        )
        return parameters
