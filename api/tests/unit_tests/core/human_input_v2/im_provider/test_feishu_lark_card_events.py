from __future__ import annotations

import builtins
import json
import sys
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from importlib.util import resolve_name
from pathlib import Path
from types import FrameType, FunctionType

import pytest
from lark_oapi.event.callback.model.p2_card_action_trigger import (
    P2CardActionTrigger,
    P2CardActionTriggerResponse,
)

from core.human_input import ButtonStyle
from core.human_input_v2 import FileInput, MarkdownText, ParagraphInput, ResolvedForm, ResolvedFormAction, SelectInput
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import feishu_lark
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    CardAssessment,
    CorrelationToken,
    DynamicCardMessagingError,
    EventAcceptance,
    IMCardEvent,
    IMCardEventDecodingError,
    IMEventIngressKind,
    ProviderUserId,
    UnrecognizedIMEvent,
    WebhookRequest,
)

_FIXTURE_DIRECTORY = Path(__file__).with_name("fixtures")
_WEBHOOK_FIXTURE = _FIXTURE_DIRECTORY / "feishu_lark_card_action_webhook.json"
_STREAM_FIXTURE = _FIXTURE_DIRECTORY / "feishu_lark_card_action_stream.json"
_RECEIVED_AT = datetime(2026, 8, 12, 10, 0, 0)
_DIFY_ACTION_MARKER = "__dify.human_input.action"
_WEBHOOK_VERIFICATION_TOKEN = "verification_test_only"
_WEBHOOK_ENCRYPT_KEY = "encrypt_key_test_only"
_LEGACY_WEBHOOK_PAYLOAD_KEY = "__dify_feishu_lark.webhook"
_LEGACY_STREAM_PAYLOAD_KEY = "__dify_feishu_lark.stream"


class _WebhookGateway:
    def query_tenant(self) -> Mapping[str, object]:
        return {"code": 0, "data": {"tenant": {"tenant_key": "tenant_test_only"}}}


class _WebhookConsumer:
    def __init__(self) -> None:
        self.event: AuthenticatedIMEvent | None = None

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        self.event = event
        return EventAcceptance.ACCEPTED


class _FixtureSDKObjectStreamClient:
    def __init__(
        self,
        credentials: feishu_lark.FeishuIMIntegrationCredentials,
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
        self.stopped = False

    def start(self) -> None:
        self.response = self._channel._on_card_action(self._sdk_event)

    def stop(self) -> None:
        self.stopped = True


def _replay_sanitized_webhook(monkeypatch: pytest.MonkeyPatch) -> AuthenticatedIMEvent:
    fixture = json.loads(_WEBHOOK_FIXTURE.read_text(encoding="utf-8"))
    assert isinstance(fixture, dict)
    http = fixture["http"]
    authenticated_event = fixture["authenticated_event"]
    assert isinstance(http, dict)
    assert isinstance(authenticated_event, dict)
    request = http["request"]
    expected_response = http["response"]
    assert isinstance(request, dict)
    assert isinstance(expected_response, dict)
    headers = request["headers"]
    assert isinstance(headers, list)
    request_headers: list[tuple[str, str]] = []
    for header in headers:
        assert isinstance(header, dict)
        name = header["name"]
        value = header["value"]
        assert isinstance(name, str)
        assert isinstance(value, str)
        request_headers.append((name, value))

    gateway = _WebhookGateway()
    monkeypatch.setattr(feishu_lark, "_create_sdk_gateway", lambda _credentials, _domain: gateway)
    adapter = feishu_lark.FeishuIMProviderAdapter(
        feishu_lark.FeishuIMIntegrationCredentials(
            provider=IMProvider.FEISHU,
            app_id="cli_test_only",
            app_secret="app_secret_test_only",
            verification_token=_WEBHOOK_VERIFICATION_TOKEN,
            encrypt_key=_WEBHOOK_ENCRYPT_KEY,
        )
    )
    consumer = _WebhookConsumer()
    try:
        response = adapter.create_webhook_handler(consumer).handle(
            WebhookRequest(
                method=request["method"],
                headers=tuple(request_headers),
                body=request["body"].encode(),
                received_at=datetime.fromisoformat(request["received_at"]),
            )
        )
    finally:
        adapter.close()

    assert response.status_code == expected_response["status"]
    assert response.body.decode() == expected_response["body"]
    assert consumer.event is not None
    assert consumer.event.provider is IMProvider.FEISHU
    assert consumer.event.provider_tenant_id == authenticated_event["provider_tenant_id"]
    assert consumer.event.event_id == authenticated_event["event_id"]
    assert consumer.event.event_type == authenticated_event["event_type"]
    assert consumer.event.occurred_at == datetime.fromisoformat(authenticated_event["occurred_at"])
    assert consumer.event.received_at == datetime.fromisoformat(authenticated_event["received_at"])
    assert consumer.event.ingress_kind is IMEventIngressKind.WEBHOOK
    encrypted_envelope = json.loads(request["body"])
    assert isinstance(encrypted_envelope, dict)
    encrypted_payload = encrypted_envelope["encrypt"]
    assert isinstance(encrypted_payload, str)
    expected_native_payload = feishu_lark._decrypt_webhook_payload(
        encrypted_payload,
        _WEBHOOK_ENCRYPT_KEY,
    ).decode()
    assert consumer.event.payload == expected_native_payload
    assert json.loads(consumer.event.payload) == authenticated_event["payload"]
    assert _LEGACY_WEBHOOK_PAYLOAD_KEY not in consumer.event.payload
    return consumer.event


def _deliver_sanitized_stream(monkeypatch: pytest.MonkeyPatch) -> AuthenticatedIMEvent:
    fixture = json.loads(_STREAM_FIXTURE.read_text(encoding="utf-8"))
    assert isinstance(fixture, dict)
    stream_evidence = fixture["stream"]
    authenticated_event = fixture["authenticated_event"]
    assert isinstance(stream_evidence, dict)
    assert isinstance(authenticated_event, dict)
    assert stream_evidence["callback"] == "register_p2_card_action_trigger"
    assert stream_evidence["object_type"] == (
        "lark_oapi.event.callback.model.p2_card_action_trigger.P2CardActionTrigger"
    )
    serialization = stream_evidence["sdk_serialization"]
    callback_response = stream_evidence["callback_response"]
    assert isinstance(serialization, dict)
    assert isinstance(callback_response, dict)
    assert serialization["method"] == "lark_oapi.JSON.marshal"
    sdk_event_mapping = json.loads(serialization["value"])
    assert isinstance(sdk_event_mapping, dict)
    assert sdk_event_mapping == authenticated_event["payload"]
    sdk_event = P2CardActionTrigger(sdk_event_mapping)
    sdk_event_type = f"{type(sdk_event).__module__}.{type(sdk_event).__qualname__}"
    assert sdk_event_type == stream_evidence["object_type"]
    response_serialization = callback_response["sdk_serialization"]
    assert isinstance(response_serialization, dict)
    assert callback_response["object_type"] == (
        "lark_oapi.event.callback.model.p2_card_action_trigger.P2CardActionTriggerResponse"
    )
    assert response_serialization["method"] == "lark_oapi.JSON.marshal"
    assert json.loads(response_serialization["value"]) == {}

    gateway = _WebhookGateway()
    stream_clients: list[_FixtureSDKObjectStreamClient] = []

    def create_stream_client(
        credentials: feishu_lark.FeishuIMIntegrationCredentials,
        domain: str,
        callback: Callable[[feishu_lark._SDKEventEnvelope, Callable[[], None]], None],
    ) -> _FixtureSDKObjectStreamClient:
        client = _FixtureSDKObjectStreamClient(credentials, domain, callback, sdk_event)
        stream_clients.append(client)
        return client

    monkeypatch.setattr(feishu_lark, "_create_sdk_gateway", lambda _credentials, _domain: gateway)
    monkeypatch.setattr(feishu_lark, "_create_sdk_stream_client", create_stream_client)
    adapter = feishu_lark.FeishuIMProviderAdapter(
        feishu_lark.FeishuIMIntegrationCredentials(
            provider=IMProvider.FEISHU,
            app_id="cli_test_only",
            app_secret="app_secret_test_only",
            verification_token=_WEBHOOK_VERIFICATION_TOKEN,
            encrypt_key=_WEBHOOK_ENCRYPT_KEY,
        )
    )
    consumer = _WebhookConsumer()
    stream = adapter.create_stream_handler(consumer)
    try:
        stream.start()
        stream.stop()
    finally:
        adapter.close()

    assert len(stream_clients) == 1
    stream_client = stream_clients[0]
    assert stream_client.stopped is True
    assert isinstance(stream_client.response, P2CardActionTriggerResponse)
    response_type = f"{type(stream_client.response).__module__}.{type(stream_client.response).__qualname__}"
    assert response_type == callback_response["object_type"]
    assert feishu_lark.lark.JSON.marshal(stream_client.response) == response_serialization["value"]
    assert consumer.event is not None
    assert consumer.event.provider is IMProvider.FEISHU
    assert consumer.event.provider_tenant_id == authenticated_event["provider_tenant_id"]
    assert consumer.event.event_id == authenticated_event["event_id"]
    assert consumer.event.event_type == authenticated_event["event_type"]
    assert consumer.event.occurred_at == datetime.fromisoformat(authenticated_event["occurred_at"])
    assert consumer.event.ingress_kind is IMEventIngressKind.STREAM
    assert json.loads(consumer.event.payload) == sdk_event_mapping
    assert json.loads(consumer.event.payload) == authenticated_event["payload"]
    assert _LEGACY_STREAM_PAYLOAD_KEY not in consumer.event.payload
    assert stream_evidence["object_type"] not in consumer.event.payload
    return consumer.event


def _event(
    callback: dict[str, object] | None = None,
    *,
    provider: IMProvider = IMProvider.FEISHU,
    event_type: str | None = "card.action.trigger",
    ingress_kind: IMEventIngressKind = IMEventIngressKind.WEBHOOK,
    payload: str | None = None,
) -> AuthenticatedIMEvent:
    serialized_payload = payload
    if serialized_payload is None:
        serialized_payload = json.dumps(
            callback if callback is not None else _synthetic_marked_callback(), ensure_ascii=False
        )
    return AuthenticatedIMEvent(
        provider=provider,
        provider_tenant_id="tenant_test_only",
        event_id="evt_test_only",
        event_type=event_type,
        occurred_at=None,
        received_at=_RECEIVED_AT,
        ingress_kind=ingress_kind,
        payload=serialized_payload,
    )


def _form() -> ResolvedForm:
    return ResolvedForm(
        title="Approval request",
        blocks=(
            MarkdownText("Review the generated answer."),
            ParagraphInput("comment", "Looks good"),
            MarkdownText("Choose the release decision."),
            SelectInput("decision", ("ship", "hold"), "hold"),
        ),
        user_actions=(
            ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),
            ResolvedFormAction("reject", "Reject", ButtonStyle.ACCENT),
        ),
        legacy_form_content="This value must not be rendered",
    )


def _callback_action(callback: dict[str, object]) -> dict[str, object]:
    event = callback["event"]
    assert isinstance(event, dict)
    action = event["action"]
    assert isinstance(action, dict)
    return action


def _callback_operator(callback: dict[str, object]) -> dict[str, object]:
    event = callback["event"]
    assert isinstance(event, dict)
    operator = event["operator"]
    assert isinstance(operator, dict)
    return operator


def _synthetic_marked_callback() -> dict[str, object]:
    return {
        "schema": "2.0",
        "header": {"event_type": "card.action.trigger", "tenant_key": "tenant_test_only"},
        "event": {
            "operator": {"union_id": "union_test_only", "open_id": "open_id_must_not_be_used"},
            "action": {
                "tag": "button",
                "name": "approve",
                "value": {
                    _DIFY_ACTION_MARKER: {
                        "version": 1,
                        "action_id": "approve",
                        "correlation_token": "correlation-token-test-only",
                    }
                },
                "form_value": {"comment": "Reviewed", "decision": "ship"},
            },
        },
    }


def test_codec_encodes_the_provider_confirmed_shallow_form_layout() -> None:
    codec = feishu_lark._MSFeishuLarkCardCodec()

    assert codec.assess(_form()) == CardAssessment(representable=True)
    assert codec.encode(_form(), CorrelationToken("correlation-token")) == {
        "schema": "2.0",
        "config": {"update_multi": True},
        "header": {"title": {"tag": "plain_text", "content": "Approval request"}},
        "body": {
            "direction": "vertical",
            "elements": [
                {
                    "tag": "form",
                    "name": "__dify.human_input",
                    "elements": [
                        {"tag": "markdown", "content": "Review the generated answer."},
                        {
                            "tag": "input",
                            "name": "comment",
                            "input_type": "multiline_text",
                            "width": "fill",
                            "required": True,
                            "label": {"tag": "plain_text", "content": "comment"},
                            "placeholder": {"tag": "plain_text", "content": "comment"},
                            "default_value": "Looks good",
                        },
                        {"tag": "markdown", "content": "Choose the release decision."},
                        {
                            "tag": "select_static",
                            "name": "decision",
                            "required": True,
                            "placeholder": {"tag": "plain_text", "content": "decision"},
                            "options": [
                                {"text": {"tag": "plain_text", "content": "ship"}, "value": "ship"},
                                {"text": {"tag": "plain_text", "content": "hold"}, "value": "hold"},
                            ],
                            "initial_option": "hold",
                        },
                        {
                            "tag": "column_set",
                            "flex_mode": "none",
                            "horizontal_spacing": "8px",
                            "horizontal_align": "left",
                            "columns": [
                                {
                                    "tag": "column",
                                    "width": "auto",
                                    "elements": [
                                        {
                                            "tag": "button",
                                            "name": "approve",
                                            "type": "primary_filled",
                                            "text": {"tag": "plain_text", "content": "Approve"},
                                            "form_action_type": "submit",
                                            "behaviors": [
                                                {
                                                    "type": "callback",
                                                    "value": {
                                                        _DIFY_ACTION_MARKER: {
                                                            "version": 1,
                                                            "action_id": "approve",
                                                            "correlation_token": "correlation-token",
                                                        }
                                                    },
                                                }
                                            ],
                                        }
                                    ],
                                },
                                {
                                    "tag": "column",
                                    "width": "auto",
                                    "elements": [
                                        {
                                            "tag": "button",
                                            "name": "reject",
                                            "type": "danger_filled",
                                            "text": {"tag": "plain_text", "content": "Reject"},
                                            "form_action_type": "submit",
                                            "behaviors": [
                                                {
                                                    "type": "callback",
                                                    "value": {
                                                        _DIFY_ACTION_MARKER: {
                                                            "version": 1,
                                                            "action_id": "reject",
                                                            "correlation_token": "correlation-token",
                                                        }
                                                    },
                                                }
                                            ],
                                        }
                                    ],
                                },
                            ],
                        },
                    ],
                }
            ],
        },
    }


def test_codec_rejects_oversized_cards_before_provider_io() -> None:
    codec = feishu_lark._MSFeishuLarkCardCodec()
    oversized = ResolvedForm(
        title=None,
        blocks=(MarkdownText("x" * (31 * 1024)),),
        user_actions=(),
        legacy_form_content="unused",
    )

    assessment = codec.assess(oversized)

    assert assessment.representable is False
    assert assessment.reason == "Feishu/Lark cannot preserve a card beyond the Provider payload limit."
    with pytest.raises(DynamicCardMessagingError, match="Provider payload limit"):
        codec.encode(oversized, CorrelationToken("token"))


@pytest.mark.parametrize(
    ("intent", "expected_reason"),
    [
        (
            ResolvedForm(title=None, blocks=(), user_actions=(), legacy_form_content="unused"),
            "Feishu/Lark cannot preserve an empty card.",
        ),
        (
            ResolvedForm(title=None, blocks=(MarkdownText(""),), user_actions=(), legacy_form_content="unused"),
            "Feishu/Lark cannot preserve an empty Markdown block.",
        ),
        (
            ResolvedForm(
                title=None,
                blocks=(FileInput("attachment", (), (), ()),),
                user_actions=(),
                legacy_form_content="unused",
            ),
            "Feishu/Lark cards cannot represent file inputs.",
        ),
        (
            ResolvedForm(
                title=None,
                blocks=(SelectInput("decision", (), None),),
                user_actions=(),
                legacy_form_content="unused",
            ),
            "Feishu/Lark cannot preserve one select option.",
        ),
        (
            ResolvedForm(
                title=None,
                blocks=(SelectInput("decision", ("",), None),),
                user_actions=(),
                legacy_form_content="unused",
            ),
            "Feishu/Lark cannot preserve one select option.",
        ),
        (
            ResolvedForm(
                title=None,
                blocks=(SelectInput("decision", ("ship", "ship"), None),),
                user_actions=(),
                legacy_form_content="unused",
            ),
            "Feishu/Lark cannot preserve duplicate select options.",
        ),
        (
            ResolvedForm(
                title=None,
                blocks=(ParagraphInput("decision", None), SelectInput("decision", ("ship",), None)),
                user_actions=(),
                legacy_form_content="unused",
            ),
            "Feishu/Lark cannot preserve duplicate card input identifiers.",
        ),
        (
            ResolvedForm(
                title=None,
                blocks=(MarkdownText("Review"),),
                user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.GHOST),),
                legacy_form_content="unused",
            ),
            "Feishu/Lark cannot preserve one card action style.",
        ),
    ],
    ids=(
        "empty-card",
        "empty-markdown",
        "file-input",
        "empty-select",
        "blank-select-option",
        "duplicate-select-options",
        "duplicate-input-name",
        "unsupported-action-style",
    ),
)
def test_codec_rejects_each_unrepresentable_provider_shape(
    intent: ResolvedForm,
    expected_reason: str,
) -> None:
    codec = feishu_lark._MSFeishuLarkCardCodec()

    assessment = codec.assess(intent)

    assert assessment == CardAssessment(representable=False, reason=expected_reason)
    with pytest.raises(DynamicCardMessagingError, match=r"^" + expected_reason.replace(".", r"\.") + r"$"):
        codec.encode(intent, CorrelationToken("token"))


def test_codec_rechecks_wire_size_with_the_actual_correlation_token() -> None:
    codec = feishu_lark._MSFeishuLarkCardCodec()
    intent = ResolvedForm(
        title=None,
        blocks=(MarkdownText("Review"),),
        user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.DEFAULT),),
        legacy_form_content="unused",
    )

    assert codec.assess(intent) == CardAssessment(representable=True)
    with pytest.raises(DynamicCardMessagingError, match="Provider payload limit"):
        codec.encode(intent, CorrelationToken("x" * (31 * 1024)))


@pytest.mark.parametrize(
    "callback",
    [
        {"schema": "1.0", "header": {}, "event": {}},
        {"schema": "2.0", "header": [], "event": {}},
        {
            "schema": "2.0",
            "header": {"event_type": "card.action.trigger"},
            "event": [],
        },
        {
            "schema": "2.0",
            "header": {"event_type": "card.action.trigger"},
            "event": {"action": []},
        },
    ],
    ids=("schema", "header", "event", "action"),
)
def test_transport_discriminated_malformed_recognition_envelopes_fail_strictly(
    callback: dict[str, object],
) -> None:
    with pytest.raises(IMCardEventDecodingError, match="schema is invalid"):
        feishu_lark._MSFeishuLarkCardCodec().decode(_event(callback))


def test_non_object_foreign_action_value_is_unrecognized() -> None:
    callback: dict[str, object] = {
        "schema": "2.0",
        "header": {"event_type": "card.action.trigger"},
        "event": {"action": {"value": []}},
    }

    result = feishu_lark._MSFeishuLarkCardCodec().decode(_event(callback))

    assert isinstance(result, UnrecognizedIMEvent)


@pytest.mark.parametrize(
    ("ingress_kind", "legacy_payload"),
    [
        pytest.param(
            IMEventIngressKind.WEBHOOK,
            {_LEGACY_WEBHOOK_PAYLOAD_KEY: {"encrypted": True, "native_payload": "{}"}},
            id="webhook-wrapper",
        ),
        pytest.param(
            IMEventIngressKind.STREAM,
            {
                _LEGACY_STREAM_PAYLOAD_KEY: {
                    "native_payload": "{}",
                    "object_type": "lark_oapi.event.callback.model.p2_card_action_trigger.P2CardActionTrigger",
                }
            },
            id="stream-wrapper",
        ),
    ],
)
def test_decoder_rejects_legacy_provenance_wrapper(
    ingress_kind: IMEventIngressKind,
    legacy_payload: dict[str, object],
) -> None:
    event = AuthenticatedIMEvent(
        provider=IMProvider.FEISHU,
        provider_tenant_id="tenant_test_only",
        event_id="evt_test_only",
        event_type="card.action.trigger",
        occurred_at=None,
        received_at=_RECEIVED_AT,
        ingress_kind=ingress_kind,
        payload=json.dumps(legacy_payload, ensure_ascii=False),
    )

    with pytest.raises(IMCardEventDecodingError):
        feishu_lark._MSFeishuLarkCardCodec().decode(event)


def test_sanitized_real_webhook_envelope_authenticates_before_card_decoding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    callback_event = _replay_sanitized_webhook(monkeypatch)

    result = feishu_lark._MSFeishuLarkCardCodec().decode(callback_event)

    assert result == IMCardEvent(
        provider_user_id=ProviderUserId("union_test_only"),
        action_id="approve",
        inputs={"comment": "Sanitized callback input", "decision": "ship"},
        correlation_token=CorrelationToken("feishu-lark-card-evidence-token"),
    )


def test_sanitized_real_stream_sdk_delivery_authenticates_before_card_decoding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marshaled_sdk_types: list[type[object]] = []
    sdk_marshal = feishu_lark.lark.JSON.marshal

    def record_sdk_marshal(value: object) -> str | None:
        marshaled_sdk_types.append(type(value))
        return sdk_marshal(value)

    monkeypatch.setattr(feishu_lark.lark.JSON, "marshal", record_sdk_marshal)
    callback_event = _deliver_sanitized_stream(monkeypatch)

    result = feishu_lark._MSFeishuLarkCardCodec().decode(callback_event)

    assert marshaled_sdk_types == [P2CardActionTrigger, P2CardActionTriggerResponse]
    assert result == IMCardEvent(
        provider_user_id=ProviderUserId("union_test_only"),
        action_id="approve",
        inputs={"comment": "Sanitized callback input", "decision": "ship"},
        correlation_token=CorrelationToken("feishu-lark-card-evidence-token"),
    )


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_sanitized_real_callbacks_converge_for_both_provider_discriminators(
    monkeypatch: pytest.MonkeyPatch,
    provider: IMProvider,
) -> None:
    webhook_event = _replay_sanitized_webhook(monkeypatch)
    stream_event = _deliver_sanitized_stream(monkeypatch)
    expected = IMCardEvent(
        provider_user_id=ProviderUserId("union_test_only"),
        action_id="approve",
        inputs={"comment": "Sanitized callback input", "decision": "ship"},
        correlation_token=CorrelationToken("feishu-lark-card-evidence-token"),
    )
    results = tuple(
        feishu_lark._MSFeishuLarkCardCodec().decode(
            AuthenticatedIMEvent(
                provider=provider,
                provider_tenant_id=event.provider_tenant_id,
                event_id=event.event_id,
                event_type=event.event_type,
                occurred_at=event.occurred_at,
                received_at=event.received_at,
                ingress_kind=event.ingress_kind,
                payload=event.payload,
            )
        )
        for event in (webhook_event, stream_event)
    )

    assert results == (expected, expected)
    assert all(isinstance(result, IMCardEvent) for result in results)
    assert all(
        str(result.provider_user_id) != "open_test_only" for result in results if isinstance(result, IMCardEvent)
    )


def test_encode_and_decode_preserve_exact_unicode_and_input_metadata_names() -> None:
    codec = feishu_lark._MSFeishuLarkCardCodec()
    intent = ResolvedForm(
        title="Approval 🌍",
        blocks=(
            ParagraphInput("action_id", None),
            ParagraphInput("correlation_token", None),
            ParagraphInput("version", None),
        ),
        user_actions=(ResolvedFormAction("approve✅", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="unused",
    )
    token = CorrelationToken("correlation-token-🔐")
    encoded = codec.encode(intent, token)
    body = encoded["body"]
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
    column_elements = column["elements"]
    assert isinstance(column_elements, list)
    button = column_elements[0]
    assert isinstance(button, dict)
    behaviors = button["behaviors"]
    assert isinstance(behaviors, list)
    behavior = behaviors[0]
    assert isinstance(behavior, dict)
    metadata = behavior["value"]
    assert isinstance(metadata, dict)

    callback = _synthetic_marked_callback()
    action = _callback_action(callback)
    action["name"] = "approve✅"
    action["value"] = metadata
    action["form_value"] = {
        "action_id": "user action 🧪",
        "correlation_token": "user token value",
        "version": {"nested": [1, None, True]},
    }

    result = codec.decode(_event(callback, provider=IMProvider.LARK))

    assert result == IMCardEvent(
        provider_user_id=ProviderUserId("union_test_only"),
        action_id="approve✅",
        inputs={
            "action_id": "user action 🧪",
            "correlation_token": "user token value",
            "version": {"nested": [1, None, True]},
        },
        correlation_token=token,
    )


def test_exact_private_marker_input_name_remains_isolated_from_action_metadata() -> None:
    codec = feishu_lark._MSFeishuLarkCardCodec()
    token = CorrelationToken("collision-correlation-token")
    intent = ResolvedForm(
        title=None,
        blocks=(ParagraphInput(_DIFY_ACTION_MARKER, None),),
        user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="unused",
    )

    encoded = codec.encode(intent, token)
    body = encoded["body"]
    assert isinstance(body, dict)
    body_elements = body["elements"]
    assert isinstance(body_elements, list)
    form = body_elements[0]
    assert isinstance(form, dict)
    form_elements = form["elements"]
    assert isinstance(form_elements, list)
    input_element = form_elements[0]
    action_row = form_elements[-1]
    assert isinstance(input_element, dict)
    assert isinstance(action_row, dict)
    assert input_element["name"] == _DIFY_ACTION_MARKER
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
    assert metadata == {
        _DIFY_ACTION_MARKER: {
            "version": 1,
            "action_id": "approve",
            "correlation_token": token,
        }
    }

    submitted_value = "input value remains separate"
    callback = _synthetic_marked_callback()
    action = _callback_action(callback)
    action["value"] = metadata
    action["form_value"] = {_DIFY_ACTION_MARKER: submitted_value}

    result = codec.decode(_event(callback))

    assert result == IMCardEvent(
        provider_user_id=ProviderUserId("union_test_only"),
        action_id="approve",
        inputs={_DIFY_ACTION_MARKER: submitted_value},
        correlation_token=token,
    )


@pytest.mark.parametrize(
    "event",
    [
        _event(provider=IMProvider.SLACK, payload="not-json"),
        _event(event_type="im.message.receive_v1", payload="not-json"),
        _event(
            {
                "schema": "2.0",
                "header": {"event_type": "card.action.trigger"},
                "event": {"action": {"tag": "button", "name": "foreign", "value": {"foreign": True}}},
            }
        ),
    ],
    ids=("foreign-provider", "non-card-event-type", "foreign-card-action"),
)
def test_non_applicable_or_foreign_events_are_unrecognized(event: AuthenticatedIMEvent) -> None:
    result = feishu_lark._MSFeishuLarkCardCodec().decode(event)

    assert isinstance(result, UnrecognizedIMEvent)


@pytest.mark.parametrize(
    "foreign_action_value",
    [
        {"version": 1},
        {"action_id": "approve"},
        {"correlation_token": "foreign-token"},
        {"version": 1, "action_id": "approve", "correlation_token": "foreign-token"},
    ],
    ids=("version", "action-id", "correlation-token", "complete-legacy-triple"),
)
def test_foreign_generic_action_metadata_is_not_a_dify_marker(
    foreign_action_value: dict[str, object],
) -> None:
    callback = _synthetic_marked_callback()
    action = _callback_action(callback)
    action["value"] = foreign_action_value

    result = feishu_lark._MSFeishuLarkCardCodec().decode(_event(callback))

    assert isinstance(result, UnrecognizedIMEvent)


@pytest.mark.parametrize(
    "marked_action_value",
    [
        {_DIFY_ACTION_MARKER: None},
        {_DIFY_ACTION_MARKER: {}},
        {_DIFY_ACTION_MARKER: {"version": 1, "action_id": "approve"}},
    ],
    ids=("non-object-marker", "empty-marker", "missing-correlation-token"),
)
def test_exact_dify_marker_enables_strict_submission_validation(
    marked_action_value: dict[str, object],
) -> None:
    callback = _synthetic_marked_callback()
    _callback_action(callback)["value"] = marked_action_value

    with pytest.raises(IMCardEventDecodingError, match=r"^Feishu/Lark card event schema is invalid\.$"):
        feishu_lark._MSFeishuLarkCardCodec().decode(_event(callback))


@pytest.mark.parametrize("payload", ["not-json", "[]", '{"unsafe":NaN}'])
def test_transport_discriminated_invalid_json_fails_safely(payload: str) -> None:
    with pytest.raises(
        IMCardEventDecodingError,
        match=r"^Feishu/Lark card event payload is invalid\.$",
    ) as raised:
        feishu_lark._MSFeishuLarkCardCodec().decode(_event(payload=payload))

    assert raised.value.__cause__ is None
    assert raised.value.__context__ is None


def _without(callback: dict[str, object], path: tuple[str, ...]) -> None:
    current = callback
    for segment in path[:-1]:
        child = current[segment]
        assert isinstance(child, dict)
        current = child
    current.pop(path[-1])


@pytest.mark.parametrize(
    ("path", "replacement"),
    [
        (("header", "event_type"), "foreign.event"),
        (("event", "operator", "union_id"), ""),
        (("event", "operator", "union_id"), True),
        (("event", "action", "tag"), "select_static"),
        (("event", "action", "name"), "reject"),
        (("event", "action", "form_value"), ["sensitive-submitted-input"]),
        (("event", "action", "value", _DIFY_ACTION_MARKER, "version"), 2),
        (("event", "action", "value", _DIFY_ACTION_MARKER, "action_id"), "reject"),
        (("event", "action", "value", _DIFY_ACTION_MARKER, "correlation_token"), None),
    ],
    ids=(
        "payload-event-type",
        "empty-union-id",
        "typed-union-id",
        "action-tag",
        "outer-action-id",
        "form-values",
        "metadata-version",
        "embedded-action-id",
        "correlation-token",
    ),
)
def test_recognized_callbacks_fail_strictly_without_exposing_callback_values(
    path: tuple[str, ...],
    replacement: object,
) -> None:
    callback = _synthetic_marked_callback()
    current = callback
    for segment in path[:-1]:
        child = current[segment]
        assert isinstance(child, dict)
        current = child
    current[path[-1]] = replacement
    action = _callback_action(callback)
    if path != ("event", "action", "form_value"):
        action["form_value"] = {"comment": "sensitive-submitted-input"}

    with pytest.raises(
        IMCardEventDecodingError,
        match=r"^Feishu/Lark card event schema is invalid\.$",
    ) as raised:
        feishu_lark._MSFeishuLarkCardCodec().decode(_event(callback))

    diagnostic = repr(raised.value) + str(raised.value) + repr(raised.value.args) + repr(raised.value.__dict__)
    assert "sensitive-submitted-input" not in diagnostic
    assert "correlation-token-test-only" not in diagnostic
    assert "open_id_must_not_be_used" not in diagnostic
    assert raised.value.__cause__ is None
    assert raised.value.__context__ is None


@pytest.mark.parametrize(
    "path",
    [
        ("event", "operator"),
        ("event", "operator", "union_id"),
        ("event", "action", "form_value"),
        ("event", "action", "value", _DIFY_ACTION_MARKER, "action_id"),
        ("event", "action", "value", _DIFY_ACTION_MARKER, "correlation_token"),
    ],
    ids=("operator", "union-id", "form-values", "action-id", "correlation-token"),
)
def test_recognized_callbacks_reject_missing_required_facts(path: tuple[str, ...]) -> None:
    callback = _synthetic_marked_callback()
    _without(callback, path)

    with pytest.raises(IMCardEventDecodingError, match="schema is invalid"):
        feishu_lark._MSFeishuLarkCardCodec().decode(_event(callback))


def test_decoder_discovery_is_credential_free_concurrent_and_lifecycle_independent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reject_gateway_creation(*_args: object) -> object:
        raise AssertionError("decoder discovery must not construct a Provider client")

    monkeypatch.setattr(feishu_lark, "_create_sdk_gateway", reject_gateway_creation)
    feishu_decoder = feishu_lark.FeishuIMProviderAdapter.card_event_decoder()
    lark_decoder = feishu_lark.LarkIMProviderAdapter.card_event_decoder()
    callback = _synthetic_marked_callback()

    assert isinstance(feishu_decoder, feishu_lark._MSFeishuLarkCardCodec)
    assert isinstance(lark_decoder, feishu_lark._MSFeishuLarkCardCodec)
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = tuple(executor.map(feishu_decoder.decode, (_event(callback) for _ in range(64))))

    assert len(results) == 64
    assert isinstance(results[0], IMCardEvent)
    assert all(result == results[0] for result in results)


def test_decoder_remains_usable_after_differently_credentialed_root_adapters_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway_constructions: list[str] = []

    def record_gateway(_credentials: object, domain: str) -> object:
        gateway_constructions.append(domain)
        return object()

    monkeypatch.setattr(feishu_lark, "_create_sdk_gateway", record_gateway)
    decoder = feishu_lark.FeishuIMProviderAdapter.card_event_decoder()
    feishu_root = feishu_lark.FeishuIMProviderAdapter(
        feishu_lark.FeishuIMIntegrationCredentials(
            provider=IMProvider.FEISHU,
            app_id="first-credential-set",
            app_secret="first-secret",
            verification_token="first-verification-token",
            encrypt_key="first-encrypt-key",
        )
    )
    rotated_feishu_root = feishu_lark.FeishuIMProviderAdapter(
        feishu_lark.FeishuIMIntegrationCredentials(
            provider=IMProvider.FEISHU,
            app_id="rotated-credential-set",
            app_secret="rotated-secret",
            verification_token="rotated-verification-token",
            encrypt_key="rotated-encrypt-key",
        )
    )
    lark_root = feishu_lark.LarkIMProviderAdapter(
        feishu_lark.LarkIMIntegrationCredentials(
            provider=IMProvider.LARK,
            app_id="lark-credential-set",
            app_secret="lark-secret",
            verification_token="lark-verification-token",
            encrypt_key="lark-encrypt-key",
        )
    )
    for root in (feishu_root, rotated_feishu_root, lark_root):
        root.close()

    def reject_gateway_creation(*_args: object) -> object:
        raise AssertionError("decoder use must not construct a Provider client")

    monkeypatch.setattr(feishu_lark, "_create_sdk_gateway", reject_gateway_creation)

    result = decoder.decode(_event(_synthetic_marked_callback()))

    assert result == IMCardEvent(
        provider_user_id=ProviderUserId("union_test_only"),
        action_id="approve",
        inputs={"comment": "Reviewed", "decision": "ship"},
        correlation_token=CorrelationToken("correlation-token-test-only"),
    )
    assert len(gateway_constructions) == 3
    with pytest.raises(RuntimeError, match="adapter is closed"):
        _ = feishu_root.provider


def test_decoder_discovery_and_decode_do_not_cross_runtime_dependency_boundaries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reject_dependency_call(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("decoder path crossed a credential or Provider client boundary")

    dependency_seam_names = {
        "FeishuIMIntegrationCredentials",
        "LarkIMIntegrationCredentials",
        "_FeishuLarkIMIntegrationCredentials",
        "_OfficialSDKGateway",
        "_OfficialSDKStreamClient",
        "_PerClientSDKWSClient",
        "_SynchronousEventChannel",
        "_create_sdk_gateway",
        "_create_sdk_stream_client",
    }
    for seam_name in dependency_seam_names:
        monkeypatch.setattr(feishu_lark, seam_name, reject_dependency_call)
    for seam_name in dependency_seam_names:
        guarded_seam = getattr(feishu_lark, seam_name)
        assert guarded_seam is reject_dependency_call
        with pytest.raises(AssertionError, match="credential or Provider client boundary"):
            guarded_seam()
    imported_modules: list[str] = []
    delegated_imports: list[str] = []
    executed_modules: list[str] = []
    original_import = builtins.__import__
    original_profile = sys.getprofile()

    forbidden_module_prefixes = (
        "models.human_input",
        "services.human_input",
        "core.workflow",
        "core.human_input_v2.approval",
        "core.human_input_v2.contact_directory",
        "core.human_input_v2.im_integration.binding",
        "repositories",
    )
    current_dependency_prefixes = {
        "core.human_input_v2.approval",
        "core.human_input_v2.contact_directory",
        "core.human_input_v2.im_integration.binding",
    }
    assert current_dependency_prefixes.issubset(forbidden_module_prefixes)

    def audit_import(
        name: str,
        globals: dict[str, object] | None = None,
        locals: dict[str, object] | None = None,
        fromlist: tuple[str, ...] = (),
        level: int = 0,
    ) -> object:
        import_names = [name]
        package = globals.get("__package__") if globals is not None else None
        if level > 0 and isinstance(package, str) and package:
            resolved_name = resolve_name(f"{'.' * level}{name}", package)
            if resolved_name != name:
                import_names.append(resolved_name)
        imported_modules.extend(import_names)
        for import_name in import_names:
            if import_name.startswith(forbidden_module_prefixes):
                raise AssertionError(f"decoder path imported forbidden module family: {import_name}")
        delegated_imports.extend(import_names)
        return original_import(name, globals, locals, fromlist, level)

    def audit_runtime_frame(frame: FrameType, event: str, _arg: object) -> None:
        if event != "call":
            return
        module_name = frame.f_globals.get("__name__")
        if not isinstance(module_name, str):
            return
        executed_modules.append(module_name)
        if module_name.startswith(forbidden_module_prefixes):
            raise AssertionError(f"decoder path executed forbidden module family: {module_name}")

    def run_with_runtime_audit(operation: Callable[[], object]) -> object:
        previous_profile = sys.getprofile()
        sys.setprofile(audit_runtime_frame)
        try:
            return operation()
        finally:
            sys.setprofile(previous_profile)

    # Package aggregation may have loaded these modules before observation; the
    # boundary is that decoder discovery and decode must neither import them
    # again nor enter runtime frames owned by them.
    monkeypatch.setattr(builtins, "__import__", audit_import)
    try:
        for module_prefix in current_dependency_prefixes:
            with pytest.raises(AssertionError, match="imported forbidden module family"):
                builtins.__import__(module_prefix)
        assert not delegated_imports

        with pytest.raises(AssertionError, match="imported forbidden module family"):
            builtins.__import__("", {"__package__": "core.human_input_v2.approval"}, {}, (), 1)
        assert imported_modules[-2:] == ["", "core.human_input_v2.approval"]
        assert not delegated_imports
        imported_modules.clear()

        def no_op() -> None:
            return None

        forbidden_no_op = FunctionType(
            no_op.__code__,
            {"__name__": "core.human_input_v2.approval.sentinel"},
        )
        with pytest.raises(AssertionError, match="executed forbidden module family"):
            run_with_runtime_audit(forbidden_no_op)
        assert sys.getprofile() is original_profile
        executed_modules.clear()

        def discover_and_decode() -> object:
            decoder = feishu_lark.FeishuIMProviderAdapter.card_event_decoder()
            return decoder.decode(_event(_synthetic_marked_callback()))

        result = run_with_runtime_audit(discover_and_decode)
    finally:
        monkeypatch.setattr(builtins, "__import__", original_import)

    assert isinstance(result, IMCardEvent)
    assert builtins.__import__ is original_import
    assert sys.getprofile() is original_profile
    assert all(not name.startswith(forbidden_module_prefixes) for name in imported_modules)
    assert all(not name.startswith(forbidden_module_prefixes) for name in executed_modules)
    assert feishu_lark.__name__ in executed_modules


def test_open_id_is_never_used_when_union_id_is_unavailable() -> None:
    callback = _synthetic_marked_callback()
    _callback_operator(callback).pop("union_id")

    with pytest.raises(IMCardEventDecodingError, match="schema is invalid"):
        feishu_lark._MSFeishuLarkCardCodec().decode(_event(callback))
