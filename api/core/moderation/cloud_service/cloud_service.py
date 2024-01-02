from core.moderation.base import Moderation, ModerationAction, ModerationInputsResult, ModerationOutputsResult


class CloudServiceModeration(Moderation):
    """
    The name of custom type must be unique, keep the same with directory and file name.
    """
    name: str = "cloud_service"

    @classmethod
    def validate_config(cls, tenant_id: str, config: dict) -> None:
        """
        schema.json validation. It will be called when user save the config.

        Example:
            .. code-block:: python
                config = {
                    "cloud_provider": "GoogleCloud",
                    "api_endpoint": "https://api.example.com",
                    "api_keys": "123456",
                    "inputs_config": {
                        "enabled": True,
                        "preset_response": "Your content violates our usage policy. Please revise and try again."
                    },
                    "outputs_config": {
                        "enabled": True,
                        "preset_response": "Your content violates our usage policy. Please revise and try again."
                    }
                }

        :param tenant_id: the id of workspace
        :param config: the variables of form config
        :return:
        """

        cls._validate_inputs_and_outputs_config(config, True)

        if not config.get("cloud_provider"):
            raise ValueError("cloud_provider is required")

        if not config.get("api_endpoint"):
            raise ValueError("api_endpoint is required")

        if not config.get("api_keys"):
            raise ValueError("api_keys is required")

    def moderation_for_inputs(self, inputs: dict, query: str = "") -> ModerationInputsResult:
        """
        Moderation for inputs.

        :param inputs: user inputs
        :param query: the query of chat app, there is empty if is completion app
        :return: the moderation result
        """
        flagged = False
        preset_response = ""

        if self.config['inputs_config']['enabled']:
            preset_response = self.config['inputs_config']['preset_response']

            if query:
                inputs['query__'] = query
            flagged = self._is_violated(inputs)

        # return ModerationInputsResult(flagged=flagged, action=ModerationAction.OVERRIDED, inputs=inputs, query=query)
        return ModerationInputsResult(flagged=flagged, action=ModerationAction.DIRECT_OUTPUT, preset_response=preset_response)

    def moderation_for_outputs(self, text: str) -> ModerationOutputsResult:
        """
        Moderation for outputs.

        :param text: the text of LLM response
        :return: the moderation result
        """
        flagged = False
        preset_response = ""

        if self.config['outputs_config']['enabled']:
            preset_response = self.config['outputs_config']['preset_response']

            flagged = self._is_violated({'text': text})

        # return ModerationOutputsResult(flagged=flagged, action=ModerationAction.OVERRIDED, text=text)
        return ModerationOutputsResult(flagged=flagged, action=ModerationAction.DIRECT_OUTPUT, preset_response=preset_response)

    def _is_violated(self, inputs: dict):
        """
        The main logic of moderation.

        :param inputs:
        :return: the moderation result
        """
        return False
