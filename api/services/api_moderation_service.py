"""API moderation with explicit, workspace-scoped persistence and outbound capabilities.

Complete form settings require both directions and a string extension ID. Runtime
selection validates only its direction, and enabled requests are validated before I/O.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Annotated, Literal, TypedDict

from pydantic import BaseModel, Field, InstanceOf, JsonValue, TypeAdapter

from graphon.file import File
from services.api_based_extension_application_service import APIBasedExtensionRecord


class APIModerationDirectionConfig(TypedDict):
    """A configured direction explicitly chooses a boolean enable state."""

    enabled: bool


class APIModerationConfig(TypedDict):
    """Complete authored settings; partial runtime values enter through raw mappings."""

    inputs_config: APIModerationDirectionConfig
    outputs_config: APIModerationDirectionConfig
    api_based_extension_id: str


_direction_adapter = TypeAdapter(APIModerationDirectionConfig)
_extension_id_adapter = TypeAdapter(Annotated[str, Field(strict=True, min_length=1)])


class ModerationInputParams(BaseModel):
    """Keep JSON mappings as JSON and admit file variants only as existing File instances."""

    app_id: str = ""
    inputs: dict[str, JsonValue | InstanceOf[File] | list[InstanceOf[File]]] = Field(default_factory=dict)
    query: str = ""


class ModerationOutputParams(BaseModel):
    app_id: str = ""
    text: str


@dataclass(frozen=True, slots=True)
class DisabledDirection:
    """The selected direction requires no lookup or outbound work."""


@dataclass(frozen=True, slots=True)
class EnabledDirection:
    """The selected enabled direction has a validated, nonempty string lookup key."""

    extension_id: str


def parse_direction(
    raw: Mapping[str, object] | None, direction: Literal["inputs_config", "outputs_config"]
) -> DisabledDirection | EnabledDirection:
    """Parse one runtime direction without inspecting the opposite direction.

    Missing config raises ValueError; malformed selected settings raise
    ValidationError. Disabled settings return before ID validation. No I/O occurs.
    """
    if raw is None:
        raise ValueError("The config is not set.")
    selected = _direction_adapter.validate_python(raw.get(direction), strict=True)
    if not selected["enabled"]:
        return DisabledDirection()
    return EnabledDirection(_extension_id_adapter.validate_python(raw.get("api_based_extension_id")))


def _parse_form(raw: Mapping[str, object]) -> EnabledDirection:
    """Validate both directions, require one enabled, then parse the ID without I/O.

    Malformed settings raise ValidationError. Two disabled directions retain their
    business error before ID validation, including when the ID is absent or invalid.
    """
    inputs_config = _direction_adapter.validate_python(raw.get("inputs_config"), strict=True)
    outputs_config = _direction_adapter.validate_python(raw.get("outputs_config"), strict=True)
    if not inputs_config["enabled"] and not outputs_config["enabled"]:
        raise ValueError("At least one of inputs_config or outputs_config must be enabled")
    return EnabledDirection(_extension_id_adapter.validate_python(raw.get("api_based_extension_id")))


class APIModerationService:
    """Own API settings and release persistence before decryption and requests.

    All capabilities are required. Lookup returns detached records and owns its
    short read session, including failure cleanup. All dependency errors propagate.
    """

    def __init__(
        self,
        *,
        find_extension: Callable[[str, str], APIBasedExtensionRecord | None],
        decrypt_key: Callable[[str, str], str],
        request_inputs: Callable[[str, str, ModerationInputParams], JsonValue],
        request_outputs: Callable[[str, str, ModerationOutputParams], JsonValue],
    ) -> None:
        """Store all four required capabilities without performing I/O."""
        self._find_extension = find_extension
        self._decrypt_key = decrypt_key
        self._request_inputs = request_inputs
        self._request_outputs = request_outputs

    def validate_config(self, tenant_id: str, raw: Mapping[str, object]) -> None:
        """Require valid form settings and an owned extension without outbound I/O.

        Malformed settings raise ValidationError; both-disabled settings or an
        absent owned row raise ValueError. Lookup failures propagate after session
        cleanup. Successful validation changes no state.
        """
        self._require_extension(tenant_id, _parse_form(raw).extension_id)

    def moderate_inputs(
        self,
        tenant_id: str,
        app_id: str,
        raw: Mapping[str, object] | None,
        inputs: Mapping[str, object],
        query: str = "",
    ) -> JsonValue:
        """Return the disabled result or raw input response for facade validation.

        Raw mappings admit dynamic variable names with JSON, File or list[File]
        values. Enabled settings and payloads must validate before lookup. Disabled
        settings skip payload validation and all I/O. Dependency failures propagate.
        """
        selection = parse_direction(raw, "inputs_config")
        if isinstance(selection, DisabledDirection):
            return {"flagged": False, "action": "direct_output", "preset_response": ""}
        params = ModerationInputParams.model_validate({"app_id": app_id, "inputs": inputs, "query": query})
        extension = self._require_extension(tenant_id, selection.extension_id)
        key = self._decrypt_key(tenant_id, extension.api_key)
        return self._request_inputs(extension.api_endpoint, key, params)

    def moderate_outputs(self, tenant_id: str, app_id: str, raw: Mapping[str, object] | None, text: str) -> JsonValue:
        """Return the disabled result or raw output response for facade validation.

        Enabled settings and request parameters validate before lookup. Disabled
        settings skip payload validation and all I/O. Lookup, decrypt and request
        failures propagate unchanged in that order.
        """
        selection = parse_direction(raw, "outputs_config")
        if isinstance(selection, DisabledDirection):
            return {"flagged": False, "action": "direct_output", "preset_response": ""}
        params = ModerationOutputParams(app_id=app_id, text=text)
        extension = self._require_extension(tenant_id, selection.extension_id)
        key = self._decrypt_key(tenant_id, extension.api_key)
        return self._request_outputs(extension.api_endpoint, key, params)

    def _require_extension(self, tenant_id: str, extension_id: str) -> APIBasedExtensionRecord:
        """Look up string tenant/extension IDs without outbound work.

        Return the owned detached record after session cleanup. Missing records
        raise ValueError; lookup failures propagate unchanged after cleanup.
        """
        extension = self._find_extension(tenant_id, extension_id)
        if extension is None:
            raise ValueError("API-based Extension not found. Please check it again.")
        return extension
