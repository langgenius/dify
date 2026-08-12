from unittest.mock import MagicMock, patch

import httpx

from configs.remote_settings_sources.nacos.http_request import NacosHttpClient


def _ok_response(text: str = "ok", json_data: dict | None = None) -> MagicMock:
    response = MagicMock()
    response.text = text
    response.raise_for_status.return_value = None
    if json_data is not None:
        response.json.return_value = json_data
    return response


def test_http_request_passes_bounded_timeout():
    client = NacosHttpClient()
    with patch("configs.remote_settings_sources.nacos.http_request.httpx.request") as mock_request:
        mock_request.return_value = _ok_response()
        client.http_request("/nacos/v1/cs/configs")

    timeout = mock_request.call_args.kwargs["timeout"]
    assert isinstance(timeout, httpx.Timeout)
    assert timeout.read is not None
    assert timeout.connect is not None


def test_http_request_returns_graceful_message_on_timeout():
    client = NacosHttpClient()
    with patch(
        "configs.remote_settings_sources.nacos.http_request.httpx.request",
        side_effect=httpx.ConnectTimeout("connection timed out"),
    ):
        result = client.http_request("/nacos/v1/cs/configs")

    assert "Nacos" in result
    assert "timed out" in result.lower()


def test_get_access_token_passes_bounded_timeout():
    client = NacosHttpClient()
    client.username = "user"
    client.password = "pass"
    with patch("configs.remote_settings_sources.nacos.http_request.httpx.request") as mock_request:
        mock_request.return_value = _ok_response(json_data={"accessToken": "tok", "tokenTtl": 100})
        token = client.get_access_token(force_refresh=True)

    assert token == "tok"
    timeout = mock_request.call_args.kwargs["timeout"]
    assert isinstance(timeout, httpx.Timeout)
