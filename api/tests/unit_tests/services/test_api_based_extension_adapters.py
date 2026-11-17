from typing import Literal
from unittest.mock import MagicMock

import pytest
from pydantic import JsonValue

import services.api_based_extension_adapters as module
from graphon.file import File, FileTransferMethod, FileType
from models.api_based_extension import APIBasedExtensionPoint
from services.api_based_extension_adapters import APIBasedExtensionPingProbe, APIModerationGateway, WorkspaceTokenCipher
from services.api_based_extension_application_service import APIBasedExtensionConnectionError
from services.api_moderation_service import ModerationInputParams, ModerationOutputParams
from services.entities.message_entities import MessageInputValue


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


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
def test_moderation_gateway_translates_point_and_validated_parameters(direction: Literal["inputs", "outputs"]) -> None:
    """Validated input/output parameters retain their point, payload and response identity."""
    response = object()
    calls: list[tuple[str, str, APIBasedExtensionPoint, dict[str, object]]] = []

    def request(endpoint: str, key: str, point: APIBasedExtensionPoint, params: dict[str, object]) -> object:
        calls.append((endpoint, key, point, params))
        return response

    gateway = APIModerationGateway(request=request)
    if direction == "inputs":
        params = ModerationInputParams(app_id="app", inputs={"field": [1, True]}, query="hello")
        assert gateway.inputs("https://extension.example.test", "plaintext-key", params) is response
        point = APIBasedExtensionPoint.APP_MODERATION_INPUT
        expected = {"app_id": "app", "inputs": {"field": [1, True]}, "query": "hello"}
    else:
        output_params = ModerationOutputParams(app_id="app", text="hello")
        assert gateway.outputs("https://extension.example.test", "plaintext-key", output_params) is response
        point = APIBasedExtensionPoint.APP_MODERATION_OUTPUT
        expected = {"app_id": "app", "text": "hello"}
    assert calls == [("https://extension.example.test", "plaintext-key", point, expected)]


def test_input_domain_serialization_preserves_files_and_json() -> None:
    """File instances serialize as files while ordinary file-shaped JSON stays intact."""
    attachment = File(
        file_id="66666666-6666-4666-8666-666666666666",
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/input.pdf",
        filename="input.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=12,
    )
    file_shaped_json: dict[str, JsonValue] = {
        "dify_model_identity": "__dify__file__",
        "id": "77777777-7777-4777-8777-777777777777",
        "type": "document",
        "transfer_method": "remote_url",
        "remote_url": "https://example.com/ordinary.json",
        "filename": "ordinary.json",
        "extension": ".json",
        "mime_type": "application/json",
        "size": 4,
        "ordinary_json": {"keep": [1, True]},
    }
    values: dict[str, MessageInputValue] = {
        "动态变量": "value",
        "nothing": None,
        "empty_text": "",
        "empty_object": {},
        "empty_list": [],
        "nested": {"list": [{"checked": True}, None, ""]},
        "mixed": [1, True],
        "file": attachment,
        "files": [attachment],
        "file_json": file_shaped_json,
    }
    params = ModerationInputParams(inputs=values)
    calls: list[tuple[str, str, APIBasedExtensionPoint, dict[str, object]]] = []
    response = {"flagged": False}

    def request(endpoint: str, key: str, point: APIBasedExtensionPoint, payload: dict[str, object]) -> object:
        calls.append((endpoint, key, point, payload))
        wire_inputs = payload["inputs"]
        assert isinstance(wire_inputs, dict)
        wire_mixed = wire_inputs["mixed"]
        assert isinstance(wire_mixed, list)
        assert type(wire_mixed[0]) is int
        assert type(wire_mixed[1]) is bool
        return response

    assert APIModerationGateway(request=request).inputs("https://extension.example.test", "plaintext-key", params) is (
        response
    )
    assert params.inputs["file"] is attachment
    files = params.inputs["files"]
    assert isinstance(files, list)
    assert len(files) == 1
    assert files[0] is attachment
    assert isinstance(params.inputs["file_json"], dict)
    assert params.inputs["file_json"] == file_shaped_json
    expected = {
        "app_id": "",
        "inputs": {**values, "file": attachment.model_dump(), "files": [attachment.model_dump()]},
        "query": "",
    }
    assert calls == [
        ("https://extension.example.test", "plaintext-key", APIBasedExtensionPoint.APP_MODERATION_INPUT, expected)
    ]


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
def test_moderation_gateway_preserves_request_failure_identity(direction: Literal["inputs", "outputs"]) -> None:
    """Either gateway method propagates the original request failure instance."""
    failure = ValueError("request timeout")

    def request(_endpoint: str, _key: str, _point: APIBasedExtensionPoint, _params: dict[str, object]) -> object:
        raise failure

    gateway = APIModerationGateway(request=request)
    if direction == "inputs":
        with pytest.raises(ValueError, match="request timeout") as raised:
            gateway.inputs("https://extension.example.test", "plaintext-key", ModerationInputParams())
    else:
        with pytest.raises(ValueError, match="request timeout") as raised:
            gateway.outputs("https://extension.example.test", "plaintext-key", ModerationOutputParams(text="hello"))
    assert raised.value is failure
