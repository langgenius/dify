from core.extension.extensible import ExtensionModule
from core.moderation.base import Moderation, ModerationInputsResult, ModerationOutputsResult
from extensions.ext_code_based_extension import code_based_extension


class ModerationFactory:
    __extension_instance: Moderation

    def __init__(self, name: str, app_id: str, tenant_id: str, config: dict) -> None:
        extension_class = code_based_extension.extension_class(ExtensionModule.MODERATION, name)
        self.__extension_instance = extension_class(app_id, tenant_id, config)

    @classmethod
    def validate_config(cls, name: str, tenant_id: str, config: dict) -> None:
        """
        Validate the incoming form config data.

        :param name: the name of extension
        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        code_based_extension.validate_form_schema(ExtensionModule.MODERATION, name, config)
        extension_class = code_based_extension.extension_class(ExtensionModule.MODERATION, name)
        extension_class.validate_config(tenant_id, config)

    def moderation_for_inputs(self, inputs: dict, query: str = "") -> ModerationInputsResult:
        """
        Moderation for inputs.
        After the user inputs, this method will be called to perform sensitive content review
        on the user inputs and return the processed results.

        :param inputs: user inputs
        :param query: query string (required in chat app)
        :return:
        """
        return self.__extension_instance.moderation_for_inputs(inputs, query)

    def moderation_for_outputs(self, text: str) -> ModerationOutputsResult:
        """
        Moderation for outputs.
        When LLM outputs content, the front end will pass the output content (may be segmented)
        to this method for sensitive content review, and the output content will be shielded if the review fails.

        :param text: LLM output content
        :return:
        """
        return self.__extension_instance.moderation_for_outputs(text)
