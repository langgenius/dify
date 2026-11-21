from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from flask import current_app, has_app_context
from pydantic import JsonValue

from core.extension.extensible import ExtensionModule
from core.moderation.base import (
    AppModeration,
    Moderation,
    ModerationInputsResult,
    ModerationOutputsResult,
)
from domain.moderation.api_config import DisabledDirection, EnabledDirection, parse_direction, parse_form
from extensions.ext_code_based_extension import code_based_extension

API_MODERATION_EXTENSION_KEY = "api_moderation"


@dataclass(frozen=True, slots=True)
class APIModerationCallbacks:
    """Application operations bound by the composition root to one Flask app.

    Configuration is parsed before dispatch. Operations receive an admitted
    selection, never raw settings, and preserve disabled payload bypass and I/O order.
    """

    validate_config: Callable[[str, EnabledDirection], None]
    moderate_inputs: Callable[[str, str, DisabledDirection | EnabledDirection, dict[str, object], str], JsonValue]
    moderate_outputs: Callable[[str, str, DisabledDirection | EnabledDirection, str], JsonValue]


@dataclass(slots=True)
class _APIModeration:
    """Raw settings remain unparsed until the selected operation runs.

    Callbacks are cached by the first operation, so construction needs no Flask context.
    """

    app_id: str
    tenant_id: str
    config: Mapping[str, object] | None
    callbacks: APIModerationCallbacks | None = None


def _api_callbacks() -> APIModerationCallbacks:
    """Require the current app's root-bound bundle without importing its services."""
    callbacks = current_app.extensions[API_MODERATION_EXTENSION_KEY]
    if not isinstance(callbacks, APIModerationCallbacks):
        raise TypeError("API moderation callbacks are not configured")
    return callbacks


def _moderation_class(name: str) -> type[Moderation]:
    """Resolve a scanned provider and require the existing moderation contract."""
    extension_class = code_based_extension.extension_class(ExtensionModule.MODERATION, name)
    if not issubclass(extension_class, Moderation):
        raise TypeError(f"Extension {name} is not a moderation provider")
    return extension_class


def get_app_moderation() -> AppModeration | None:
    """Return the injected policy or None for standalone kernel execution; malformed registrations fail closed."""
    if not has_app_context():
        return None
    moderation = current_app.extensions.get("app_moderation")
    if moderation is not None and not isinstance(moderation, AppModeration):
        raise TypeError("Invalid app moderation policy registration.")
    return moderation


class ModerationFactory:
    __extension_instance: Moderation | _APIModeration

    def __init__(self, name: str, app_id: str, tenant_id: str, config: dict[str, Any] | None):
        """Accept raw settings without I/O; API service binding waits for an operation."""
        if name == "api":
            self.__extension_instance = _APIModeration(app_id, tenant_id, config)
        else:
            self.__extension_instance = _moderation_class(name)(app_id, tenant_id, config)

    @classmethod
    def validate_config(cls, name: str, tenant_id: str, config: dict[str, Any]):
        """
        Validate the incoming form config data.

        API validation requires an initialized Flask app context. Binding and
        service failures propagate without changing settings or making outbound calls.

        :param name: the name of extension
        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        if name == "api":
            callbacks = _api_callbacks()
            callbacks.validate_config(tenant_id, parse_form(config))
        else:
            _moderation_class(name).validate_config(tenant_id, config)

    def moderation_for_inputs(self, inputs: dict[str, Any], query: str = "") -> ModerationInputsResult:
        """
        Moderation for inputs.
        After the user inputs, this method will be called to perform sensitive content review
        on the user inputs and return the processed results.

        The first API operation requires an initialized Flask app context.
        Binding, service, and response-validation failures propagate unchanged.

        :param inputs: user inputs
        :param query: query string (required in chat app)
        :return:
        """
        provider = self.__extension_instance
        if isinstance(provider, _APIModeration):
            if provider.callbacks is None:
                provider.callbacks = _api_callbacks()
            result = provider.callbacks.moderate_inputs(
                provider.tenant_id, provider.app_id, parse_direction(provider.config, "inputs_config"), inputs, query
            )
            return ModerationInputsResult.model_validate(result)
        return provider.moderation_for_inputs(inputs, query)

    def moderation_for_outputs(self, text: str) -> ModerationOutputsResult:
        """
        Moderation for outputs.
        When LLM outputs content, the front end will pass the output content (may be segmented)
        to this method for sensitive content review, and the output content will be shielded if the review fails.

        The first API operation requires an initialized Flask app context.
        Binding, service, and response-validation failures propagate unchanged.

        :param text: LLM output content
        :return:
        """
        provider = self.__extension_instance
        if isinstance(provider, _APIModeration):
            if provider.callbacks is None:
                provider.callbacks = _api_callbacks()
            result = provider.callbacks.moderate_outputs(
                provider.tenant_id, provider.app_id, parse_direction(provider.config, "outputs_config"), text
            )
            return ModerationOutputsResult.model_validate(result)
        return provider.moderation_for_outputs(text)
