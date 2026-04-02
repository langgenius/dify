import sys
import os
import pytest
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from tools.client import AgentPayAuthError, AgentPayMCPClient


def test_requires_gateway_key() -> None:
    try:
        AgentPayMCPClient.from_credentials({})
        raise AssertionError("Expected missing key error")
    except Exception as exc:  # noqa: BLE001
        assert "gateway key" in str(exc).lower()


def test_default_credential_values() -> None:
    client = AgentPayMCPClient.from_credentials({"agentpay_gateway_key": "apg_test"})
    assert client.gateway_key == "apg_test"
    assert client.gateway_url == "https://agentpay.metaltorque.dev"
    assert client.launch_mode == "auto"


def test_auto_mode_raises_auth_error_without_stdio_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    client = AgentPayMCPClient.from_credentials({"agentpay_gateway_key": "apg_test"})

    stdio_called = False

    def mock_http_call(self: AgentPayMCPClient, tool_name: str, arguments: dict[str, object]) -> dict[str, object]:
        raise AgentPayAuthError("invalid key")

    def mock_stdio_call(self: AgentPayMCPClient, tool_name: str, arguments: dict[str, object]) -> dict[str, object]:
        nonlocal stdio_called
        stdio_called = True
        return {"ok": True}

    monkeypatch.setattr(AgentPayMCPClient, "_http_call", mock_http_call)
    monkeypatch.setattr(AgentPayMCPClient, "_stdio_call", mock_stdio_call)

    with pytest.raises(AgentPayAuthError):
        client.call_tool("check_balance", {})

    assert stdio_called is False


def test_auto_mode_falls_back_to_stdio_for_non_auth_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    client = AgentPayMCPClient.from_credentials({"agentpay_gateway_key": "apg_test"})

    def mock_http_call(self: AgentPayMCPClient, tool_name: str, arguments: dict[str, object]) -> dict[str, object]:
        raise RuntimeError("network issue")

    def mock_stdio_call(self: AgentPayMCPClient, tool_name: str, arguments: dict[str, object]) -> dict[str, object]:
        return {"ok": True}

    monkeypatch.setattr(AgentPayMCPClient, "_http_call", mock_http_call)
    monkeypatch.setattr(AgentPayMCPClient, "_stdio_call", mock_stdio_call)

    assert client.call_tool("check_balance", {}) == {"ok": True}
