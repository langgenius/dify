from collections.abc import Mapping

from dify_plugin.errors.model import CredentialsValidateFailedError, InvokeError

from models._catalog import discover_models
from models._transport import (
    CHAT_COMPLETIONS_URL,
    ENDPOINT_URL,
    MAX_MODELS_RESPONSE_BYTES,
    MODELS_URL,
    SOURCE_HEADER,
    SOURCE_VALUE,
    read_json_response,
    request_response,
)

__all__ = [
    "CHAT_COMPLETIONS_URL",
    "ENDPOINT_URL",
    "MAX_MODELS_RESPONSE_BYTES",
    "SOURCE_HEADER",
    "SOURCE_VALUE",
    "normalize_api_key",
    "validate_api_key",
    "validate_model_access",
    "validation_headers",
]

VALIDATION_TIMEOUT = (10, 30)


def normalize_api_key(credentials: Mapping) -> str:
    api_key = credentials.get("api_key")
    if not isinstance(api_key, str) or not api_key.strip():
        raise CredentialsValidateFailedError("AMDGPUCloud API key is required")
    normalized = api_key.strip()
    if any(ord(char) < 32 or ord(char) == 127 for char in normalized):
        raise CredentialsValidateFailedError("Invalid AMDGPUCloud API key format")
    return normalized


def validation_headers(credentials: Mapping) -> dict[str, str]:
    return {
        "Accept": "application/json",
        "Authorization": f"Bearer {normalize_api_key(credentials)}",
        SOURCE_HEADER: SOURCE_VALUE,
    }


def validate_api_key(credentials: Mapping) -> None:
    headers = {
        **validation_headers(credentials),
        "Content-Type": "application/json",
    }
    try:
        catalog = discover_models(credentials, force_refresh=True)
        if not catalog:
            raise CredentialsValidateFailedError("AMDGPUCloud has no available chat models")
        response = request_response(
            CHAT_COMPLETIONS_URL,
            headers=headers,
            json_body={
                "model": catalog[0]["model"],
                "messages": [{"role": "user", "content": "Reply with OK."}],
                "max_tokens": 1,
                "stream": False,
            },
            timeout=VALIDATION_TIMEOUT,
            operation="credential validation",
        )
        try:
            payload = read_json_response(response, 65536, "credential validation response")
            choices = payload.get("choices")
            if not (
                isinstance(choices, list)
                and choices
                and isinstance(choices[0], dict)
                and isinstance(choices[0].get("message"), dict)
            ):
                raise CredentialsValidateFailedError(
                    "AMDGPUCloud returned an invalid credential validation response"
                )
        finally:
            response.close()
    except InvokeError as error:
        raise CredentialsValidateFailedError(str(error)) from None


def validate_model_access(credentials: Mapping, model: str) -> None:
    validate_api_key(credentials)
    try:
        response = request_response(
            MODELS_URL,
            headers=validation_headers(credentials),
            timeout=VALIDATION_TIMEOUT,
            operation="model-list validation",
        )
        try:
            payload = read_json_response(response, MAX_MODELS_RESPONSE_BYTES, "model list")
        finally:
            response.close()
    except InvokeError as error:
        raise CredentialsValidateFailedError(str(error)) from None

    items = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise CredentialsValidateFailedError("AMDGPUCloud returned an invalid model list")

    model_ids = {
        item.get("id")
        for item in items
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    if model not in model_ids:
        raise CredentialsValidateFailedError(
            f"Model '{model}' is not available to this AMDGPUCloud API key"
        )