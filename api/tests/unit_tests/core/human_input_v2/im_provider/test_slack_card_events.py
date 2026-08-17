from __future__ import annotations

import json
import sys
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import pytest

from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ParagraphInput, ResolvedForm, ResolvedFormAction, SelectInput
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import slack as slack_module
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter, _SlackCardCodec
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    CorrelationToken,
    IMCardEvent,
    IMCardEventDecodingError,
    IMEventIngressKind,
    ProviderUserId,
    UnrecognizedIMEvent,
)

_FIXTURE_DIRECTORY = Path(__file__).with_name("fixtures")
_WEBHOOK_FIXTURE = _FIXTURE_DIRECTORY / "slack_block_actions_webhook.json"
_SOCKET_MODE_FIXTURE = _FIXTURE_DIRECTORY / "slack_block_actions_socket_mode.json"
_LIVE_CAPTURE_SOCKET_MODE_FIXTURE = _FIXTURE_DIRECTORY / "slack_block_actions_live_capture_socket_mode.json"
_STATIC_SELECT_INTERACTION_FIXTURE = _FIXTURE_DIRECTORY / "slack_block_actions_static_select_socket_mode.json"
_RADIO_BUTTONS_INTERACTION_FIXTURE = _FIXTURE_DIRECTORY / "slack_block_actions_radio_buttons_webhook.json"
_RECEIVED_AT = datetime(2026, 8, 11, 12, 0, 0)


def _fixture(path: Path) -> dict[str, object]:
    decoded = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(decoded, dict)
    return decoded


def _event(
    callback: dict[str, object],
    *,
    provider: IMProvider = IMProvider.SLACK,
    event_type: str = "block_actions",
    ingress_kind: IMEventIngressKind = IMEventIngressKind.WEBHOOK,
) -> AuthenticatedIMEvent:
    return AuthenticatedIMEvent(
        provider=provider,
        provider_tenant_id="T012SANITIZED",
        event_id=None,
        event_type=event_type,
        occurred_at=None,
        received_at=_RECEIVED_AT,
        ingress_kind=ingress_kind,
        payload=json.dumps(callback, ensure_ascii=False, sort_keys=True),
    )


def _form() -> ResolvedForm:
    return ResolvedForm(
        title="Approval",
        blocks=(
            MarkdownText("Review the response."),
            ParagraphInput("说明📝", "初始值"),
            SelectInput("选择🌐", ("选项 α", "选项 β"), "选项 β"),
        ),
        user_actions=(ResolvedFormAction("批准✅", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="unused",
    )


def _message_blocks(callback: dict[str, object]) -> list[dict[str, object]]:
    message = callback["message"]
    assert isinstance(message, dict)
    blocks = message["blocks"]
    assert isinstance(blocks, list)
    assert all(isinstance(block, dict) for block in blocks)
    return blocks


def _input_blocks(callback: dict[str, object]) -> list[dict[str, object]]:
    return [block for block in _message_blocks(callback) if block.get("type") == "input"]


def _state_values(callback: dict[str, object]) -> dict[str, object]:
    state = callback["state"]
    assert isinstance(state, dict)
    values = state["values"]
    assert isinstance(values, dict)
    return values


def _event_with_raw_json_extra(raw_json_value: str) -> AuthenticatedIMEvent:
    callback = _fixture(_WEBHOOK_FIXTURE)
    serialized_callback = json.dumps(callback, ensure_ascii=False, sort_keys=True)
    assert serialized_callback.endswith("}")
    return AuthenticatedIMEvent(
        provider=IMProvider.SLACK,
        provider_tenant_id="T012SANITIZED",
        event_id=None,
        event_type="block_actions",
        occurred_at=None,
        received_at=_RECEIVED_AT,
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload=f'{serialized_callback[:-1]},"ignored_extra":{raw_json_value}}}',
    )


def test_sender_renders_dify_namespaced_form_structure() -> None:
    codec = _SlackCardCodec()
    encoded = codec.encode(_form(), CorrelationToken("关联令牌-🌍"))
    repeated = codec.encode(_form(), CorrelationToken("关联令牌-🌍"))

    assert set(encoded) == {"blocks"}
    blocks = encoded["blocks"]
    assert isinstance(blocks, list)
    input_blocks = [block for block in blocks if block["type"] == "input"]
    assert len(input_blocks) == 2
    assert [block["block_id"] for block in input_blocks] == ["__dify.input.0", "__dify.input.1"]
    assert [block["element"]["action_id"] for block in input_blocks] == ["说明📝", "选择🌐"]
    assert input_blocks[0]["element"] == {
        "action_id": "说明📝",
        "type": "plain_text_input",
        "multiline": True,
        "initial_value": "初始值",
    }
    assert input_blocks[1]["element"] == {
        "action_id": "选择🌐",
        "type": "static_select",
        "placeholder": {"type": "plain_text", "text": "Select an option"},
        "options": [
            {"text": {"type": "plain_text", "text": "选项 α"}, "value": "选项 α"},
            {"text": {"type": "plain_text", "text": "选项 β"}, "value": "选项 β"},
        ],
        "initial_option": {"text": {"type": "plain_text", "text": "选项 β"}, "value": "选项 β"},
    }

    actions_block = next(block for block in blocks if block["type"] == "actions")
    assert actions_block["block_id"] == "__dify.actions"
    action = actions_block["elements"][0]
    assert action["action_id"] == "批准✅"
    assert json.loads(action["value"]) == {
        "version": 1,
        "action_id": "批准✅",
        "correlation_token": "关联令牌-🌍",
    }
    assert repeated == encoded


def test_sender_static_select_has_provider_owned_placeholder() -> None:
    encoded = _SlackCardCodec().encode(_form(), CorrelationToken("token"))
    blocks = encoded["blocks"]
    assert isinstance(blocks, list)
    selection_element = next(
        block["element"] for block in blocks if block["type"] == "input" and block["element"]["action_id"] == "选择🌐"
    )

    placeholder = selection_element.get("placeholder")
    assert isinstance(placeholder, dict)
    assert placeholder == {"type": "plain_text", "text": "Select an option"}
    assert len(placeholder["text"]) <= 150


def test_encode_relies_on_the_callers_representability_precondition() -> None:
    codec = _SlackCardCodec()
    empty_form = ResolvedForm(
        title=None,
        blocks=(),
        user_actions=(),
        legacy_form_content="unused",
    )

    assert codec.assess(empty_form).representable is False
    assert codec.encode(empty_form, CorrelationToken("token")) == {"blocks": []}


def test_webhook_and_socket_mode_callbacks_converge_with_exact_unicode_round_trip() -> None:
    decoder = SlackIMProviderAdapter.card_event_decoder()

    webhook_result = decoder.decode(_event(_fixture(_WEBHOOK_FIXTURE)))
    socket_result = decoder.decode(_event(_fixture(_SOCKET_MODE_FIXTURE), ingress_kind=IMEventIngressKind.STREAM))

    expected = IMCardEvent(
        provider_user_id=ProviderUserId("U012SANITIZED"),
        action_id="批准✅",
        inputs={"说明📝": "你好，世界 🌍", "选择🌐": "选项 β"},
        correlation_token=CorrelationToken("关联令牌-🌍"),
    )
    assert webhook_result == expected
    assert socket_result == expected


@pytest.mark.parametrize(
    ("fixture_path", "declared_ingress_kind"),
    [
        pytest.param(_SOCKET_MODE_FIXTURE, IMEventIngressKind.WEBHOOK, id="socket-envelope-as-webhook"),
        pytest.param(_WEBHOOK_FIXTURE, IMEventIngressKind.STREAM, id="webhook-root-as-stream"),
    ],
)
def test_decoder_rejects_declared_ingress_payload_mismatch(
    fixture_path: Path,
    declared_ingress_kind: IMEventIngressKind,
) -> None:
    event = _event(_fixture(fixture_path), ingress_kind=declared_ingress_kind)

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(event)


def test_real_socket_mode_callback_capture_decodes_with_exact_unicode_round_trip() -> None:
    assert _LIVE_CAPTURE_SOCKET_MODE_FIXTURE.exists()

    decoded = _SlackCardCodec().decode(
        _event(_fixture(_LIVE_CAPTURE_SOCKET_MODE_FIXTURE), ingress_kind=IMEventIngressKind.STREAM)
    )

    assert decoded == IMCardEvent(
        provider_user_id=ProviderUserId("U012SANITIZED"),
        action_id="批准✅",
        inputs={"说明📝": "你好，世界 🌍", "选择🌐": "选项 β"},
        correlation_token=CorrelationToken("关联令牌-🌍"),
    )


def test_real_socket_mode_callback_capture_sanitizes_provider_generated_block_ids() -> None:
    callback = _fixture(_LIVE_CAPTURE_SOCKET_MODE_FIXTURE)
    payload = callback["payload"]
    assert isinstance(payload, dict)
    message = payload["message"]
    assert isinstance(message, dict)
    blocks = message["blocks"]
    assert isinstance(blocks, list)

    provider_generated_block_ids = [
        block["block_id"]
        for block in blocks
        if isinstance(block, dict)
        and isinstance(block.get("block_id"), str)
        and not block["block_id"].startswith("__dify.")
    ]
    assert len(provider_generated_block_ids) == 2
    assert all(block_id == "slack-generated-block-id" for block_id in provider_generated_block_ids)


@pytest.mark.parametrize(
    ("fixture_path", "ingress_kind"),
    [
        pytest.param(_STATIC_SELECT_INTERACTION_FIXTURE, IMEventIngressKind.STREAM, id="static-select"),
        pytest.param(_RADIO_BUTTONS_INTERACTION_FIXTURE, IMEventIngressKind.WEBHOOK, id="radio-buttons"),
    ],
)
def test_selection_change_block_actions_are_unrecognized(
    fixture_path: Path,
    ingress_kind: IMEventIngressKind,
) -> None:
    result = SlackIMProviderAdapter.card_event_decoder().decode(
        _event(_fixture(fixture_path), ingress_kind=ingress_kind)
    )

    assert isinstance(result, UnrecognizedIMEvent)


def test_non_dify_button_block_actions_is_unrecognized_without_full_dify_schema() -> None:
    callback = {
        "type": "block_actions",
        "actions": [
            {
                "type": "button",
                "block_id": "foreign.actions",
                "action_id": "foreign_action",
                "value": "foreign-value",
            }
        ],
    }

    result = SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))

    assert isinstance(result, UnrecognizedIMEvent)


@pytest.mark.parametrize(
    "callback",
    [
        pytest.param({"type": "block_actions"}, id="missing-actions"),
        pytest.param({"type": "block_actions", "actions": []}, id="empty-actions"),
        pytest.param(
            {"type": "block_actions", "actions": [None, 42, "foreign-action", {}]},
            id="non-object-actions-without-dify-marker",
        ),
        pytest.param(
            {"type": "block_actions", "actions": [{"block_id": "__dify.actions.legacy"}]},
            id="near-dify-action-block-id",
        ),
    ],
)
def test_block_actions_without_any_dify_submission_marker_are_unrecognized(
    callback: dict[str, object],
) -> None:
    result = SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))

    assert isinstance(result, UnrecognizedIMEvent)


@pytest.mark.parametrize(
    ("action_type", "action_value"),
    [
        pytest.param("static_select", None, id="wrong-action-type-without-value"),
        pytest.param("button", {"unexpected": "object"}, id="wrong-action-value-type"),
    ],
)
def test_dify_submission_marker_enables_strict_action_validation(
    action_type: str,
    action_value: object,
) -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    actions = callback["actions"]
    assert isinstance(actions, list)
    action = actions[0]
    assert isinstance(action, dict)
    action["type"] = action_type
    if action_value is None:
        action.pop("value")
    else:
        action["value"] = action_value

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_zero_input_callback_may_omit_state() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    message_blocks = _message_blocks(callback)
    message_blocks[:] = [block for block in message_blocks if block.get("type") != "input"]
    callback.pop("state")

    decoded = SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))

    assert decoded == IMCardEvent(
        provider_user_id=ProviderUserId("U012SANITIZED"),
        action_id="批准✅",
        inputs={},
        correlation_token=CorrelationToken("关联令牌-🌍"),
    )


def test_zero_input_callback_may_have_empty_state() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    message_blocks = _message_blocks(callback)
    message_blocks[:] = [block for block in message_blocks if block.get("type") != "input"]
    callback["state"] = {"values": {}}

    decoded = SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))

    assert isinstance(decoded, IMCardEvent)
    assert decoded.inputs == {}


def test_decoder_rejects_state_missing_one_expected_input() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    _state_values(callback).pop("__dify.input.1")

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_rejects_non_input_message_block_claiming_reserved_input_id() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    input_block = _input_blocks(callback)[1]
    input_block["type"] = "section"
    _state_values(callback).pop("__dify.input.1")

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_rejects_non_actions_message_block_claiming_reserved_actions_id() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    actions_block = next(block for block in _message_blocks(callback) if block.get("type") == "actions")
    actions_block["type"] = "section"

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_rejects_message_without_sender_owned_actions_block() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    message_blocks = _message_blocks(callback)
    message_blocks[:] = [block for block in message_blocks if block.get("type") != "actions"]

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_rejects_invoked_action_missing_from_sender_owned_actions_block() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    actions_block = next(block for block in _message_blocks(callback) if block.get("type") == "actions")
    elements = actions_block["elements"]
    assert isinstance(elements, list)
    button = elements[0]
    assert isinstance(button, dict)
    button["action_id"] = "other-action"
    metadata = json.loads(button["value"])
    assert isinstance(metadata, dict)
    metadata["action_id"] = "other-action"
    button["value"] = json.dumps(metadata)

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


@pytest.mark.parametrize(
    "foreign_block_id",
    [
        pytest.param("__dify.input.legacy", id="input-near-id"),
        pytest.param("__dify.input.01", id="input-noncanonical-ordinal"),
        pytest.param("__dify.actions.legacy", id="actions-near-id"),
    ],
)
def test_decoder_allows_near_reserved_id_on_foreign_message_block(foreign_block_id: str) -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    _message_blocks(callback).insert(0, {"type": "section", "block_id": foreign_block_id})

    decoded = SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))

    assert isinstance(decoded, IMCardEvent)
    assert decoded.inputs == {"说明📝": "你好，世界 🌍", "选择🌐": "选项 β"}


def test_decoder_rejects_extra_dify_input_state() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    _state_values(callback)["__dify.input.2"] = {"unexpected": {"type": "plain_text_input", "value": "unexpected"}}

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_rejects_state_action_id_mismatched_with_message_schema() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    text_state = _state_values(callback)["__dify.input.0"]
    assert isinstance(text_state, dict)
    text_state["renamed"] = text_state.pop("说明📝")

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_rejects_unexpected_non_dify_state() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    _state_values(callback)["unrelated.block"] = {
        "unrelated": {"type": "checkboxes", "selected_options": [{"value": "external"}]}
    }

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_rejects_malformed_dify_input_block_id_in_message_schema() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    _input_blocks(callback)[0]["block_id"] = "__dify.input.legacy"

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_rejects_input_block_id_not_matching_form_ordinal() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    _input_blocks(callback)[0]["block_id"] = "__dify.input.2"
    state_values = _state_values(callback)
    state_values["__dify.input.2"] = state_values.pop("__dify.input.0")

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_rejects_input_block_with_non_dify_block_id() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    input_block = _input_blocks(callback)[0]
    block_id = input_block["block_id"]
    assert isinstance(block_id, str)
    input_block["block_id"] = "external.block"
    _state_values(callback).pop(block_id)

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_rejects_input_block_without_block_id() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    input_block = _input_blocks(callback)[0]
    block_id = input_block.pop("block_id")
    assert isinstance(block_id, str)
    _state_values(callback).pop(block_id)

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_rejects_empty_expected_input_action_id() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    element = _input_blocks(callback)[0]["element"]
    assert isinstance(element, dict)
    element["action_id"] = ""

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_rejects_duplicate_expected_input_action_ids() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    element = _input_blocks(callback)[1]["element"]
    assert isinstance(element, dict)
    element["action_id"] = "说明📝"

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_rejects_state_type_mismatched_with_message_schema() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    element = _input_blocks(callback)[0]["element"]
    assert isinstance(element, dict)
    element["type"] = "static_select"

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_normalizes_explicit_null_text_input() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    text_state = _state_values(callback)["__dify.input.0"]
    assert isinstance(text_state, dict)
    text_element_state = text_state["说明📝"]
    assert isinstance(text_element_state, dict)
    text_element_state["value"] = None

    decoded = SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))

    assert isinstance(decoded, IMCardEvent)
    assert decoded.inputs == {"说明📝": None, "选择🌐": "选项 β"}


def test_decoder_normalizes_static_select_value() -> None:
    decoded = SlackIMProviderAdapter.card_event_decoder().decode(_event(_fixture(_WEBHOOK_FIXTURE)))

    assert isinstance(decoded, IMCardEvent)
    assert decoded.inputs["选择🌐"] == "选项 β"


def test_decoder_normalizes_explicit_null_static_select_selection() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    select_state = _state_values(callback)["__dify.input.1"]
    assert isinstance(select_state, dict)
    select_element_state = select_state["选择🌐"]
    assert isinstance(select_element_state, dict)
    select_element_state["selected_option"] = None

    decoded = SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))

    assert isinstance(decoded, IMCardEvent)
    assert decoded.inputs == {"说明📝": "你好，世界 🌍", "选择🌐": None}


def test_decoder_rejects_radio_buttons_wire_schema() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    select_element = _input_blocks(callback)[1]["element"]
    assert isinstance(select_element, dict)
    select_element["type"] = "radio_buttons"
    select_state = _state_values(callback)["__dify.input.1"]
    assert isinstance(select_state, dict)
    select_element_state = select_state["选择🌐"]
    assert isinstance(select_element_state, dict)
    select_element_state["type"] = "radio_buttons"

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_is_class_level_stateless_and_concurrent() -> None:
    decoder = SlackIMProviderAdapter.card_event_decoder()
    event = _event(_fixture(_WEBHOOK_FIXTURE))

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = tuple(executor.map(decoder.decode, (event,) * 32))

    assert all(result == results[0] for result in results)


def test_slack_card_implementation_has_one_module_owner() -> None:
    source_path = Path(slack_module.__file__)

    assert not source_path.with_name("slack_card_events.py").exists()
    assert "slack_card_events" not in source_path.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("provider", "event_type"),
    [
        (IMProvider.SLACK, "message"),
        (IMProvider.MS_TEAMS, "block_actions"),
    ],
)
def test_authenticated_non_card_events_are_unrecognized(provider: IMProvider, event_type: str) -> None:
    event = AuthenticatedIMEvent(
        provider=provider,
        provider_tenant_id="tenant",
        event_id=None,
        event_type=event_type,
        occurred_at=None,
        received_at=_RECEIVED_AT,
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload="not parsed for non-card events",
    )

    result = SlackIMProviderAdapter.card_event_decoder().decode(event)

    assert isinstance(result, UnrecognizedIMEvent)


def test_recognized_card_with_invalid_json_raises_safe_error() -> None:
    sensitive_marker = "sensitive-callback-marker"
    event = AuthenticatedIMEvent(
        provider=IMProvider.SLACK,
        provider_tenant_id="tenant",
        event_id=None,
        event_type="block_actions",
        occurred_at=None,
        received_at=_RECEIVED_AT,
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload=f'{{"submitted":"{sensitive_marker}"',
    )

    with pytest.raises(IMCardEventDecodingError) as captured:
        SlackIMProviderAdapter.card_event_decoder().decode(event)

    error = captured.value
    assert sensitive_marker not in str(error)
    assert sensitive_marker not in repr(error)
    assert vars(error) == {}
    assert error.__cause__ is None
    assert error.__context__ is None


@pytest.mark.parametrize(
    ("fixture_path", "ingress_kind", "non_finite_value"),
    [
        pytest.param(_WEBHOOK_FIXTURE, IMEventIngressKind.WEBHOOK, float("nan"), id="webhook-nan"),
        pytest.param(_WEBHOOK_FIXTURE, IMEventIngressKind.WEBHOOK, float("inf"), id="webhook-infinity"),
        pytest.param(_WEBHOOK_FIXTURE, IMEventIngressKind.WEBHOOK, float("-inf"), id="webhook-negative-infinity"),
        pytest.param(_SOCKET_MODE_FIXTURE, IMEventIngressKind.STREAM, float("nan"), id="socket-nan"),
        pytest.param(_SOCKET_MODE_FIXTURE, IMEventIngressKind.STREAM, float("inf"), id="socket-infinity"),
        pytest.param(_SOCKET_MODE_FIXTURE, IMEventIngressKind.STREAM, float("-inf"), id="socket-negative-infinity"),
    ],
)
def test_recognized_card_rejects_non_finite_json_constants(
    fixture_path: Path,
    ingress_kind: IMEventIngressKind,
    non_finite_value: float,
) -> None:
    sensitive_marker = "non-finite-sensitive-marker"
    callback = _fixture(fixture_path)
    callback["ignored_extra"] = {"number": non_finite_value, "marker": sensitive_marker}

    with pytest.raises(IMCardEventDecodingError) as captured:
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback, ingress_kind=ingress_kind))

    assert sensitive_marker not in str(captured.value)
    assert sensitive_marker not in repr(captured.value)


@pytest.mark.parametrize(
    "raw_json_value",
    [
        pytest.param("1" * (sys.get_int_max_str_digits() + 1), id="oversized-integer"),
        pytest.param(
            "[" * (sys.getrecursionlimit() * 20) + "null" + "]" * (sys.getrecursionlimit() * 20),
            id="excessive-nesting",
        ),
    ],
)
def test_recognized_card_maps_json_parser_implementation_limits_to_safe_error(raw_json_value: str) -> None:
    with pytest.raises(IMCardEventDecodingError) as captured:
        SlackIMProviderAdapter.card_event_decoder().decode(_event_with_raw_json_extra(raw_json_value))

    error = captured.value
    assert vars(error) == {}
    assert error.__cause__ is None
    assert error.__context__ is None


@pytest.mark.parametrize("raw_json_value", ["1e400", "-1e400"])
def test_recognized_card_rejects_exponents_that_decode_to_non_finite_floats(raw_json_value: str) -> None:
    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event_with_raw_json_extra(raw_json_value))


def test_recognized_card_accepts_json_safe_finite_exponent() -> None:
    decoded = SlackIMProviderAdapter.card_event_decoder().decode(_event_with_raw_json_extra("1e300"))

    assert isinstance(decoded, IMCardEvent)
    assert decoded.inputs == {"说明📝": "你好，世界 🌍", "选择🌐": "选项 β"}


def _remove_actor(callback: dict[str, object]) -> None:
    callback.pop("user")


def _set_wrong_actor_type(callback: dict[str, object]) -> None:
    callback["user"] = {"id": 42}


def _append_non_dify_action(callback: dict[str, object]) -> None:
    actions = callback["actions"]
    assert isinstance(actions, list)
    actions.append(
        {
            "type": "button",
            "block_id": "foreign.actions",
            "action_id": "foreign_action",
            "value": "foreign-value",
        }
    )


def _remove_state(callback: dict[str, object]) -> None:
    callback.pop("state")


def _set_wrong_text_value_type(callback: dict[str, object]) -> None:
    state = callback["state"]
    assert isinstance(state, dict)
    values = state["values"]
    assert isinstance(values, dict)
    values["__dify.input.0"] = {"说明📝": {"type": "plain_text_input", "value": 42}}


def _remove_text_value(callback: dict[str, object]) -> None:
    values = _state_values(callback)
    values["__dify.input.0"] = {"说明📝": {"type": "plain_text_input"}}


def _remove_static_select_selection(callback: dict[str, object]) -> None:
    state = callback["state"]
    assert isinstance(state, dict)
    values = state["values"]
    assert isinstance(values, dict)
    values["__dify.input.1"] = {"选择🌐": {"type": "static_select"}}


def _make_input_state_ambiguous(callback: dict[str, object]) -> None:
    state = callback["state"]
    assert isinstance(state, dict)
    values = state["values"]
    assert isinstance(values, dict)
    values["__dify.input.0"] = {
        "说明📝": {"type": "plain_text_input", "value": "first"},
        "duplicate": {"type": "plain_text_input", "value": "second"},
    }


def _set_unsupported_state_type(callback: dict[str, object]) -> None:
    state = callback["state"]
    assert isinstance(state, dict)
    values = state["values"]
    assert isinstance(values, dict)
    values["__dify.input.0"] = {"说明📝": {"type": "checkboxes", "selected_options": []}}


def _set_wrong_static_select_option_value_type(callback: dict[str, object]) -> None:
    values = _state_values(callback)
    values["__dify.input.1"] = {
        "选择🌐": {
            "type": "static_select",
            "selected_option": {"value": 42},
        }
    }


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(_remove_actor, id="missing-actor"),
        pytest.param(_set_wrong_actor_type, id="wrong-actor-type"),
        pytest.param(_append_non_dify_action, id="multiple-actions-including-dify"),
        pytest.param(_remove_state, id="missing-state"),
        pytest.param(_remove_text_value, id="missing-text-value"),
        pytest.param(_set_wrong_text_value_type, id="wrong-text-value-type"),
        pytest.param(_remove_static_select_selection, id="missing-static-select-selection"),
        pytest.param(_make_input_state_ambiguous, id="ambiguous-input-state"),
        pytest.param(_set_unsupported_state_type, id="unsupported-input-state"),
        pytest.param(_set_wrong_static_select_option_value_type, id="wrong-static-select-option-value-type"),
    ],
)
def test_decoder_rejects_missing_wrong_or_ambiguous_callback_facts(
    mutate: Callable[[dict[str, object]], None],
) -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    mutate(callback)

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


@pytest.mark.parametrize(
    "metadata",
    [
        pytest.param("not-json", id="invalid-json"),
        pytest.param(json.dumps({"version": 1, "action_id": "批准✅"}), id="missing-token"),
        pytest.param(
            json.dumps({"version": 1, "action_id": "批准✅", "correlation_token": 42}),
            id="wrong-token-type",
        ),
        pytest.param(
            json.dumps({"version": 2, "action_id": "批准✅", "correlation_token": "token"}),
            id="unsupported-version",
        ),
        pytest.param(
            json.dumps(
                {
                    "version": 1,
                    "action_id": "批准✅",
                    "correlation_token": "token",
                    "unexpected": "value",
                }
            ),
            id="unexpected-metadata",
        ),
    ],
)
def test_decoder_rejects_invalid_button_metadata(metadata: str) -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    actions = callback["actions"]
    assert isinstance(actions, list)
    actions[0]["value"] = metadata

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_requires_outer_and_embedded_action_identity_to_agree() -> None:
    callback = _fixture(_WEBHOOK_FIXTURE)
    actions = callback["actions"]
    assert isinstance(actions, list)
    actions[0]["action_id"] = "拒绝"

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoder_rejects_malformed_socket_mode_envelope() -> None:
    callback = _fixture(_SOCKET_MODE_FIXTURE)
    callback["payload"] = "wrong-type"

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback, ingress_kind=IMEventIngressKind.STREAM))


def test_decoder_rejects_socket_mode_envelope_without_envelope_id() -> None:
    callback = _fixture(_SOCKET_MODE_FIXTURE)
    del callback["envelope_id"]

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback, ingress_kind=IMEventIngressKind.STREAM))


@pytest.mark.parametrize(
    "invalid_envelope_id",
    [
        pytest.param(None, id="null"),
        pytest.param("", id="empty-string"),
        pytest.param(0, id="integer"),
    ],
)
def test_decoder_rejects_socket_mode_envelope_with_invalid_envelope_id(invalid_envelope_id: object) -> None:
    callback = _fixture(_SOCKET_MODE_FIXTURE)
    callback["envelope_id"] = invalid_envelope_id

    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(_event(callback, ingress_kind=IMEventIngressKind.STREAM))
