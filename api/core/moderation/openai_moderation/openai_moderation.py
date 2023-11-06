import openai
import json

from core.helper.encrypter import decrypt_token
from core.moderation.base import Moderation, ModerationInputsResult, ModerationOutputsResult, ModerationAction
from core.model_providers.model_factory import ModelFactory


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

        openai_api_key = self._get_openai_api_key()
        moderation_result = openai.Moderation.create(input=list(inputs.values()), api_key=openai_api_key)

        for result in moderation_result.results:
            if result['flagged']:
                return True

        return False

    def _get_openai_api_key(self) -> str:
        model_class_obj = ModelFactory.get_moderation_model(self.tenant_id, "openai", "moderation")
        if not model_class_obj:
            raise ValueError("openai provider is not configured")

        encrypted_config = json.loads(model_class_obj.model_provider.provider.encrypted_config)

        return decrypt_token(self.tenant_id, encrypted_config['openai_api_key'])
