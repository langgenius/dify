from unittest.mock import MagicMock

import pytest

import services.api_based_extension_adapters as module
from models.api_based_extension import APIBasedExtensionPoint
from services.api_based_extension_adapters import APIBasedExtensionPingProbe, WorkspaceTokenCipher
from services.api_based_extension_application_service import APIBasedExtensionConnectionError


def test_workspace_token_cipher_delegates_to_the_platform_encrypter(monkeypatch: pytest.MonkeyPatch) -> None:
    encrypt_token = MagicMock(return_value="cipher")
    decrypt_token = MagicMock(return_value="plain")
    monkeypatch.setattr(module, "encrypt_token", encrypt_token)
    monkeypatch.setattr(module, "decrypt_token", decrypt_token)
    cipher = WorkspaceTokenCipher()

    assert cipher.encrypt("workspace-1", "plain") == "cipher"
    assert cipher.decrypt("workspace-1", "cipher") == "plain"
    encrypt_token.assert_called_once_with("workspace-1", "plain")
    decrypt_token.assert_called_once_with("workspace-1", "cipher")


def test_ping_probe_accepts_pong(monkeypatch: pytest.MonkeyPatch) -> None:
    requestor = MagicMock()
    requestor.return_value.request.return_value = {"result": "pong"}
    monkeypatch.setattr(module, "APIBasedExtensionRequestor", requestor)

    APIBasedExtensionPingProbe().ping("https://ext.example.com", "secret")

    requestor.assert_called_once_with("https://ext.example.com", "secret")
    requestor.return_value.request.assert_called_once_with(point=APIBasedExtensionPoint.PING, params={})


def test_ping_probe_rejects_unexpected_replies(monkeypatch: pytest.MonkeyPatch) -> None:
    requestor = MagicMock()
    requestor.return_value.request.return_value = {"result": "nope"}
    monkeypatch.setattr(module, "APIBasedExtensionRequestor", requestor)

    with pytest.raises(APIBasedExtensionConnectionError, match="connection error: .*nope"):
        APIBasedExtensionPingProbe().ping("https://ext.example.com", "secret")


@pytest.mark.parametrize("reply", [[], None, "pong", 0])
def test_ping_probe_rejects_non_object_replies(monkeypatch: pytest.MonkeyPatch, reply: object) -> None:
    requestor = MagicMock()
    requestor.return_value.request.return_value = reply
    monkeypatch.setattr(module, "APIBasedExtensionRequestor", requestor)

    with pytest.raises(APIBasedExtensionConnectionError, match="connection error: "):
        APIBasedExtensionPingProbe().ping("https://ext.example.com", "secret")


def test_ping_probe_wraps_transport_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    requestor = MagicMock()
    requestor.return_value.request.side_effect = ValueError("request timeout")
    monkeypatch.setattr(module, "APIBasedExtensionRequestor", requestor)

    with pytest.raises(APIBasedExtensionConnectionError, match="connection error: request timeout"):
        APIBasedExtensionPingProbe().ping("https://ext.example.com", "secret")
