"""Resolve API moderation credentials through short, workspace-scoped reads.

The lookup capability returns a plain record after releasing its database session.
Decryption and outbound calls therefore run without retaining that read connection.
"""

from collections.abc import Callable

from pydantic import JsonValue

from services.api_based_extension_application_service import APIBasedExtensionRecord


class APIModerationService:
    """Keep extension lookup, decryption and outbound moderation in that order."""

    def __init__(
        self,
        *,
        find_extension: Callable[[str, str], APIBasedExtensionRecord | None],
        decrypt_key: Callable[[str, str], str],
        request_inputs: Callable[[str, str, dict[str, object]], JsonValue],
        request_outputs: Callable[[str, str, dict[str, object]], JsonValue],
    ) -> None:
        """Bind required capabilities without looking up or decrypting credentials."""
        self._find_extension = find_extension
        self._decrypt_key = decrypt_key
        self._request_inputs = request_inputs
        self._request_outputs = request_outputs

    def validate_extension(self, tenant_id: str, extension_id: str) -> None:
        """Require an extension in this tenant without decrypting or sending a request.

        Missing rows raise ValueError. Lookup failures propagate unchanged after
        the lookup capability has released its session.
        """
        self._require_extension(tenant_id, extension_id)

    def request_inputs(self, tenant_id: str, extension_id: str, params: dict[str, object]) -> JsonValue:
        """Send admitted input parameters after the scoped lookup has finished.

        Return the wire response for the caller's existing result validation.
        Lookup, decryption and request errors propagate unchanged.
        """
        extension = self._require_extension(tenant_id, extension_id)
        key = self._decrypt_key(tenant_id, extension.api_key)
        return self._request_inputs(extension.api_endpoint, key, params)

    def request_outputs(self, tenant_id: str, extension_id: str, params: dict[str, object]) -> JsonValue:
        """Send admitted output parameters after the scoped lookup has finished.

        Return the wire response for the caller's existing result validation.
        Lookup, decryption and request errors propagate unchanged.
        """
        extension = self._require_extension(tenant_id, extension_id)
        key = self._decrypt_key(tenant_id, extension.api_key)
        return self._request_outputs(extension.api_endpoint, key, params)

    def _require_extension(self, tenant_id: str, extension_id: str) -> APIBasedExtensionRecord:
        """Return the detached owned record or raise the legacy missing-extension error."""
        extension = self._find_extension(tenant_id, extension_id)
        if extension is None:
            raise ValueError("API-based Extension not found. Please check it again.")
        return extension
