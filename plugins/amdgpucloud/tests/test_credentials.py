import json
from unittest.mock import ANY, patch

import pytest
import requests
from dify_plugin.errors.model import CredentialsValidateFailedError

from models._credentials import (
    CHAT_COMPLETIONS_URL,
    MAX_MODELS_RESPONSE_BYTES,
    validate_api_key,
    validate_model_access,
)
from provider.amdgpucloud import AMDGPUCloudModelProvider

VALIDATION_MODEL = "discovered-validation-model"


@pytest.fixture(autouse=True)
def discovered_validation_catalog(monkeypatch):
    monkeypatch.setattr("models._credentials.discover_models", lambda *args, **kwargs: [
        {"model": VALIDATION_MODEL}
    ])

def response(status: int, payload: object) -> requests.Response:
    result = requests.Response()
    result.status_code = status
    result._content = (
        payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    )
    result._content_consumed = True
    result.headers["Content-Type"] = "application/json"
    return result


@patch("models._transport.requests.post")
def test_provider_validation_uses_minimal_completion(post) -> None:
    post.return_value = response(
        200,
        {"choices": [{"message": {"content": "OK"}}], "usage": {}},
    )
    provider = AMDGPUCloudModelProvider.__new__(AMDGPUCloudModelProvider)

    provider.validate_provider_credentials({"api_key": "  rc-test  "})

    post.assert_called_once_with(
        CHAT_COMPLETIONS_URL,
        headers={
            "Accept": "application/json",
            "Authorization": "Bearer rc-test",
            "X-Source": "dify",
            "Content-Type": "application/json",
        },
        json={
            "model": VALIDATION_MODEL,
            "messages": [{"role": "user", "content": "Reply with OK."}],
            "max_tokens": 1,
            "stream": False,
        },
        timeout=(10, 30),
        allow_redirects=False,
        stream=True,
        auth=ANY,
    )


@patch("models._transport.requests.get")
@patch("models._transport.requests.post")
def test_model_validation_requires_exact_model_access(post, get) -> None:
    post.return_value = response(200, {"choices": [{"message": {"content": "OK"}}]})
    get.return_value = response(
        200,
        {"object": "list", "data": [{"id": "DeepSeek-V4-Flash"}]},
    )

    validate_model_access({"api_key": "rc-test"}, "DeepSeek-V4-Flash")

    with pytest.raises(CredentialsValidateFailedError, match="not available"):
        validate_model_access({"api_key": "rc-test"}, "deepseek-v4-flash")


@pytest.mark.parametrize(
    ("status", "message"),
    [
        (401, "Invalid AMDGPUCloud API key"),
        (403, "Invalid AMDGPUCloud API key"),
        (429, "rate limited"),
        (500, "temporarily unavailable"),
        (503, "temporarily unavailable"),
        (302, "status 302"),
    ],
)
@patch("models._transport.requests.post")
def test_status_errors_are_sanitized(post, status: int, message: str) -> None:
    post.return_value = response(status, {"error": {"message": "sensitive"}})

    with pytest.raises(CredentialsValidateFailedError, match=message) as error:
        validate_api_key({"api_key": "rc-secret"})

    assert "sensitive" not in str(error.value)
    assert "rc-secret" not in str(error.value)


@patch("models._transport.requests.post")
def test_timeout_is_not_reported_as_invalid_key(post) -> None:
    post.side_effect = requests.Timeout("secret endpoint detail")

    with pytest.raises(CredentialsValidateFailedError, match="timed out") as error:
        validate_api_key({"api_key": "rc-secret"})

    assert "secret endpoint detail" not in str(error.value)


@patch("models._transport.requests.get")
@patch("models._transport.requests.post")
def test_invalid_or_oversized_model_list_is_rejected(post, get) -> None:
    post.return_value = response(200, {"choices": [{"message": {"content": "OK"}}]})
    get.return_value = response(200, b"not-json")
    with pytest.raises(CredentialsValidateFailedError, match="invalid model list"):
        validate_model_access({"api_key": "rc-test"}, "DeepSeek-V4-Flash")

    get.return_value = response(200, b"{" + b" " * MAX_MODELS_RESPONSE_BYTES + b"}")
    with pytest.raises(CredentialsValidateFailedError, match="oversized model list"):
        validate_model_access({"api_key": "rc-test"}, "DeepSeek-V4-Flash")


def test_missing_key_is_rejected_without_network() -> None:
    with patch("models._transport.requests.post") as post:
        with pytest.raises(CredentialsValidateFailedError, match="API key is required"):
            validate_api_key({"api_key": "  "})
        post.assert_not_called()


@pytest.mark.parametrize("payload", [b"not-json", {"choices": []}, {"choices": [{}]}])
@patch("models._transport.requests.post")
def test_success_status_without_chat_body_does_not_validate_key(post, payload) -> None:
    post.return_value = response(200, payload)
    with pytest.raises(CredentialsValidateFailedError, match="invalid"):
        validate_api_key({"api_key": "rc-test"})


@patch("models._transport.requests.post")
def test_header_control_characters_are_rejected_before_network(post) -> None:
    with pytest.raises(CredentialsValidateFailedError, match="format"):
        validate_api_key({"api_key": "rc-test\r\nHeader: value"})
    post.assert_not_called()