"""Send legacy moderation payloads through the existing guarded requestor."""

from pydantic import JsonValue

from core.extension.api_based_extension_requestor import APIBasedExtensionPoint, APIBasedExtensionRequestor


def request_inputs(api_endpoint: str, api_key: str, params: dict[str, object]) -> JsonValue:
    """Send input parameters unchanged and return JSON, propagating request failures."""
    return APIBasedExtensionRequestor(api_endpoint, api_key).request(
        APIBasedExtensionPoint.APP_MODERATION_INPUT, params
    )


def request_outputs(api_endpoint: str, api_key: str, params: dict[str, object]) -> JsonValue:
    """Send output parameters unchanged and return JSON, propagating request failures."""
    return APIBasedExtensionRequestor(api_endpoint, api_key).request(
        APIBasedExtensionPoint.APP_MODERATION_OUTPUT, params
    )
