from contextlib import AbstractContextManager, nullcontext
from typing import Any

from flask import current_app, has_app_context

from core.extension.extensible import ExtensionModule
from core.moderation.base import (
    AppModeration,
    Moderation,
    ModerationInputsResult,
    ModerationOutputsResult,
    ModerationRecord,
)
from extensions.ext_code_based_extension import code_based_extension


def get_app_moderation() -> AppModeration | None:
    """Return the injected policy or None for standalone kernel execution; malformed registrations fail closed."""
    if not has_app_context():
        return None
    moderation = current_app.extensions.get("app_moderation")
    if moderation is not None and not isinstance(moderation, AppModeration):
        raise TypeError("Invalid app moderation policy registration.")
    return moderation


def create_moderation_record(validated_data: dict[str, Any]) -> ModerationRecord | None:
    """Allocate one record from admitted generation data; snapshots never contain its process-local state."""
    moderation = get_app_moderation()
    app_config = validated_data.get("app_config")
    if moderation is None or app_config is None:
        return None
    return moderation.new_record(app_config.tenant_id)


def use_moderation_record(record: ModerationRecord | None) -> AbstractContextManager[None]:
    """Activate only the owning producer's record; independent calls retain their ordinary exception path."""
    return record.activate() if record is not None else nullcontext()


class ModerationFactory:
    __extension_instance: Moderation

    def __init__(self, name: str, app_id: str, tenant_id: str, config: dict[str, Any]):
        extension_class = code_based_extension.extension_class(ExtensionModule.MODERATION, name)
        self.__extension_instance = extension_class(app_id, tenant_id, config)

    @classmethod
    def validate_config(cls, name: str, tenant_id: str, config: dict[str, Any]):
        """
        Validate the incoming form config data.

        :param name: the name of extension
        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        extension_class = code_based_extension.extension_class(ExtensionModule.MODERATION, name)
        # FIXME: mypy error, try to fix it instead of using type: ignore
        extension_class.validate_config(tenant_id, config)  # type: ignore

    def moderation_for_inputs(self, inputs: dict[str, Any], query: str = "") -> ModerationInputsResult:
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
