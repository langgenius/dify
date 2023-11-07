from core.moderation.base import Moderation, ModerationInputsResult, ModerationOutputsResult


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
                    "api_keys": "123456"
                }

        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        pass

    def moderation_for_inputs(self, inputs: dict, query: str = "") -> ModerationInputsResult:
        """
        Moderation for inputs.

        :param inputs: user inputs
        :param query: the query of chat app
        :return: the moderation result
        """
        pass

    def moderation_for_outputs(self, text: str) -> ModerationOutputsResult:
        """
        Moderation for outputs.

        :param text: the text of chat app
        :return: the moderation result
        """
        pass
