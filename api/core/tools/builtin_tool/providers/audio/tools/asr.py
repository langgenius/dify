import io
from collections.abc import Generator
from typing import Any

from core.file.enums import FileType
from core.file.file_manager import download
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.plugin.entities.parameters import PluginParameterOption
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter
from services.model_provider_service import ModelProviderService


class ASRTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        file = tool_parameters.get("audio_file")
        if file.type != FileType.AUDIO:  # type: ignore
            yield self.create_text_message("not a valid audio file")
            return
        audio_binary = io.BytesIO(download(file))  # type: ignore
        audio_binary.name = "temp.mp3"
        provider, model = tool_parameters.get("model").split("#")  # type: ignore
        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=self.runtime.tenant_id,
            provider=provider,
            model_type=ModelType.SPEECH2TEXT,
            model=model,
        )
        text = model_instance.invoke_speech2text(
            file=audio_binary,
            user=user_id,
        )
        yield self.create_text_message(text)

    def get_available_models(self) -> list[tuple[str, str]]:
        model_provider_service = ModelProviderService()
        models = model_provider_service.get_models_by_model_type(
            tenant_id=self.runtime.tenant_id, model_type="speech2text"
        )
        items = []
        for provider_model in models:
            provider = provider_model.provider
            for model in provider_model.models:
                items.append((provider, model.model))
        return items

    def get_runtime_parameters(
        self,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> list[ToolParameter]:
        parameters = []

        options = []
        for provider, model in self.get_available_models():
            option = PluginParameterOption(value=f"{provider}#{model}", label=I18nObject(en_US=f"{model}({provider})"))
            options.append(option)

        parameters.append(
            ToolParameter(
                name="model",
                label=I18nObject(en_US="Model", zh_Hans="Model"),
                human_description=I18nObject(
                    en_US="All available ASR models. You can config model in the Model Provider of Settings.",
                    zh_Hans="所有可用的 ASR 模型。你可以在设置中的模型供应商里配置。",
                ),
                type=ToolParameter.ToolParameterType.SELECT,
                form=ToolParameter.ToolParameterForm.FORM,
                required=True,
                options=options,
            )
        )
        return parameters
