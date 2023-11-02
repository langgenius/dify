from typing import Optional

from core.moderation.base import Moderation, ModerationException, ModerationOutputsResult, ModerationOuputsAction


class KeywordsModeration(Moderation):
    name: str = "keywords"

    @classmethod
    def validate_config(cls, tenant_id: str, config: dict) -> None:
        """
        Validate the incoming form config data.

        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        cls._validate_inputs_and_outputs_config(config, True)

        if not config.get("keywords"):
            raise ValueError("keywords is required")

    def moderation_for_inputs(self, inputs: dict, query: Optional[str] = None):
        if not self.config['inputs_configs']['enabled']:
            return

        if query:
            inputs['query__'] = query

        keywords_list = self.config['keywords'].split('\n')
        preset_response = self.config['inputs_configs']['preset_response']

        if self._is_violated(inputs, preset_response, keywords_list):
            raise ModerationException(preset_response)

    def moderation_for_outputs(self, text: str) -> ModerationOutputsResult:
        if not self.config['outputs_configs']['enabled']:
            return

        keywords_list = self.config['keywords'].split('\n')
        preset_response = self.config['outputs_configs']['preset_response']

        flagged = self._is_violated({'text': text}, preset_response, keywords_list)

        return ModerationOutputsResult(flagged=flagged, action=ModerationOuputsAction.DIRECT_OUTPUT, preset_response=preset_response)

    def _is_violated(self, inputs: dict, preset_response: str, keywords_list: list) -> bool:
        for value in inputs.values():
            if self._check_keywords_in_text(keywords_list, value):
                return True
        
        return False
                
    def _check_keywords_in_text(self, keywords_list, text):
        for keyword in keywords_list:
            if keyword in text:
                return True
        return False
