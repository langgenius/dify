"""API moderation with explicit, workspace-scoped persistence and outbound capabilities.

Form settings and runtime direction selection have distinct legacy contracts. Parse
only the selected runtime direction, and finish request validation before any I/O.
"""

import operator
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Literal, TypedDict

from pydantic import BaseModel, Field

from services.api_based_extension_application_service import APIBasedExtensionRecord


class APIModerationDirectionConfig(TypedDict, total=False):
    """Legacy enabled values use Python truthiness without boolean coercion."""

    enabled: object


class APIModerationConfig(TypedDict, total=False):
    """Stored API settings; an absent runtime ID still reaches the scoped lookup."""

    inputs_config: APIModerationDirectionConfig
    outputs_config: APIModerationDirectionConfig
    api_based_extension_id: object


class ModerationInputParams(BaseModel):
    app_id: str = ""
    inputs: dict[str, object] = Field(default_factory=dict)
    query: str = ""


class ModerationOutputParams(BaseModel):
    app_id: str = ""
    text: str


@dataclass(frozen=True, slots=True)
class DisabledDirection:
    """The selected direction requires no lookup or outbound work."""


@dataclass(frozen=True, slots=True)
class EnabledDirection:
    """The original lookup key, preserved without string conversion."""

    extension_id: object


def parse_direction(
    raw: Mapping[str, object] | None, direction: Literal["inputs_config", "outputs_config"]
) -> DisabledDirection | EnabledDirection:
    """Parse one runtime direction without inspecting the opposite direction.

    Missing config raises the existing ValueError. Native indexing errors and
    truthiness are retained for malformed selected values. This function does no I/O.
    """
    if raw is None:
        raise ValueError("The config is not set.")
    enabled: object = operator.itemgetter("enabled")(operator.itemgetter(direction)(raw))
    if enabled:
        return EnabledDirection(raw.get("api_based_extension_id", ""))
    return DisabledDirection()


def _parse_form(raw: Mapping[str, object]) -> EnabledDirection:
    """Parse form settings in their existing error order without any I/O."""
    inputs_config = raw.get("inputs_config")
    if not isinstance(inputs_config, dict):
        raise ValueError("inputs_config must be a dict")
    outputs_config = raw.get("outputs_config")
    if not isinstance(outputs_config, dict):
        raise ValueError("outputs_config must be a dict")
    if not inputs_config.get("enabled") and not outputs_config.get("enabled"):
        raise ValueError("At least one of inputs_config or outputs_config must be enabled")
    extension_id = raw.get("api_based_extension_id")
    if not extension_id:
        raise ValueError("api_based_extension_id is required")
    return EnabledDirection(extension_id)


class APIModerationService:
    """Own API settings and release persistence before decryption and requests.

    All capabilities are required. Lookup returns detached records and owns its
    short read session, including failure cleanup. All dependency errors propagate.
    """

    def __init__(
        self,
        *,
        find_extension: Callable[[str, object], APIBasedExtensionRecord | None],
        decrypt_key: Callable[[str, str], str],
        request_inputs: Callable[[str, str, ModerationInputParams], object],
        request_outputs: Callable[[str, str, ModerationOutputParams], object],
    ) -> None:
        self._find_extension = find_extension
        self._decrypt_key = decrypt_key
        self._request_inputs = request_inputs
        self._request_outputs = request_outputs

    def validate_config(self, tenant_id: str, raw: Mapping[str, object]) -> None:
        """Require valid form settings and an owned extension without outbound I/O.

        Invalid settings or absence raise the existing ValueError; lookup failures
        propagate after its session closes. Successful validation changes no state.
        """
        self._require_extension(tenant_id, _parse_form(raw).extension_id)

    def moderate_inputs(
        self,
        tenant_id: str,
        app_id: str,
        raw: Mapping[str, object] | None,
        inputs: dict[str, object],
        query: str = "",
    ) -> object:
        """Return the disabled result or raw input response for facade validation.

        Parse the selected direction and validate request parameters before lookup.
        Lookup, decrypt and request failures propagate unchanged in that order.
        """
        selection = parse_direction(raw, "inputs_config")
        if isinstance(selection, DisabledDirection):
            return {"flagged": False, "action": "direct_output", "preset_response": ""}
        params = ModerationInputParams(app_id=app_id, inputs=inputs, query=query)
        extension = self._require_extension(tenant_id, selection.extension_id)
        key = self._decrypt_key(tenant_id, extension.api_key)
        return self._request_inputs(extension.api_endpoint, key, params)

    def moderate_outputs(self, tenant_id: str, app_id: str, raw: Mapping[str, object] | None, text: str) -> object:
        """Return the disabled result or raw output response for facade validation.

        Parse the selected direction and validate request parameters before lookup.
        Lookup, decrypt and request failures propagate unchanged in that order.
        """
        selection = parse_direction(raw, "outputs_config")
        if isinstance(selection, DisabledDirection):
            return {"flagged": False, "action": "direct_output", "preset_response": ""}
        params = ModerationOutputParams(app_id=app_id, text=text)
        extension = self._require_extension(tenant_id, selection.extension_id)
        key = self._decrypt_key(tenant_id, extension.api_key)
        return self._request_outputs(extension.api_endpoint, key, params)

    def _require_extension(self, tenant_id: str, extension_id: object) -> APIBasedExtensionRecord:
        """Return an owned detached record or fail after the lookup session closes."""
        extension = self._find_extension(tenant_id, extension_id)
        if extension is None:
            raise ValueError("API-based Extension not found. Please check it again.")
        return extension
