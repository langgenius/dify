"""Slack-owned Dynamic Card rendering metadata and callback decoding."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from math import isfinite
from typing import Literal, Never, override
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter, ValidationError

from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ParagraphInput, ResolvedForm, SelectInput
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    CorrelationToken,
    DynamicCardMessagingError,
    IMCardEvent,
    IMCardEventDecoder,
    IMCardEventDecodeResult,
    IMCardEventDecodingError,
    ProviderUserId,
    UnrecognizedIMEvent,
)

_DIFY_INPUT_BLOCK_PREFIX = "__dify.input."
_DIFY_ACTIONS_BLOCK_PREFIX = "__dify.actions."
_CALLBACK_SCHEMA_VERSION: Literal[1] = 1
_MAX_ACTION_VALUE_LENGTH = 2000
_STATIC_SELECT_PLACEHOLDER_TEXT = "Select an option"
_JSON_OBJECT_ADAPTER = TypeAdapter(dict[str, JsonValue])


class _InvalidJsonConstantError(ValueError):
    """RFC-invalid non-finite JSON constant without retaining its source text."""


class _InvalidJsonNumberError(ValueError):
    """JSON number rejected without retaining its source text."""


def _reject_invalid_json_constant(_serialized_constant: str) -> Never:
    raise _InvalidJsonConstantError


def _decode_json_integer(serialized_integer: str) -> int:
    try:
        return int(serialized_integer)
    except ValueError:
        raise _InvalidJsonNumberError from None


def _decode_json_float(serialized_float: str) -> float:
    decoded_float = float(serialized_float)
    if not isfinite(decoded_float):
        raise _InvalidJsonNumberError
    return decoded_float


class _SlackCallbackModel(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True, strict=True)


class _SlackCallbackUser(_SlackCallbackModel):
    id: str = Field(min_length=1)


class _SlackInvokedAction(_SlackCallbackModel):
    type: Literal["button"]
    block_id: str = Field(min_length=1)
    action_id: str = Field(min_length=1)
    value: str


class _SlackCallbackState(_SlackCallbackModel):
    values: dict[str, dict[str, JsonValue]] = Field(default_factory=dict)


class _SlackCallbackMessage(_SlackCallbackModel):
    blocks: list[dict[str, JsonValue]]


class _SlackBlockActionsPayload(_SlackCallbackModel):
    type: Literal["block_actions"]
    user: _SlackCallbackUser
    actions: list[_SlackInvokedAction] = Field(min_length=1, max_length=1)
    message: _SlackCallbackMessage
    state: _SlackCallbackState | None = None


class _SlackSocketModeEnvelope(_SlackCallbackModel):
    type: Literal["interactive"]
    payload: dict[str, JsonValue]


class _SlackButtonMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    version: Literal[1]
    action_id: str = Field(min_length=1)
    correlation_token: str


@dataclass(frozen=True, slots=True)
class _ExpectedInput:
    action_id: str
    element_type: Literal["plain_text_input", "static_select"]


@dataclass(frozen=True, slots=True)
class SlackCardEventDecoder(IMCardEventDecoder):
    """Decode sender-owned Slack Block Actions without credentials or I/O."""

    @override
    def decode(self, event: AuthenticatedIMEvent) -> IMCardEventDecodeResult:
        if event.provider is not IMProvider.SLACK or event.event_type != "block_actions":
            return UnrecognizedIMEvent()

        callback = _decode_json_object(event.payload)
        if callback is None:
            raise IMCardEventDecodingError("Slack card event payload is invalid.")
        callback_payload = _unwrap_callback_payload(callback)
        if callback_payload is None:
            raise IMCardEventDecodingError("Slack card event envelope is invalid.")
        if not _has_dify_submission_action(callback_payload):
            return UnrecognizedIMEvent()
        block_actions = _validate_block_actions(callback_payload)
        if block_actions is None:
            raise IMCardEventDecodingError("Slack card event schema is invalid.")

        invoked_action = block_actions.actions[0]
        if not _has_block_id_suffix(invoked_action.block_id, _DIFY_ACTIONS_BLOCK_PREFIX):
            raise IMCardEventDecodingError("Slack card action block is invalid.")
        metadata = _decode_button_metadata(invoked_action.value)
        if metadata is None:
            raise IMCardEventDecodingError("Slack card action metadata is invalid.")
        if invoked_action.action_id != metadata.action_id:
            raise IMCardEventDecodingError("Slack card action identity is inconsistent.")

        expected_inputs = _decode_expected_inputs(block_actions.message.blocks)
        state_values = block_actions.state.values if block_actions.state is not None else {}
        inputs = _decode_inputs(expected_inputs, state_values)
        return IMCardEvent(
            provider_user_id=ProviderUserId(block_actions.user.id),
            action_id=invoked_action.action_id,
            inputs=inputs,
            correlation_token=CorrelationToken(metadata.correlation_token),
        )


def render_card_blocks(intent: ResolvedForm, correlation_token: CorrelationToken) -> list[dict[str, object]]:
    """Render one accepted form using the callback layout owned by this decoder."""

    render_nonce = uuid4().hex
    blocks: list[dict[str, object]] = []
    if intent.title:
        blocks.append({"type": "header", "text": {"type": "plain_text", "text": intent.title}})
    input_ordinal = 0
    for block in intent.blocks:
        if isinstance(block, MarkdownText):
            blocks.append({"type": "markdown", "text": block.text})
            continue
        input_name = block.output_variable_name
        input_element: dict[str, object] = {"action_id": input_name}
        if isinstance(block, ParagraphInput):
            input_element.update({"type": "plain_text_input", "multiline": True})
            if block.default_value is not None:
                input_element["initial_value"] = block.default_value
        elif isinstance(block, SelectInput):
            options = [{"text": {"type": "plain_text", "text": option}, "value": option} for option in block.options]
            input_element.update(
                {
                    "type": "static_select",
                    "placeholder": {"type": "plain_text", "text": _STATIC_SELECT_PLACEHOLDER_TEXT},
                    "options": options,
                }
            )
            if block.default_value is not None:
                input_element["initial_option"] = next(
                    option for option in options if option["value"] == block.default_value
                )
        else:
            raise DynamicCardMessagingError("Slack cards cannot represent file inputs.")
        blocks.append(
            {
                "type": "input",
                "block_id": f"{_DIFY_INPUT_BLOCK_PREFIX}{render_nonce}.{input_ordinal}",
                "label": {"type": "plain_text", "text": input_name},
                "element": input_element,
            }
        )
        input_ordinal += 1
    if intent.user_actions:
        action_elements: list[dict[str, object]] = []
        for action in intent.user_actions:
            action_value = _encode_button_metadata(action.id, correlation_token)
            if len(action_value) > _MAX_ACTION_VALUE_LENGTH:
                raise DynamicCardMessagingError("Slack cannot preserve the correlation token.")
            action_element: dict[str, object] = {
                "type": "button",
                "action_id": action.id,
                "text": {"type": "plain_text", "text": action.title},
                "value": action_value,
            }
            if action.button_style is ButtonStyle.PRIMARY:
                action_element["style"] = "primary"
            elif action.button_style is ButtonStyle.ACCENT:
                action_element["style"] = "danger"
            action_elements.append(action_element)
        blocks.append(
            {
                "type": "actions",
                "block_id": f"{_DIFY_ACTIONS_BLOCK_PREFIX}{render_nonce}",
                "elements": action_elements,
            }
        )
    return blocks


def _encode_button_metadata(action_id: str, correlation_token: CorrelationToken) -> str:
    metadata = _SlackButtonMetadata(
        version=_CALLBACK_SCHEMA_VERSION,
        action_id=action_id,
        correlation_token=str(correlation_token),
    )
    return json.dumps(metadata.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _decode_json_object(serialized_callback: str) -> dict[str, JsonValue] | None:
    try:
        decoded_callback: object = json.loads(
            serialized_callback,
            parse_constant=_reject_invalid_json_constant,
            parse_float=_decode_json_float,
            parse_int=_decode_json_integer,
        )
    except (json.JSONDecodeError, _InvalidJsonConstantError, _InvalidJsonNumberError, RecursionError):
        return None
    try:
        return _JSON_OBJECT_ADAPTER.validate_python(decoded_callback, strict=True)
    except ValidationError:
        return None


def _unwrap_callback_payload(callback: dict[str, JsonValue]) -> dict[str, JsonValue] | None:
    if callback.get("type") != "interactive":
        return callback
    try:
        envelope = _SlackSocketModeEnvelope.model_validate(callback)
    except ValidationError:
        return None
    return envelope.payload


def _validate_block_actions(callback_payload: dict[str, JsonValue]) -> _SlackBlockActionsPayload | None:
    try:
        return _SlackBlockActionsPayload.model_validate(callback_payload)
    except ValidationError:
        return None


def _has_dify_submission_action(callback_payload: Mapping[str, JsonValue]) -> bool:
    actions = callback_payload.get("actions")
    if not isinstance(actions, list):
        return False
    for action in actions:
        if not isinstance(action, Mapping):
            continue
        block_id = action.get("block_id")
        if isinstance(block_id, str) and block_id.startswith(_DIFY_ACTIONS_BLOCK_PREFIX):
            return True
    return False


def _decode_button_metadata(serialized_metadata: str) -> _SlackButtonMetadata | None:
    try:
        return _SlackButtonMetadata.model_validate_json(serialized_metadata)
    except ValidationError:
        return None


def _decode_expected_inputs(message_blocks: list[dict[str, JsonValue]]) -> dict[str, _ExpectedInput]:
    expected_inputs: dict[str, _ExpectedInput] = {}
    expected_action_ids: set[str] = set()
    for message_block in message_blocks:
        block_id = message_block.get("block_id")
        is_input_block = message_block.get("type") == "input"
        is_dify_input_block = isinstance(block_id, str) and block_id.startswith(_DIFY_INPUT_BLOCK_PREFIX)
        if not is_input_block and not is_dify_input_block:
            continue
        if (
            not is_input_block
            or not isinstance(block_id, str)
            or not _has_block_id_suffix(block_id, _DIFY_INPUT_BLOCK_PREFIX)
        ):
            raise IMCardEventDecodingError("Slack card input block schema is invalid.")
        element = message_block.get("element")
        if not isinstance(element, Mapping):
            raise IMCardEventDecodingError("Slack card input element schema is invalid.")
        action_id = element.get("action_id")
        element_type = element.get("type")
        if element_type == "plain_text_input":
            supported_element_type: Literal["plain_text_input", "static_select"] = "plain_text_input"
        elif element_type == "static_select":
            supported_element_type = "static_select"
        else:
            raise IMCardEventDecodingError("Slack card input element schema is invalid.")
        if (
            not isinstance(action_id, str)
            or not action_id
            or block_id in expected_inputs
            or action_id in expected_action_ids
        ):
            raise IMCardEventDecodingError("Slack card input element schema is invalid.")
        expected_inputs[block_id] = _ExpectedInput(action_id=action_id, element_type=supported_element_type)
        expected_action_ids.add(action_id)
    return expected_inputs


def _decode_inputs(
    expected_inputs: Mapping[str, _ExpectedInput],
    state_values: Mapping[str, Mapping[str, JsonValue]],
) -> dict[str, JsonValue]:
    if set(state_values) != set(expected_inputs):
        raise IMCardEventDecodingError("Slack card input state does not match the message schema.")

    decoded_inputs: dict[str, JsonValue] = {}
    for block_id, expected_input in expected_inputs.items():
        block_state = state_values[block_id]
        if len(block_state) != 1:
            raise IMCardEventDecodingError("Slack card input state is ambiguous.")
        input_name, element_state = next(iter(block_state.items()))
        if (
            input_name != expected_input.action_id
            or not isinstance(element_state, Mapping)
            or input_name in decoded_inputs
        ):
            raise IMCardEventDecodingError("Slack card input state is invalid.")
        element_type = element_state.get("type")
        if element_type != expected_input.element_type:
            raise IMCardEventDecodingError("Slack card input type is inconsistent.")
        if element_type == "plain_text_input":
            if "value" not in element_state:
                raise IMCardEventDecodingError("Slack card text input state is invalid.")
            input_value = element_state["value"]
            if input_value is not None and not isinstance(input_value, str):
                raise IMCardEventDecodingError("Slack card text input state is invalid.")
        elif element_type == "static_select":
            if "selected_option" not in element_state:
                raise IMCardEventDecodingError("Slack card selection input state is invalid.")
            selected_option = element_state["selected_option"]
            if selected_option is None:
                input_value = None
            elif isinstance(selected_option, Mapping) and "value" in selected_option:
                input_value = selected_option["value"]
            else:
                raise IMCardEventDecodingError("Slack card selection input state is invalid.")
            if input_value is not None and not isinstance(input_value, str):
                raise IMCardEventDecodingError("Slack card selection input state is invalid.")
        else:
            raise IMCardEventDecodingError("Slack card input type is unsupported.")
        decoded_inputs[input_name] = input_value
    return decoded_inputs


def _has_block_id_suffix(block_id: str, prefix: str) -> bool:
    return block_id.startswith(prefix) and len(block_id) > len(prefix)


__all__ = ["SlackCardEventDecoder", "render_card_blocks"]
