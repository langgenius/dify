from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.moderation.base import Moderation, ModerationAction, ModerationInputsResult, ModerationOutputsResult


class OpenAIModeration(Moderation):
    name: str = "openai_moderation"

    @classmethod
    def validate_config(cls, tenant_id: str, config: dict) -> None:
        """
        Validate the incoming form config data.

        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        cls._validate_inputs_and_outputs_config(config, True)

    def moderation_for_inputs(self, inputs: dict, query: str = "") -> ModerationInputsResult:
        flagged = False
        preset_response = ""

        if self.config['inputs_config']['enabled']:
            preset_response = self.config['inputs_config']['preset_response']

            if query:
                inputs['query__'] = query
            flagged = self._is_violated(inputs)

        return ModerationInputsResult(flagged=flagged, action=ModerationAction.DIRECT_OUTPUT, preset_response=preset_response)

    def moderation_for_outputs(self, text: str) -> ModerationOutputsResult:
        flagged = False
        preset_response = ""

        if self.config['outputs_config']['enabled']:
            flagged = self._is_violated({'text': text})
            preset_response = self.config['outputs_config']['preset_response']

        return ModerationOutputsResult(flagged=flagged, action=ModerationAction.DIRECT_OUTPUT, preset_response=preset_response)

    def _is_violated(self, inputs: dict):
        text = '\n'.join(str(inputs.values()))
        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=self.tenant_id,
            provider="openai",
            model_type=ModelType.MODERATION,
            model="text-moderation-stable"
        )

        openai_moderation = model_instance.invoke_moderation(
            text=text
        )

        return openai_moderation
