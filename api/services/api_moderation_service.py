"""API moderation with explicit, workspace-scoped persistence and outbound capabilities.

Operations receive parsed direction selections. Enabled requests validate their
payloads before I/O; disabled selections perform no lookup or outbound work.
"""

from collections.abc import Callable, Mapping

from pydantic import BaseModel, Field, InstanceOf, JsonValue

from domain.moderation.api_config import DisabledDirection, EnabledDirection
from graphon.file import File
from services.api_based_extension_application_service import APIBasedExtensionRecord


class ModerationInputParams(BaseModel):
    """Keep JSON mappings as JSON and admit file variants only as existing File instances."""

    app_id: str = ""
    inputs: dict[str, JsonValue | InstanceOf[File] | list[InstanceOf[File]]] = Field(default_factory=dict)
    query: str = ""


class ModerationOutputParams(BaseModel):
    app_id: str = ""
    text: str


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

    def validate_config(self, tenant_id: str, selection: EnabledDirection) -> None:
        """Require an owned extension for admitted form settings without outbound I/O.

        An absent owned row raises ValueError. Lookup failures propagate after
        session cleanup. Successful validation changes no state.
        """
        self._require_extension(tenant_id, selection.extension_id)

    def moderate_inputs(
        self,
        tenant_id: str,
        app_id: str,
        selection: DisabledDirection | EnabledDirection,
        inputs: Mapping[str, object],
        query: str = "",
    ) -> JsonValue:
        """Return the disabled result or raw input response for facade validation.

        The selection is already admitted. Input mappings admit dynamic variable
        names with JSON, File or list[File] values. Enabled payloads validate before
        lookup; disabled selections skip validation and I/O. Dependency errors propagate.
        """
        if isinstance(selection, DisabledDirection):
            return {"flagged": False, "action": "direct_output", "preset_response": ""}
        params = ModerationInputParams.model_validate({"app_id": app_id, "inputs": inputs, "query": query})
        extension = self._require_extension(tenant_id, selection.extension_id)
        key = self._decrypt_key(tenant_id, extension.api_key)
        return self._request_inputs(extension.api_endpoint, key, params)

    def moderate_outputs(
        self, tenant_id: str, app_id: str, selection: DisabledDirection | EnabledDirection, text: str
    ) -> JsonValue:
        """Return the disabled result or raw output response for facade validation.

        The selection is already admitted. Enabled request parameters validate before
        lookup; disabled selections skip validation and I/O. Lookup, decrypt and request
        failures propagate unchanged in that order.
        """
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
