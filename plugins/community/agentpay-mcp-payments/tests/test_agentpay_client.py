import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from tools.client import AgentPayMCPClient


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
