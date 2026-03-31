from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock

import httpx
import pytest


@pytest.fixture(scope="module")
def jina_module() -> ModuleType:
    """
    Load `api/services/auth/jina.py` as a standalone module.

    This repo contains both `services/auth/jina.py` and a package at
    `services/auth/jina/`, so importing `services.auth.jina` can be ambiguous.
    """

    module_path = Path(__file__).resolve().parents[4] / "services" / "auth" / "jina.py"
    # Use a stable module name so pytest-cov can target it with `--cov=services.auth.jina_file`.
    spec = importlib.util.spec_from_file_location("services.auth.jina_file", module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _credentials(api_key: str | None = "test_api_key_123", auth_type: str = "bearer") -> dict:
    config: dict = {} if api_key is None else {"api_key": api_key}
    return {"auth_type": auth_type, "config": config}


def test_init_valid_bearer_credentials(jina_module: ModuleType) -> None:
    auth = jina_module.JinaAuth(_credentials())
    assert auth.api_key == "test_api_key_123"
    assert auth.credentials["auth_type"] == "bearer"


def test_init_rejects_invalid_auth_type(jina_module: ModuleType) -> None:
    with pytest.raises(ValueError, match="Invalid auth type.*Bearer"):
        jina_module.JinaAuth(_credentials(auth_type="basic"))


@pytest.mark.parametrize("credentials", [{"auth_type": "bearer", "config": {}}, {"auth_type": "bearer"}])
def test_init_requires_api_key(jina_module: ModuleType, credentials: dict) -> None:
    with pytest.raises(ValueError, match="No API key provided"):
        jina_module.JinaAuth(credentials)


def test_prepare_headers_includes_bearer_api_key(jina_module: ModuleType) -> None:
    auth = jina_module.JinaAuth(_credentials(api_key="k"))
    assert auth._prepare_headers() == {"Content-Type": "application/json", "Authorization": "Bearer k"}


def test_post_request_calls_httpx(jina_module: ModuleType, monkeypatch: pytest.MonkeyPatch) -> None:
    auth = jina_module.JinaAuth(_credentials(api_key="k"))
    post_mock = MagicMock(name="httpx.post")
    monkeypatch.setattr(jina_module._http_client, "post", post_mock)

    auth._post_request("https://r.jina.ai", {"url": "https://example.com"}, {"h": "v"})
    post_mock.assert_called_once_with("https://r.jina.ai", headers={"h": "v"}, json={"url": "https://example.com"})


def test_validate_credentials_success(jina_module: ModuleType, monkeypatch: pytest.MonkeyPatch) -> None:
    auth = jina_module.JinaAuth(_credentials(api_key="k"))

    response = MagicMock()
    response.status_code = 200
    post_mock = MagicMock(return_value=response)
    monkeypatch.setattr(jina_module._http_client, "post", post_mock)

    assert auth.validate_credentials() is True
    post_mock.assert_called_once_with(
        "https://r.jina.ai",
        headers={"Content-Type": "application/json", "Authorization": "Bearer k"},
        json={"url": "https://example.com"},
    )


def test_validate_credentials_non_200_raises_via_handle_error(
    jina_module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    auth = jina_module.JinaAuth(_credentials(api_key="k"))

    response = MagicMock()
    response.status_code = 402
    response.json.return_value = {"error": "Payment required"}
    monkeypatch.setattr(jina_module._http_client, "post", MagicMock(return_value=response))

    with pytest.raises(Exception, match="Status code: 402.*Payment required"):
        auth.validate_credentials()


@pytest.mark.parametrize("status_code", [402, 409, 500])
def test_handle_error_statuses_use_response_json(jina_module: ModuleType, status_code: int) -> None:
    auth = jina_module.JinaAuth(_credentials(api_key="k"))
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = {"error": "boom"}

    with pytest.raises(Exception, match=f"Status code: {status_code}.*boom"):
        auth._handle_error(response)


def test_handle_error_statuses_default_unknown_error(jina_module: ModuleType) -> None:
    auth = jina_module.JinaAuth(_credentials(api_key="k"))
    response = MagicMock()
    response.status_code = 402
    response.json.return_value = {}

    with pytest.raises(Exception, match="Unknown error occurred"):
        auth._handle_error(response)


def test_handle_error_with_text_json_body(jina_module: ModuleType) -> None:
    auth = jina_module.JinaAuth(_credentials(api_key="k"))
    response = MagicMock()
    response.status_code = 403
    response.text = '{"error": "Forbidden"}'

    with pytest.raises(Exception, match="Status code: 403.*Forbidden"):
        auth._handle_error(response)


def test_handle_error_with_text_json_body_missing_error(jina_module: ModuleType) -> None:
    auth = jina_module.JinaAuth(_credentials(api_key="k"))
    response = MagicMock()
    response.status_code = 403
    response.text = "{}"

    with pytest.raises(Exception, match="Unknown error occurred"):
        auth._handle_error(response)


def test_handle_error_without_text_raises_unexpected(jina_module: ModuleType) -> None:
    auth = jina_module.JinaAuth(_credentials(api_key="k"))
    response = MagicMock()
    response.status_code = 404
    response.text = ""

    with pytest.raises(Exception, match="Unexpected error occurred.*404"):
        auth._handle_error(response)


def test_validate_credentials_propagates_network_errors(
    jina_module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    auth = jina_module.JinaAuth(_credentials(api_key="k"))
    monkeypatch.setattr(jina_module._http_client, "post", MagicMock(side_effect=httpx.ConnectError("boom")))

    with pytest.raises(httpx.ConnectError, match="boom"):
        auth.validate_credentials()
