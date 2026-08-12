from __future__ import annotations

import json
import os
from collections.abc import Callable, Mapping
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import pytest
from lark_oapi.event.callback.model.p2_card_action_trigger import (
    P2CardActionTrigger,
    P2CardActionTriggerResponse,
)

from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ParagraphInput, ResolvedForm, ResolvedFormAction, SelectInput
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import feishu_lark
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMIntegrationCredentials,
    FeishuIMProviderAdapter,
)
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    CorrelationToken,
    DynamicCardMessagingError,
    EventAcceptance,
    IMCardEvent,
    IMCardEventDecodingError,
    MessageAccepted,
    ProviderUserId,
    StaticCardIntent,
    UnrecognizedIMEvent,
    WebhookRequest,
)

_FIXTURE_DIRECTORY = Path(__file__).resolve().parents[4] / "unit_tests/core/human_input_v2/im_provider/fixtures"
_WEBHOOK_FIXTURE = _FIXTURE_DIRECTORY / "feishu_lark_card_action_webhook.json"
_STREAM_FIXTURE = _FIXTURE_DIRECTORY / "feishu_lark_card_action_stream.json"
_RECEIVED_AT = datetime(2026, 8, 12, 10, 0, 0)
_DIFY_ACTION_MARKER = "__dify.human_input.action"
_WEBHOOK_PAYLOAD_KEY = "__dify_feishu_lark.webhook"
_STREAM_PAYLOAD_KEY = "__dify_feishu_lark.stream"


class _RecordingGateway:
    def __init__(self) -> None:
        self.card_content: dict[str, object] | None = None

    def query_tenant(self) -> Mapping[str, object]:
        return {"code": 0, "data": {"tenant": {"tenant_key": "tenant_test_only"}}}

    def list_scope(self, _page_token: str | None) -> Mapping[str, object]:
        raise AssertionError("unexpected directory call")

    def list_departments(
        self,
        _department: feishu_lark._DepartmentIdentity,
        _page_token: str | None,
    ) -> Mapping[str, object]:
        raise AssertionError("unexpected directory call")

    def list_users(
        self,
        _department: feishu_lark._DepartmentIdentity,
        _page_token: str | None,
    ) -> Mapping[str, object]:
        raise AssertionError("unexpected directory call")

    def create_message(self, _receive_id: str, msg_type: str, content: str) -> Mapping[str, object]:
        assert msg_type == "interactive"
        decoded_content = json.loads(content)
        assert isinstance(decoded_content, dict)
        self.card_content = decoded_content
        return {"code": 0, "data": {"message_id": "message_test_only"}}

    def patch_message(self, _message_id: str, _content: str) -> Mapping[str, object]:
        raise AssertionError("unexpected replacement call")


class _LiveRecordingGateway:
    def __init__(self, delegate: feishu_lark._SDKGateway) -> None:
        self._delegate = delegate
        self.card_content: dict[str, object] | None = None

    def query_tenant(self) -> Mapping[str, object]:
        return self._delegate.query_tenant()

    def list_scope(self, page_token: str | None) -> Mapping[str, object]:
        return self._delegate.list_scope(page_token)

    def list_departments(
        self,
        department: feishu_lark._DepartmentIdentity,
        page_token: str | None,
    ) -> Mapping[str, object]:
        return self._delegate.list_departments(department, page_token)

    def list_users(
        self,
        department: feishu_lark._DepartmentIdentity,
        page_token: str | None,
    ) -> Mapping[str, object]:
        return self._delegate.list_users(department, page_token)

    def create_message(self, receive_id: str, msg_type: str, content: str) -> Mapping[str, object]:
        decoded_content = json.loads(content)
        assert isinstance(decoded_content, dict)
        self.card_content = decoded_content
        return self._delegate.create_message(receive_id, msg_type, content)

    def patch_message(self, message_id: str, content: str) -> Mapping[str, object]:
        return self._delegate.patch_message(message_id, content)


class _EventConsumer:
    def __init__(self) -> None:
        self.event: AuthenticatedIMEvent | None = None

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        self.event = event
        return EventAcceptance.ACCEPTED


class _FixtureSDKObjectStreamClient:
    def __init__(
        self,
        credentials: FeishuIMIntegrationCredentials,
        domain: str,
        callback: Callable[[feishu_lark._SDKEventEnvelope, Callable[[], None]], None],
        sdk_event: P2CardActionTrigger,
    ) -> None:
        self._channel = feishu_lark._SynchronousEventChannel(
            credentials=credentials,
            domain=domain,
            callback=callback,
        )
        self._sdk_event = sdk_event
        self.response: P2CardActionTriggerResponse | None = None

    def start(self) -> None:
        self.response = self._channel._on_card_action(self._sdk_event)

    def stop(self) -> None:
        return None


def _intent(marker: str = "test-only") -> ResolvedForm:
    return ResolvedForm(
        title=f"Feishu/Lark card agreement [{marker}]",
        blocks=(
            MarkdownText("Review the provider wire card."),
            ParagraphInput("comment", "Initial review"),
            SelectInput("decision", ("ship", "hold"), "hold"),
        ),
        user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="unused",
    )


def _credentials() -> FeishuIMIntegrationCredentials:
    return FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id="cli_test_only",
        app_secret="secret_test_only",
        verification_token="verification_test_only",
        encrypt_key="encrypt_key_test_only",
    )


def _load_fixture(path: Path) -> dict[str, object]:
    fixture = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(fixture, dict)
    return fixture


def _fixture_payload(fixture: Mapping[str, object]) -> dict[str, object]:
    authenticated_event = fixture["authenticated_event"]
    assert isinstance(authenticated_event, dict)
    callback = authenticated_event["payload"]
    assert isinstance(callback, dict)
    return callback


def _decrypted_webhook_payload(fixture: Mapping[str, object]) -> str:
    http = fixture["http"]
    assert isinstance(http, dict)
    request = http["request"]
    assert isinstance(request, dict)
    body = request["body"]
    assert isinstance(body, str)
    encrypted_envelope = json.loads(body)
    assert isinstance(encrypted_envelope, dict)
    encrypted_payload = encrypted_envelope["encrypt"]
    assert isinstance(encrypted_payload, str)
    return feishu_lark._decrypt_webhook_payload(encrypted_payload, "encrypt_key_test_only").decode()


def _replayed_sdk_native_payload(fixture: Mapping[str, object]) -> str:
    stream_evidence = fixture["stream"]
    assert isinstance(stream_evidence, dict)
    serialization = stream_evidence["sdk_serialization"]
    assert isinstance(serialization, dict)
    captured_payload = serialization["value"]
    assert isinstance(captured_payload, str)
    sdk_event_mapping = json.loads(captured_payload)
    assert isinstance(sdk_event_mapping, dict)
    native_payload = feishu_lark.lark.JSON.marshal(P2CardActionTrigger(sdk_event_mapping))
    assert isinstance(native_payload, str)
    return native_payload


def _fixture_action(callback: Mapping[str, object]) -> dict[str, object]:
    event = callback["event"]
    assert isinstance(event, dict)
    action = event["action"]
    assert isinstance(action, dict)
    return action


def _replay_webhook(
    adapter: FeishuIMProviderAdapter,
    fixture: Mapping[str, object],
) -> AuthenticatedIMEvent:
    http = fixture["http"]
    assert isinstance(http, dict)
    request = http["request"]
    expected_response = http["response"]
    assert isinstance(request, dict)
    assert isinstance(expected_response, dict)
    raw_headers = request["headers"]
    assert isinstance(raw_headers, list)
    headers: list[tuple[str, str]] = []
    for raw_header in raw_headers:
        assert isinstance(raw_header, dict)
        name = raw_header["name"]
        value = raw_header["value"]
        assert isinstance(name, str)
        assert isinstance(value, str)
        headers.append((name, value))

    method = request["method"]
    body = request["body"]
    received_at = request["received_at"]
    assert isinstance(method, str)
    assert isinstance(body, str)
    assert isinstance(received_at, str)
    consumer = _EventConsumer()
    response = adapter.create_webhook_handler(consumer).handle(
        WebhookRequest(
            method=method,
            headers=tuple(headers),
            body=body.encode(),
            received_at=datetime.fromisoformat(received_at),
        )
    )

    assert response.status_code == expected_response["status"]
    assert response.body.decode() == expected_response["body"]
    assert consumer.event is not None
    return consumer.event


def _replay_stream(
    monkeypatch: pytest.MonkeyPatch,
    adapter: FeishuIMProviderAdapter,
    fixture: Mapping[str, object],
) -> AuthenticatedIMEvent:
    stream_evidence = fixture["stream"]
    assert isinstance(stream_evidence, dict)
    serialization = stream_evidence["sdk_serialization"]
    callback_response = stream_evidence["callback_response"]
    assert isinstance(serialization, dict)
    assert isinstance(callback_response, dict)
    serialized_event = serialization["value"]
    assert isinstance(serialized_event, str)
    sdk_event_mapping = json.loads(serialized_event)
    assert isinstance(sdk_event_mapping, dict)
    sdk_event = P2CardActionTrigger(sdk_event_mapping)
    clients: list[_FixtureSDKObjectStreamClient] = []

    def create_stream_client(
        credentials: FeishuIMIntegrationCredentials,
        domain: str,
        callback: Callable[[feishu_lark._SDKEventEnvelope, Callable[[], None]], None],
    ) -> _FixtureSDKObjectStreamClient:
        client = _FixtureSDKObjectStreamClient(credentials, domain, callback, sdk_event)
        clients.append(client)
        return client

    monkeypatch.setattr(feishu_lark, "_create_sdk_stream_client", create_stream_client)
    consumer = _EventConsumer()
    stream = adapter.create_stream_handler(consumer)
    stream.start()
    stream.stop()

    assert len(clients) == 1
    response = clients[0].response
    assert isinstance(response, P2CardActionTriggerResponse)
    response_serialization = callback_response["sdk_serialization"]
    assert isinstance(response_serialization, dict)
    assert feishu_lark.lark.JSON.marshal(response) == response_serialization["value"]
    assert consumer.event is not None
    return consumer.event


def _event(
    callback: Mapping[str, object],
    provider: IMProvider = IMProvider.FEISHU,
    *,
    payload: str | None = None,
) -> AuthenticatedIMEvent:
    serialized_payload = payload
    if serialized_payload is None:
        native_payload = json.dumps(callback, ensure_ascii=False)
        serialized_payload = json.dumps(
            {
                _WEBHOOK_PAYLOAD_KEY: {
                    "encrypted": True,
                    "native_payload": native_payload,
                }
            },
            ensure_ascii=False,
        )
    return AuthenticatedIMEvent(
        provider=provider,
        provider_tenant_id="tenant_test_only",
        event_id="event_test_only",
        event_type="card.action.trigger",
        occurred_at=None,
        received_at=_RECEIVED_AT,
        payload=serialized_payload,
    )


def _button_metadata(card: Mapping[str, object]) -> dict[str, object]:
    body = card["body"]
    assert isinstance(body, dict)
    body_elements = body["elements"]
    assert isinstance(body_elements, list)
    form = body_elements[0]
    assert isinstance(form, dict)
    form_elements = form["elements"]
    assert isinstance(form_elements, list)
    action_row = form_elements[-1]
    assert isinstance(action_row, dict)
    columns = action_row["columns"]
    assert isinstance(columns, list)
    column = columns[0]
    assert isinstance(column, dict)
    buttons = column["elements"]
    assert isinstance(buttons, list)
    button = buttons[0]
    assert isinstance(button, dict)
    behaviors = button["behaviors"]
    assert isinstance(behaviors, list)
    behavior = behaviors[0]
    assert isinstance(behavior, dict)
    metadata = behavior["value"]
    assert isinstance(metadata, dict)
    return metadata


def _callback(metadata: Mapping[str, object], actor: str = "union_test_only") -> dict[str, object]:
    marked_metadata = metadata.get(_DIFY_ACTION_MARKER)
    raw_action_id = marked_metadata.get("action_id") if isinstance(marked_metadata, Mapping) else None
    action_id = raw_action_id if isinstance(raw_action_id, str) else "foreign"
    return {
        "schema": "2.0",
        "header": {"event_type": "card.action.trigger", "tenant_key": "tenant_test_only"},
        "event": {
            "operator": {"union_id": actor, "open_id": "open_id_must_not_be_used"},
            "action": {
                "tag": "button",
                "name": action_id,
                "value": dict(metadata),
                "form_value": {"comment": "Reviewed ✅", "decision": "ship"},
            },
        },
    }


def test_webhook_transport_preserves_exact_decrypted_payload_until_decode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = _load_fixture(_WEBHOOK_FIXTURE)
    native_payload = _decrypted_webhook_payload(fixture)
    gateway = _RecordingGateway()
    monkeypatch.setattr(feishu_lark, "_create_sdk_gateway", lambda _credentials, _domain: gateway)
    adapter = FeishuIMProviderAdapter(_credentials())

    try:
        authenticated_event = _replay_webhook(adapter, fixture)
        envelope = json.loads(authenticated_event.payload)
        decoded = FeishuIMProviderAdapter.card_event_decoder().decode(authenticated_event)
    finally:
        adapter.close()

    assert envelope == {
        _WEBHOOK_PAYLOAD_KEY: {
            "encrypted": True,
            "native_payload": native_payload,
        }
    }
    assert json.loads(native_payload) == _fixture_payload(fixture)
    assert isinstance(decoded, IMCardEvent)


def test_stream_transport_preserves_exact_sdk_payload_until_decode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = _load_fixture(_STREAM_FIXTURE)
    stream_evidence = fixture["stream"]
    assert isinstance(stream_evidence, dict)
    serialization = stream_evidence["sdk_serialization"]
    assert isinstance(serialization, dict)
    native_payload = _replayed_sdk_native_payload(fixture)
    object_type = stream_evidence["object_type"]
    assert isinstance(object_type, str)
    gateway = _RecordingGateway()
    monkeypatch.setattr(feishu_lark, "_create_sdk_gateway", lambda _credentials, _domain: gateway)
    adapter = FeishuIMProviderAdapter(_credentials())

    try:
        authenticated_event = _replay_stream(monkeypatch, adapter, fixture)
        envelope = json.loads(authenticated_event.payload)
        decoded = FeishuIMProviderAdapter.card_event_decoder().decode(authenticated_event)
    finally:
        adapter.close()

    assert envelope == {
        _STREAM_PAYLOAD_KEY: {
            "native_payload": native_payload,
            "object_type": object_type,
        }
    }
    assert isinstance(decoded, IMCardEvent)


def test_sender_wire_agrees_with_sanitized_webhook_and_stream_boundaries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = _RecordingGateway()
    monkeypatch.setattr(feishu_lark, "_create_sdk_gateway", lambda _credentials, _domain: gateway)
    monkeypatch.setattr(feishu_lark, "_reference_signing_secret", lambda: "signing-secret-test-only")
    adapter = FeishuIMProviderAdapter(_credentials())
    token = CorrelationToken("feishu-lark-card-evidence-token")
    webhook_fixture = _load_fixture(_WEBHOOK_FIXTURE)
    stream_fixture = _load_fixture(_STREAM_FIXTURE)

    try:
        assert adapter.dynamic_card_messaging.assess(_intent()).representable is True
        empty_intent = ResolvedForm(title=None, blocks=(), user_actions=(), legacy_form_content="unused")
        assert adapter.dynamic_card_messaging.assess(empty_intent).representable is False
        result = adapter.dynamic_card_messaging.send_card(
            ProviderUserId("union_test_only"),
            _intent(),
            token,
        )
        assert isinstance(result, MessageAccepted)
        assert gateway.card_content is not None
        sender_metadata = _button_metadata(gateway.card_content)
        sender_marker = sender_metadata[_DIFY_ACTION_MARKER]
        assert isinstance(sender_marker, dict)
        action_id = sender_marker["action_id"]
        correlation_token = sender_marker["correlation_token"]
        assert isinstance(action_id, str)
        assert correlation_token == token

        webhook_callback = _fixture_payload(webhook_fixture)
        stream_callback = _fixture_payload(stream_fixture)
        webhook_action = _fixture_action(webhook_callback)
        stream_action = _fixture_action(stream_callback)
        assert webhook_action["value"] == sender_metadata
        assert stream_action["value"] == sender_metadata
        submitted_inputs = webhook_action["form_value"]
        assert isinstance(submitted_inputs, dict)
        assert stream_action["form_value"] == submitted_inputs

        webhook_event = _replay_webhook(adapter, webhook_fixture)
        stream_event = _replay_stream(monkeypatch, adapter, stream_fixture)
        webhook_decoded = FeishuIMProviderAdapter.card_event_decoder().decode(webhook_event)
        stream_decoded = FeishuIMProviderAdapter.card_event_decoder().decode(stream_event)
    finally:
        adapter.close()

    expected = IMCardEvent(
        provider_user_id=ProviderUserId("union_test_only"),
        action_id=action_id,
        inputs=submitted_inputs,
        correlation_token=token,
    )
    assert webhook_decoded == expected
    assert stream_decoded == expected


def test_stream_evidence_decodes_through_both_provider_variants() -> None:
    fixture = json.loads(_STREAM_FIXTURE.read_text(encoding="utf-8"))
    assert isinstance(fixture, dict)
    authenticated_event = fixture["authenticated_event"]
    assert isinstance(authenticated_event, dict)
    callback = authenticated_event["payload"]
    assert isinstance(callback, dict)

    feishu_result = FeishuIMProviderAdapter.card_event_decoder().decode(_event(callback))
    lark_result = feishu_lark.LarkIMProviderAdapter.card_event_decoder().decode(_event(callback, IMProvider.LARK))

    assert feishu_result == lark_result
    assert isinstance(feishu_result, IMCardEvent)
    assert feishu_result.provider_user_id == ProviderUserId("union_test_only")


def test_stream_transport_rejects_whitespace_union_id_with_safe_diagnostic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = _load_fixture(_STREAM_FIXTURE)
    callback = _fixture_payload(fixture)
    callback_event = callback["event"]
    assert isinstance(callback_event, dict)
    operator = callback_event["operator"]
    assert isinstance(operator, dict)
    operator["union_id"] = " \t "
    stream_evidence = fixture["stream"]
    assert isinstance(stream_evidence, dict)
    serialization = stream_evidence["sdk_serialization"]
    assert isinstance(serialization, dict)
    serialization["value"] = json.dumps(callback, ensure_ascii=False)

    gateway = _RecordingGateway()
    monkeypatch.setattr(feishu_lark, "_create_sdk_gateway", lambda _credentials, _domain: gateway)
    adapter = FeishuIMProviderAdapter(_credentials())
    try:
        authenticated_event = _replay_stream(monkeypatch, adapter, fixture)
        with pytest.raises(
            IMCardEventDecodingError,
            match=r"^Feishu/Lark card event schema is invalid\.$",
        ) as raised:
            FeishuIMProviderAdapter.card_event_decoder().decode(authenticated_event)
    finally:
        adapter.close()

    assert raised.value.args == ("Feishu/Lark card event schema is invalid.",)
    assert raised.value.__cause__ is None
    assert raised.value.__context__ is None


def test_protocol_failure_and_routing_boundaries_remain_distinct() -> None:
    codec = feishu_lark._MSFeishuLarkCardCodec()
    foreign = _callback({"foreign": True})
    assert isinstance(codec.decode(_event(foreign)), UnrecognizedIMEvent)
    assert isinstance(codec.decode(_event(foreign, IMProvider.SLACK)), UnrecognizedIMEvent)

    with pytest.raises(IMCardEventDecodingError, match="schema is invalid"):
        codec.decode(_event({"schema": "1.0"}))

    with pytest.raises(IMCardEventDecodingError, match="payload is invalid"):
        codec.decode(_event({}, payload="[]"))

    recognized = _callback(
        {
            _DIFY_ACTION_MARKER: {
                "version": 1,
                "action_id": "approve",
                "correlation_token": "token",
            }
        },
        actor="",
    )
    with pytest.raises(IMCardEventDecodingError, match="schema is invalid"):
        codec.decode(_event(recognized))

    with pytest.raises(IMCardEventDecodingError, match="payload is invalid"):
        codec.decode(_event({}, payload="not-json"))

    oversized = ResolvedForm(
        title=None,
        blocks=(MarkdownText("x" * (31 * 1024)),),
        user_actions=(),
        legacy_form_content="unused",
    )
    with pytest.raises(DynamicCardMessagingError, match="Provider payload limit"):
        codec.encode(oversized, CorrelationToken("token"))


@pytest.mark.parametrize(
    ("payload", "expected_message"),
    [
        pytest.param(
            json.dumps(
                {
                    "schema": "2.0",
                    "header": {"event_type": "card.action.trigger"},
                    "event": {},
                }
            ),
            "Feishu/Lark card event envelope is invalid.",
            id="bare-callback",
        ),
        pytest.param(
            json.dumps({_WEBHOOK_PAYLOAD_KEY: {"encrypted": True}}),
            "Feishu/Lark card event envelope is invalid.",
            id="malformed-webhook-wrapper",
        ),
        pytest.param(
            json.dumps(
                {
                    _STREAM_PAYLOAD_KEY: {
                        "native_payload": "{}",
                        "object_type": "unexpected.sdk.Event",
                    }
                }
            ),
            "Feishu/Lark card event envelope is invalid.",
            id="wrong-stream-object-type",
        ),
        pytest.param(
            json.dumps(
                {
                    _WEBHOOK_PAYLOAD_KEY: {
                        "encrypted": True,
                        "native_payload": "not-json",
                    }
                }
            ),
            "Feishu/Lark card event payload is invalid.",
            id="invalid-native-payload",
        ),
    ],
)
def test_transport_envelope_protocol_rejects_bypass_and_malformed_wrappers(
    payload: str,
    expected_message: str,
) -> None:
    codec = feishu_lark._MSFeishuLarkCardCodec()

    with pytest.raises(IMCardEventDecodingError) as raised:
        codec.decode(_event({}, payload=payload))

    assert raised.value.args == (expected_message,)


def test_live_feishu_sender_is_accepted_and_replaced_without_callback_synthesis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app_id = os.getenv("FEISHU_APP_ID")
    app_secret = os.getenv("FEISHU_APP_SECRET")
    verification_token = os.getenv("FEISHU_VERIFICATION_TOKEN")
    encrypt_key = os.getenv("FEISHU_ENCRYPT_KEY")
    recipient_id = os.getenv("FEISHU_TEST_RECIPIENT_ID")
    if not all((app_id, app_secret, verification_token, encrypt_key, recipient_id)):
        pytest.skip("Feishu live card sender credentials or recipient are unavailable")
    assert app_id is not None
    assert app_secret is not None
    assert verification_token is not None
    assert encrypt_key is not None
    assert recipient_id is not None

    credentials = FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id=app_id,
        app_secret=app_secret,
        verification_token=verification_token,
        encrypt_key=encrypt_key,
    )
    live_gateway = _LiveRecordingGateway(feishu_lark._OfficialSDKGateway(credentials, feishu_lark._FEISHU_DOMAIN))
    monkeypatch.setattr(feishu_lark, "_create_sdk_gateway", lambda _credentials, _domain: live_gateway)
    monkeypatch.setattr(feishu_lark, "_reference_signing_secret", lambda: "signing-secret-test-only")
    adapter = FeishuIMProviderAdapter(credentials)
    marker = f"codex-feishu-lark-card-event-{uuid4()}"
    token = CorrelationToken(f"{marker}-correlation")

    try:
        result = adapter.dynamic_card_messaging.send_card(
            ProviderUserId(recipient_id),
            _intent(marker),
            token,
        )
        assert isinstance(result, MessageAccepted)
        assert live_gateway.card_content is not None
        marker_metadata = _button_metadata(live_gateway.card_content)[_DIFY_ACTION_MARKER]
        assert isinstance(marker_metadata, dict)
        assert marker_metadata["action_id"] == "approve"
        assert marker_metadata["correlation_token"] == token
        assert (
            adapter.dynamic_card_messaging.replace_with_static(
                result.reference,
                StaticCardIntent(f"Feishu/Lark card integration completed [{marker}]"),
            )
            is None
        )
    finally:
        adapter.close()
