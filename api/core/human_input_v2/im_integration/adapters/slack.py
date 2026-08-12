"""Concrete Slack adapter for Provider-neutral Human Input IM contracts.

The root and its ordinary capabilities rely on the contract's external
serialization rule and intentionally contain no synchronization. Socket Mode
delegates connection concurrency and resource shutdown to the Slack SDK.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from email.message import Message
from math import isfinite
from typing import Annotated, ClassVar, Literal, Never, Self, override
from urllib.parse import parse_qs

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    RootModel,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_validator,
)
from slack_sdk.errors import SlackApiError, SlackClientError
from slack_sdk.models.blocks import MarkdownBlock
from slack_sdk.signature import Clock, SignatureVerifier
from slack_sdk.socket_mode import SocketModeClient
from slack_sdk.socket_mode.client import BaseSocketModeClient
from slack_sdk.socket_mode.request import SocketModeRequest
from slack_sdk.socket_mode.response import SocketModeResponse
from slack_sdk.web import WebClient
from slack_sdk.web.slack_response import SlackResponse

from core.human_input import ButtonStyle
from core.human_input_v2 import FileInput, FileListInput, MarkdownText, ParagraphInput, ResolvedForm, SelectInput
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    CardAssessment,
    CorrelationToken,
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    Directory,
    DirectoryEntry,
    DirectoryReadFailure,
    DynamicCardMessagingError,
    EventAcceptance,
    IMCardEvent,
    IMCardEventDecoder,
    IMCardEventDecodeResult,
    IMCardEventDecodingError,
    IMDirectory,
    IMDynamicCardMessaging,
    IMEventConsumer,
    IMEventStream,
    IMMessaging,
    IMStreamStartError,
    IMStreamStopError,
    IMWebhookHandler,
    MessageAccepted,
    MessageReference,
    MessageSendingError,
    MessageSendingResult,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    SlackIMIntegrationCredentials,
    StaticCardIntent,
    UnrecognizedIMEvent,
    WebhookRequest,
    WebhookResponse,
)

logger = logging.getLogger(__name__)


def _log_safe_error(message: str, *, extra: Mapping[str, JsonValue] | None = None) -> None:
    """Record a static diagnostic without serializing the active exception."""

    logger.error(message, extra=extra)


@dataclass(frozen=True, slots=True)
class _SlackMessageLocator(MessageReference):
    _TIMESTAMP_PATTERN: ClassVar[re.Pattern[str]] = re.compile(r"^[0-9]+\.[0-9]+$")

    message_kind: Literal["text", "dynamic_card"]
    channel_id: str
    message_ts: str


@dataclass(frozen=True, slots=True)
class _SlackCardCodec(IMCardEventDecoder):
    """Own the complete sender-owned Slack card wire contract without I/O."""

    _MAX_MARKDOWN_TEXT_LENGTH: ClassVar[int] = MarkdownBlock.text_max_length
    _MAX_HEADER_TEXT_LENGTH: ClassVar[int] = 150
    _MAX_BLOCK_COUNT: ClassVar[int] = 50
    _MAX_ACTION_COUNT: ClassVar[int] = 25
    _MAX_ACTION_ID_LENGTH: ClassVar[int] = 255
    _MAX_ACTION_TEXT_LENGTH: ClassVar[int] = 75
    _MAX_INPUT_LABEL_LENGTH: ClassVar[int] = 2000
    _MAX_INPUT_INITIAL_VALUE_LENGTH: ClassVar[int] = 3000
    _MAX_STATIC_SELECT_OPTION_COUNT: ClassVar[int] = 100
    _MAX_STATIC_SELECT_OPTION_TEXT_LENGTH: ClassVar[int] = 75
    _MAX_STATIC_SELECT_OPTION_VALUE_LENGTH: ClassVar[int] = 150
    _MAX_ACTION_VALUE_LENGTH: ClassVar[int] = 2000
    _ACTIONS_BLOCK_ID: ClassVar[str] = "__dify.actions"
    _INPUT_BLOCK_ID_TEMPLATE: ClassVar[str] = "__dify.input.{}"
    _INPUT_BLOCK_ID_PATTERN: ClassVar[re.Pattern[str]] = re.compile(r"__dify\.input\.(?:0|[1-9][0-9]*)")
    _STATIC_SELECT_PLACEHOLDER_TEXT: ClassVar[str] = "Select an option"
    _CALLBACK_SCHEMA_VERSION: ClassVar[Literal[1]] = 1
    _JSON_OBJECT_ADAPTER: ClassVar[TypeAdapter[dict[str, JsonValue]]] = TypeAdapter(dict[str, JsonValue])

    class _CallbackModel(BaseModel):
        model_config = ConfigDict(extra="ignore", frozen=True, strict=True)

    class _RecognitionAction(_CallbackModel):
        model_config = ConfigDict(extra="allow", frozen=True, strict=True)

        block_id: str | None = None

        @field_validator("block_id", mode="before")
        @classmethod
        def _ignore_non_string_block_id(cls, value: JsonValue) -> str | None:
            return value if isinstance(value, str) else None

    class _RecognitionPayload(_CallbackModel):
        model_config = ConfigDict(extra="allow", frozen=True, strict=True)

        actions: list[_SlackCardCodec._RecognitionAction | None | str | int | float | bool | list[JsonValue]] = Field(
            default_factory=list
        )

        @field_validator("actions", mode="before")
        @classmethod
        def _normalize_non_list_actions(cls, value: JsonValue) -> JsonValue:
            return value if isinstance(value, list) else []

        @property
        def has_dify_submission_action(self) -> bool:
            return any(
                isinstance(action, _SlackCardCodec._RecognitionAction)
                and action.block_id == _SlackCardCodec._ACTIONS_BLOCK_ID
                for action in self.actions
            )

    class _SocketModeEnvelope(_CallbackModel):
        type: Literal["interactive"]
        payload: dict[str, JsonValue]

    class _CallbackUser(_CallbackModel):
        id: str = Field(min_length=1)

    class _ButtonMetadata(BaseModel):
        model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

        version: Literal[1]
        action_id: str = Field(min_length=1)
        correlation_token: str

    class _EncodedButton(_CallbackModel):
        type: Literal["button"]
        action_id: str = Field(min_length=1)
        value: str = Field(exclude=True)
        metadata: _SlackCardCodec._ButtonMetadata = Field(exclude=True)

        @model_validator(mode="before")
        @classmethod
        def _decode_metadata(cls, value: JsonValue) -> JsonValue:
            if not isinstance(value, dict):
                return value
            serialized_metadata = value.get("value")
            if not isinstance(serialized_metadata, str):
                return value
            decoded_metadata = _SlackCardCodec._decode_json_object(serialized_metadata)
            if decoded_metadata is None:
                raise ValueError("Slack card action metadata is invalid.")
            value_with_metadata = dict(value)
            value_with_metadata["metadata"] = decoded_metadata
            return value_with_metadata

        @model_validator(mode="after")
        def _require_matching_action_identity(self) -> Self:
            if self.action_id != self.metadata.action_id:
                raise ValueError("Slack card action identity is inconsistent.")
            return self

    class _InvokedButton(_EncodedButton):
        block_id: str

        @field_validator("block_id")
        @classmethod
        def _require_submission_block_id(cls, value: str) -> str:
            if value != _SlackCardCodec._ACTIONS_BLOCK_ID:
                raise ValueError("Slack card action block is invalid.")
            return value

    class _PlainTextInputElement(_CallbackModel):
        type: Literal["plain_text_input"]
        action_id: str = Field(min_length=1)

    class _StaticSelectElement(_CallbackModel):
        type: Literal["static_select"]
        action_id: str = Field(min_length=1)

    type _InputElement = Annotated[
        _PlainTextInputElement | _StaticSelectElement,
        Field(discriminator="type"),
    ]

    class _InputBlock(_CallbackModel):
        type: Literal["input"]
        block_id: str = Field(min_length=1)
        element: _SlackCardCodec._InputElement

    class _ActionsBlock(_CallbackModel):
        type: Literal["actions"]
        block_id: str
        elements: list[_SlackCardCodec._EncodedButton] = Field(min_length=1)

        @field_validator("block_id")
        @classmethod
        def _require_submission_block_id(cls, value: str) -> str:
            if value != _SlackCardCodec._ACTIONS_BLOCK_ID:
                raise ValueError("Slack card actions block is invalid.")
            return value

        @model_validator(mode="after")
        def _require_unique_action_ids(self) -> Self:
            action_ids = {element.action_id for element in self.elements}
            if len(action_ids) != len(self.elements):
                raise ValueError("Slack card actions block is ambiguous.")
            return self

    class _OtherMessageBlock(_CallbackModel):
        type: str
        block_id: str | None = None

        @model_validator(mode="after")
        def _reject_sender_owned_block_shape(self) -> Self:
            if self.type in {"input", "actions"}:
                raise ValueError("Slack card message block type is invalid.")
            if self.block_id == _SlackCardCodec._ACTIONS_BLOCK_ID or (
                self.block_id is not None and _SlackCardCodec._INPUT_BLOCK_ID_PATTERN.fullmatch(self.block_id)
            ):
                raise ValueError("Slack card message block identifier is reserved.")
            return self

    type _MessageBlock = Annotated[
        _InputBlock | _ActionsBlock | _OtherMessageBlock,
        Field(union_mode="left_to_right"),
    ]

    class _MessageBlocks(RootModel[list[_MessageBlock]]):
        model_config = ConfigDict(frozen=True, strict=True)

        @model_validator(mode="after")
        def _require_stable_message_schema(self) -> Self:
            if len(self.actions_blocks) != 1:
                raise ValueError("Slack card actions schema is invalid.")

            action_ids: set[str] = set()
            for input_ordinal, input_block in enumerate(self.inputs):
                expected_block_id = _SlackCardCodec._INPUT_BLOCK_ID_TEMPLATE.format(input_ordinal)
                if input_block.block_id != expected_block_id or input_block.element.action_id in action_ids:
                    raise ValueError("Slack card input schema is invalid.")
                action_ids.add(input_block.element.action_id)
            return self

        @property
        def inputs(self) -> tuple[_SlackCardCodec._InputBlock, ...]:
            return tuple(block for block in self.root if isinstance(block, _SlackCardCodec._InputBlock))

        @property
        def actions_blocks(self) -> tuple[_SlackCardCodec._ActionsBlock, ...]:
            return tuple(block for block in self.root if isinstance(block, _SlackCardCodec._ActionsBlock))

        @property
        def actions(self) -> tuple[_SlackCardCodec._EncodedButton, ...]:
            return tuple(self.actions_blocks[0].elements)

    class _CallbackMessage(_CallbackModel):
        blocks: _SlackCardCodec._MessageBlocks

    class _SelectedOption(_CallbackModel):
        value: str

    class _PlainTextInputState(_CallbackModel):
        type: Literal["plain_text_input"]
        value: str | None

    class _StaticSelectState(_CallbackModel):
        type: Literal["static_select"]
        selected_option: _SlackCardCodec._SelectedOption | None

    type _InputState = Annotated[
        _PlainTextInputState | _StaticSelectState,
        Field(discriminator="type"),
    ]

    class _InputBlockState(RootModel[dict[str, _InputState]]):
        model_config = ConfigDict(frozen=True, strict=True)

        @model_validator(mode="after")
        def _require_one_input_state(self) -> Self:
            if len(self.root) != 1:
                raise ValueError("Slack card input state is ambiguous.")
            return self

        @property
        def action_id(self) -> str:
            return next(iter(self.root))

        @property
        def input_state(self) -> _SlackCardCodec._InputState:
            return self.root[self.action_id]

        @property
        def input_value(self) -> JsonValue:
            state = self.input_state
            if isinstance(state, _SlackCardCodec._PlainTextInputState):
                return state.value
            if state.selected_option is None:
                return None
            return state.selected_option.value

    class _StateValues(RootModel[dict[str, _InputBlockState]]):
        model_config = ConfigDict(frozen=True, strict=True)

    class _CallbackState(_CallbackModel):
        values: _SlackCardCodec._StateValues = Field(default_factory=lambda: _SlackCardCodec._StateValues({}))

    class _SubmissionPayload(_CallbackModel):
        type: Literal["block_actions"]
        user: _SlackCardCodec._CallbackUser
        actions: list[_SlackCardCodec._InvokedButton]
        message: _SlackCardCodec._CallbackMessage
        state: _SlackCardCodec._CallbackState | None = None

        @model_validator(mode="after")
        def _require_exact_submission_schema(self) -> Self:
            if len(self.actions) != 1:
                raise ValueError("Slack card invoked action is ambiguous.")

            invoked_action = self.action
            if not any(
                message_action.action_id == invoked_action.action_id
                and message_action.metadata == invoked_action.metadata
                for message_action in self.message.blocks.actions
            ):
                raise ValueError("Slack card invoked action does not match the message schema.")

            expected_inputs = self.message.blocks.inputs
            state_values = self.state.values.root if self.state is not None else {}
            if set(state_values) != {input_block.block_id for input_block in expected_inputs}:
                raise ValueError("Slack card input state does not match the message schema.")

            for input_block in expected_inputs:
                block_state = state_values[input_block.block_id]
                if (
                    block_state.action_id != input_block.element.action_id
                    or block_state.input_state.type != input_block.element.type
                ):
                    raise ValueError("Slack card input state is inconsistent.")
            return self

        @property
        def action(self) -> _SlackCardCodec._InvokedButton:
            return self.actions[0]

        @property
        def normalized_inputs(self) -> dict[str, JsonValue]:
            if self.state is None:
                return {}
            state_values = self.state.values.root
            return {
                input_block.element.action_id: state_values[input_block.block_id].input_value
                for input_block in self.message.blocks.inputs
            }

    class _InvalidJsonConstantError(ValueError):
        """RFC-invalid non-finite JSON constant without retaining its source text."""

    class _InvalidJsonNumberError(ValueError):
        """JSON number rejected without retaining its source text."""

    def assess(self, intent: ResolvedForm) -> CardAssessment:
        reason = self._unrepresentable_reason(intent)
        if reason is not None:
            return CardAssessment(False, reason)
        return CardAssessment(True)

    def encode(
        self,
        intent: ResolvedForm,
        correlation_token: CorrelationToken,
    ) -> Mapping[str, JsonValue]:
        return {"blocks": self._render_blocks(intent, correlation_token)}

    @override
    def decode(self, event: AuthenticatedIMEvent) -> IMCardEventDecodeResult:
        if event.provider is not IMProvider.SLACK or event.event_type != "block_actions":
            return UnrecognizedIMEvent()

        callback = self._decode_json_object(event.payload)
        if callback is None:
            raise IMCardEventDecodingError("Slack card event payload is invalid.")
        callback_payload = self._unwrap_callback_payload(callback)
        if callback_payload is None:
            raise IMCardEventDecodingError("Slack card event envelope is invalid.")

        recognition = self._recognize_submission(callback_payload)
        if recognition is None:
            raise IMCardEventDecodingError("Slack card event recognition is invalid.")
        if not recognition.has_dify_submission_action:
            return UnrecognizedIMEvent()

        submission = self._validate_submission(recognition)
        if submission is None:
            raise IMCardEventDecodingError("Slack card event schema is invalid.")
        return IMCardEvent(
            provider_user_id=ProviderUserId(submission.user.id),
            action_id=submission.action.action_id,
            inputs=submission.normalized_inputs,
            correlation_token=CorrelationToken(submission.action.metadata.correlation_token),
        )

    @classmethod
    def _decode_json_object(cls, serialized_value: str) -> dict[str, JsonValue] | None:
        try:
            decoded_value: JsonValue = json.loads(
                serialized_value,
                parse_constant=cls._reject_invalid_json_constant,
                parse_float=cls._decode_json_float,
                parse_int=cls._decode_json_integer,
            )
        except (
            json.JSONDecodeError,
            cls._InvalidJsonConstantError,
            cls._InvalidJsonNumberError,
            RecursionError,
        ):
            return None
        try:
            return cls._JSON_OBJECT_ADAPTER.validate_python(decoded_value, strict=True)
        except ValidationError:
            return None

    @classmethod
    def _unwrap_callback_payload(cls, callback: dict[str, JsonValue]) -> dict[str, JsonValue] | None:
        if callback.get("type") != "interactive":
            return callback
        try:
            return cls._SocketModeEnvelope.model_validate(callback).payload
        except ValidationError:
            return None

    @classmethod
    def _recognize_submission(cls, callback_payload: dict[str, JsonValue]) -> _RecognitionPayload | None:
        try:
            return cls._RecognitionPayload.model_validate(callback_payload)
        except ValidationError:
            return None

    @classmethod
    def _validate_submission(cls, recognition: _RecognitionPayload) -> _SubmissionPayload | None:
        try:
            return cls._SubmissionPayload.model_validate(recognition.model_dump(mode="python"))
        except ValidationError:
            return None

    @classmethod
    def _encode_button_metadata(cls, action_id: str, correlation_token: CorrelationToken) -> str:
        metadata = cls._ButtonMetadata(
            version=cls._CALLBACK_SCHEMA_VERSION,
            action_id=action_id,
            correlation_token=str(correlation_token),
        )
        return json.dumps(metadata.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    @classmethod
    def _render_blocks(
        cls,
        intent: ResolvedForm,
        correlation_token: CorrelationToken,
    ) -> list[JsonValue]:
        blocks: list[JsonValue] = []
        if intent.title:
            blocks.append({"type": "header", "text": {"type": "plain_text", "text": intent.title}})
        input_ordinal = 0
        for block in intent.blocks:
            if isinstance(block, MarkdownText):
                blocks.append({"type": "markdown", "text": block.text})
                continue
            input_name = block.output_variable_name
            input_element: dict[str, JsonValue] = {"action_id": input_name}
            if isinstance(block, ParagraphInput):
                input_element.update({"type": "plain_text_input", "multiline": True})
                if block.default_value is not None:
                    input_element["initial_value"] = block.default_value
            elif isinstance(block, SelectInput):
                options: list[JsonValue] = [
                    {"text": {"type": "plain_text", "text": option}, "value": option} for option in block.options
                ]
                input_element.update(
                    {
                        "type": "static_select",
                        "placeholder": {"type": "plain_text", "text": cls._STATIC_SELECT_PLACEHOLDER_TEXT},
                        "options": options,
                    }
                )
                if block.default_value is not None:
                    input_element["initial_option"] = next(
                        option
                        for option in options
                        if isinstance(option, dict) and option["value"] == block.default_value
                    )
            else:
                raise DynamicCardMessagingError("Slack cards cannot represent file inputs.")
            blocks.append(
                {
                    "type": "input",
                    "block_id": cls._INPUT_BLOCK_ID_TEMPLATE.format(input_ordinal),
                    "label": {"type": "plain_text", "text": input_name},
                    "element": input_element,
                }
            )
            input_ordinal += 1
        if intent.user_actions:
            action_elements: list[JsonValue] = []
            for action in intent.user_actions:
                action_value = cls._encode_button_metadata(action.id, correlation_token)
                if len(action_value) > cls._MAX_ACTION_VALUE_LENGTH:
                    raise DynamicCardMessagingError("Slack cannot preserve the correlation token.")
                action_element: dict[str, JsonValue] = {
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
                    "block_id": cls._ACTIONS_BLOCK_ID,
                    "elements": action_elements,
                }
            )
        return blocks

    @classmethod
    def _unrepresentable_reason(cls, intent: ResolvedForm) -> str | None:
        if not intent.blocks and not intent.user_actions:
            return "Slack cannot preserve an empty card."
        if intent.title is not None and len(intent.title) > cls._MAX_HEADER_TEXT_LENGTH:
            return "Slack cannot preserve the card title of this length."
        block_count = len(intent.blocks) + (1 if intent.title else 0) + (1 if intent.user_actions else 0)
        if block_count > cls._MAX_BLOCK_COUNT:
            return "Slack cannot preserve this number of card controls."
        if len(intent.user_actions) > cls._MAX_ACTION_COUNT:
            return "Slack cannot preserve this number of card actions."

        input_names: set[str] = set()
        for block in intent.blocks:
            match block:
                case MarkdownText(text=text):
                    if not text or len(text) > cls._MAX_MARKDOWN_TEXT_LENGTH:
                        return "Slack cannot preserve one Markdown block of this length."
                    continue
                case FileInput() | FileListInput():
                    return "Slack cards cannot represent file inputs."
                case ParagraphInput(output_variable_name=input_name, default_value=default_value):
                    if len(input_name) > cls._MAX_ACTION_ID_LENGTH or len(input_name) > cls._MAX_INPUT_LABEL_LENGTH:
                        return "Slack cannot preserve one card input identifier."
                    if default_value is not None and len(default_value) > cls._MAX_INPUT_INITIAL_VALUE_LENGTH:
                        return "Slack cannot preserve one card input default."
                case SelectInput(output_variable_name=input_name, options=options, default_value=default_value):
                    if len(input_name) > cls._MAX_ACTION_ID_LENGTH or len(input_name) > cls._MAX_INPUT_LABEL_LENGTH:
                        return "Slack cannot preserve one card input identifier."
                    if not 1 <= len(options) <= cls._MAX_STATIC_SELECT_OPTION_COUNT:
                        return "Slack cannot preserve one select input's option count."
                    if any(
                        not option
                        or len(option) > cls._MAX_STATIC_SELECT_OPTION_TEXT_LENGTH
                        or len(option) > cls._MAX_STATIC_SELECT_OPTION_VALUE_LENGTH
                        for option in options
                    ):
                        return "Slack cannot preserve one select option."
                    if default_value is not None and default_value not in options:
                        return "Slack cannot preserve one select input default."
            if input_name in input_names:
                return "Slack cannot preserve duplicate card input identifiers."
            input_names.add(input_name)
        for action in intent.user_actions:
            if len(action.id) > cls._MAX_ACTION_ID_LENGTH or len(action.title) > cls._MAX_ACTION_TEXT_LENGTH:
                return "Slack cannot preserve one card action identifier or title."
            if action.button_style not in {ButtonStyle.DEFAULT, ButtonStyle.PRIMARY, ButtonStyle.ACCENT}:
                return "Slack cannot preserve one card action style."
        return None

    @staticmethod
    def _reject_invalid_json_constant(_serialized_constant: str) -> Never:
        raise _SlackCardCodec._InvalidJsonConstantError

    @staticmethod
    def _decode_json_integer(serialized_integer: str) -> int:
        try:
            return int(serialized_integer)
        except ValueError:
            raise _SlackCardCodec._InvalidJsonNumberError from None

    @staticmethod
    def _decode_json_float(serialized_float: str) -> float:
        decoded_float = float(serialized_float)
        if not isfinite(decoded_float):
            raise _SlackCardCodec._InvalidJsonNumberError
        return decoded_float


class _TrustedReceiveTimeClock(Clock):
    """SDK clock fixed to the framework's trusted UTC receive time."""

    def __init__(self, received_at: datetime) -> None:
        if received_at.tzinfo is None:
            received_at = received_at.replace(tzinfo=UTC)
        else:
            received_at = received_at.astimezone(UTC)
        self._received_timestamp = received_at.timestamp()

    @override
    def now(self) -> float:
        return self._received_timestamp


@dataclass(frozen=True, slots=True)
class _SlackDirectoryPagination:
    next_cursor: str | None


class _SlackDirectory(IMDirectory):
    _PAGE_SIZE: ClassVar[int] = 200
    # Slack-owned special users are protocol exceptions: Slackbot reports `is_bot=false`, and system
    # notifications are sent by `USLACK`.
    # https://docs.slack.dev/reference/objects/user-object/
    # https://docs.slack.dev/changelog/2026/06/17/system-notifications/
    _OWNED_SPECIAL_USER_IDS: ClassVar[frozenset[str]] = frozenset(("USLACKBOT", "USLACK"))

    def __init__(self, client: WebClient) -> None:
        self._client = client

    @override
    def read_directory(self) -> Directory | DirectoryReadFailure:
        entries: list[DirectoryEntry] = []
        cursor: str | None = None
        seen_cursors: set[str] = set()
        try:
            while True:
                if cursor is None:
                    response = self._client.users_list(limit=self._PAGE_SIZE)
                else:
                    response = self._client.users_list(limit=self._PAGE_SIZE, cursor=cursor)
                members = response.get("members")
                if not isinstance(members, Sequence) or isinstance(members, (str, bytes, bytearray)):
                    return DirectoryReadFailure("Slack returned an incomplete directory response.")
                page_entries = self._directory_entries(members)
                if page_entries is None:
                    return DirectoryReadFailure("Slack returned an invalid directory entry.")
                pagination = self._pagination(response.get("response_metadata"))
                if pagination is None:
                    return DirectoryReadFailure("Slack returned invalid directory pagination.")
                next_cursor = pagination.next_cursor
                if next_cursor is not None and next_cursor in seen_cursors:
                    return DirectoryReadFailure("Slack returned invalid directory pagination.")
                entries.extend(page_entries)
                if next_cursor is None:
                    return Directory(tuple(entries))
                seen_cursors.add(next_cursor)
                cursor = next_cursor
        except SlackClientError:
            return DirectoryReadFailure("Slack directory could not be read completely.")

    @staticmethod
    def _directory_entries(members: Sequence[JsonValue]) -> tuple[DirectoryEntry, ...] | None:
        entries: list[DirectoryEntry] = []
        for member in members:
            if not isinstance(member, Mapping):
                return None
            provider_user_id = member.get("id")
            if member.get("deleted") is True or member.get("is_bot") is True or member.get("is_app_user") is True:
                continue
            if not isinstance(provider_user_id, str) or not provider_user_id:
                return None
            if provider_user_id in _SlackDirectory._OWNED_SPECIAL_USER_IDS:
                continue
            profile = member.get("profile")
            if not isinstance(profile, Mapping):
                profile = {}
            display_name = _first_non_empty_string(
                profile.get("display_name_normalized"),
                profile.get("real_name_normalized"),
            )
            email = _optional_non_empty_string(profile.get("email"))
            entries.append(DirectoryEntry(ProviderUserId(provider_user_id), display_name, email))
        return tuple(entries)

    @staticmethod
    def _pagination(response_metadata: JsonValue) -> _SlackDirectoryPagination | None:
        if not isinstance(response_metadata, Mapping) or "next_cursor" not in response_metadata:
            return None
        next_cursor = response_metadata.get("next_cursor")
        if not isinstance(next_cursor, str):
            return None
        return _SlackDirectoryPagination(next_cursor or None)


class _SlackMessaging(IMMessaging):
    def __init__(self, client: WebClient) -> None:
        self._client = client

    @override
    def send_text(self, provider_user_id: ProviderUserId, body: str) -> MessageSendingResult:
        try:
            response = self._client.chat_postMessage(
                channel=str(provider_user_id),
                markdown_text=body,
            )
        except SlackClientError:
            return MessageSendingError("Slack message acceptance could not be confirmed.")
        return _accepted_message(response, "text")


class _SlackDynamicCardMessaging(IMDynamicCardMessaging):
    _STALE_MESSAGE_ERROR_CODES: ClassVar[frozenset[str]] = frozenset(
        (
            "cant_update_message",
            "channel_not_found",
            "edit_window_closed",
            "message_not_found",
        )
    )

    def __init__(self, client: WebClient, codec: _SlackCardCodec) -> None:
        self._client = client
        self._codec = codec

    @override
    def assess(self, intent: ResolvedForm) -> CardAssessment:
        return self._codec.assess(intent)

    @override
    def send_card(
        self,
        provider_user_id: ProviderUserId,
        intent: ResolvedForm,
        correlation_token: CorrelationToken,
    ) -> MessageSendingResult:
        assessment = self._codec.assess(intent)
        if not assessment.representable:
            raise DynamicCardMessagingError(assessment.reason or "Slack cannot preserve this card.")
        encoded_card = self._codec.encode(intent, correlation_token)
        encoded_blocks = encoded_card.get("blocks")
        if not isinstance(encoded_blocks, list) or any(not isinstance(block, dict) for block in encoded_blocks):
            raise RuntimeError("Slack card codec returned an invalid wire payload.")
        blocks = [block for block in encoded_blocks if isinstance(block, dict)]
        try:
            response = self._client.chat_postMessage(
                channel=str(provider_user_id),
                blocks=blocks,
            )
        except SlackClientError:
            return MessageSendingError("Slack card acceptance could not be confirmed.")
        return _accepted_message(response, "dynamic_card")

    @override
    def replace_with_static(
        self,
        reference: MessageReference,
        intent: StaticCardIntent,
    ) -> ReplacementError | None:
        if not isinstance(reference, _SlackMessageLocator) or reference.message_kind != "dynamic_card":
            return ReplacementError(ReplacementErrorKind.INVALID_REFERENCE, "The Slack message reference is invalid.")
        locator = reference
        try:
            response = self._client.chat_update(
                channel=locator.channel_id,
                ts=locator.message_ts,
                text=intent.rendered_content,
                blocks=[],
            )
        except SlackApiError as error:
            error_code = _slack_error_code(error)
            if error_code in self._STALE_MESSAGE_ERROR_CODES:
                return ReplacementError(
                    ReplacementErrorKind.STALE_REFERENCE,
                    "The referenced Slack card is no longer replaceable.",
                )
            return ReplacementError(ReplacementErrorKind.UNKNOWN, "Slack replacement acceptance is unknown.")
        except SlackClientError:
            return ReplacementError(ReplacementErrorKind.UNKNOWN, "Slack replacement acceptance is unknown.")
        if response.get("ok") is not True:
            return ReplacementError(ReplacementErrorKind.UNKNOWN, "Slack replacement acceptance is unknown.")
        return None


class _SlackWebhookHandler(IMWebhookHandler):
    _JSON_CONTENT_TYPE: ClassVar[str] = "application/json"
    _FORM_CONTENT_TYPE: ClassVar[str] = "application/x-www-form-urlencoded"

    def __init__(self, signing_secret: str, consumer: IMEventConsumer) -> None:
        self._signing_secret = signing_secret
        self._consumer = consumer

    @override
    def handle(self, request: WebhookRequest) -> WebhookResponse:
        if not self._authenticated(request):
            return _webhook_response(401, b"request authentication failed")
        if request.method != "POST":
            return _webhook_response(405, b"method not allowed")
        body = self._decoded_body(request)
        if body is None:
            return _webhook_response(400, b"invalid Slack request")
        if body.get("type") == "url_verification":
            challenge = body.get("challenge")
            if not isinstance(challenge, str):
                return _webhook_response(400, b"invalid Slack challenge")
            response_body = json.dumps({"challenge": challenge}, separators=(",", ":")).encode()
            return WebhookResponse(200, (("Content-Type", "application/json"),), response_body)
        event = _authenticated_event(body, request.received_at)
        if event is None:
            return _webhook_response(400, b"invalid Slack event")
        try:
            acceptance = self._consumer.accept(event)
        except Exception:
            _log_safe_error(
                "Slack Webhook consumer failed",
                extra={"provider_tenant_id": event.provider_tenant_id},
            )
            return _webhook_response(503, b"event processing failed")
        if acceptance is EventAcceptance.ACCEPTED:
            return _webhook_response(200, b"")
        return _webhook_response(503, b"event not accepted")

    def _authenticated(self, request: WebhookRequest) -> bool:
        timestamps = _header_values(request.headers, "x-slack-request-timestamp")
        signatures = _header_values(request.headers, "x-slack-signature")
        if len(timestamps) != 1 or len(signatures) != 1:
            return False
        try:
            verifier = SignatureVerifier(
                self._signing_secret,
                clock=_TrustedReceiveTimeClock(request.received_at),
            )
            return verifier.is_valid(
                body=request.body,
                timestamp=timestamps[0],
                signature=signatures[0],
            )
        except (UnicodeDecodeError, ValueError):
            return False
        except Exception:
            _log_safe_error("Unexpected Slack Webhook signature verification failure")
            return False

    @staticmethod
    def _decoded_body(request: WebhookRequest) -> dict[str, JsonValue] | None:
        content_type = _parse_content_type(request.headers)
        if content_type == _SlackWebhookHandler._JSON_CONTENT_TYPE:
            try:
                decoded: JsonValue = json.loads(request.body)
            except (UnicodeDecodeError, json.JSONDecodeError):
                return None
        elif content_type == _SlackWebhookHandler._FORM_CONTENT_TYPE:
            try:
                form_values = parse_qs(request.body.decode("utf-8"), strict_parsing=True)
            except (UnicodeDecodeError, ValueError):
                return None
            payload_values = form_values.get("payload")
            if payload_values is None or len(payload_values) != 1:
                return None
            try:
                decoded = json.loads(payload_values[0])
            except json.JSONDecodeError:
                return None
        else:
            return None
        if not isinstance(decoded, dict):
            return None
        return decoded


class _SlackEventStream(IMEventStream):
    """One owner-managed Socket Mode client with a one-shot lifecycle."""

    _WEB_API_TIMEOUT_SECONDS: ClassVar[int] = 5
    _BUSINESS_REQUEST_TYPES: ClassVar[frozenset[str]] = frozenset(("events_api", "interactive", "slash_commands"))
    _SDK_LOGGER: ClassVar[logging.Logger] = logging.Logger(f"{__name__}.socket_sdk")
    _SDK_LOGGER.addHandler(logging.NullHandler())
    _SDK_LOGGER.propagate = False

    def __init__(
        self,
        *,
        app_token: str,
        bot_token: str,
        consumer: IMEventConsumer,
    ) -> None:
        self._app_token = app_token
        self._bot_token = bot_token
        self._consumer = consumer
        self._client: BaseSocketModeClient | None = None
        self._start_attempted = False
        self._stop_requested = False
        self._stopped = False

    @override
    def start(self) -> None:
        if self._start_attempted or self._stopped:
            raise IMStreamStartError("This Slack event stream has already been started or stopped.")
        self._start_attempted = True

        client: BaseSocketModeClient | None = None
        try:
            web_client = WebClient(
                token=self._bot_token,
                timeout=self._WEB_API_TIMEOUT_SECONDS,
                retry_handlers=[],
            )
            client = SocketModeClient(
                app_token=self._app_token,
                logger=self._SDK_LOGGER,
                web_client=web_client,
                on_error_listeners=[self._handle_socket_error],
                on_close_listeners=[self._handle_socket_close],
            )
            client.socket_mode_request_listeners.append(self._handle_request)
            self._client = client
            client.connect()
        except SlackClientError:
            self._clean_up_failed_start(client)
            raise IMStreamStartError("The Slack event stream could not be started.") from None
        except Exception:
            _log_safe_error("Unexpected Slack Socket Mode startup failure")
            self._clean_up_failed_start(client)
            raise IMStreamStartError("The Slack event stream could not be started.") from None

    @override
    def stop(self) -> None:
        if self._stopped:
            return
        self._stop_requested = True
        client = self._client

        if client is None:
            self._stopped = True
            return

        try:
            client.close()
        except SlackClientError:
            _log_safe_error("Slack Socket Mode shutdown failure")
            raise IMStreamStopError("The Slack event stream could not be stopped.") from None
        except Exception:
            _log_safe_error("Unexpected Slack Socket Mode shutdown failure")
            raise IMStreamStopError("The Slack event stream could not be stopped.") from None

        self._client = None
        self._stopped = True

    def _clean_up_failed_start(self, client: BaseSocketModeClient | None) -> None:
        if client is None:
            return

        self._stop_requested = True
        try:
            client.close()
        except SlackClientError:
            _log_safe_error("Slack Socket Mode startup cleanup failure")
        except Exception:
            _log_safe_error("Unexpected Slack Socket Mode startup cleanup failure")
        else:
            self._client = None

    def _handle_socket_error(self, error: Exception) -> None:
        del error
        self._handle_remote_disconnect("Slack Socket Mode remote error")

    def _handle_socket_close(self, code: int, reason: str | None = None) -> None:
        del code, reason
        self._handle_remote_disconnect("Slack Socket Mode remote close")

    def _handle_remote_disconnect(self, log_message: str) -> None:
        if self._stop_requested:
            return
        _log_safe_error(log_message)

    def _handle_request(self, client: BaseSocketModeClient, request: SocketModeRequest) -> None:
        if request.type not in self._BUSINESS_REQUEST_TYPES:
            return
        try:
            serialized_request = request.to_dict()
            event_body = serialized_request.get("payload")
            if not isinstance(event_body, dict):
                return
            event = _authenticated_event(
                event_body,
                datetime.now(tz=UTC).replace(tzinfo=None),
                serialized_body=serialized_request,
            )
            if event is None:
                return
            acceptance = self._consumer.accept(event)
            if acceptance is EventAcceptance.ACCEPTED:
                client.send_socket_mode_response(SocketModeResponse(envelope_id=request.envelope_id))
        except SlackClientError:
            _log_safe_error("Slack Socket Mode event delivery failure")
        except Exception:
            _log_safe_error("Unexpected Slack Socket Mode callback failure")


class SlackIMProviderAdapter:
    """Externally serialized Slack capability composition root."""

    _BASELINE_BOT_SCOPES: ClassVar[frozenset[str]] = frozenset(("chat:write", "users:read", "users:read.email"))
    _AUTHENTICATION_ERROR_CODES: ClassVar[frozenset[str]] = frozenset(
        (
            "account_inactive",
            "invalid_auth",
            "not_authed",
            "token_expired",
            "token_revoked",
        )
    )

    @classmethod
    def card_event_decoder(cls) -> IMCardEventDecoder:
        """Return a credential-free decoder independent from root adapter instances."""
        return _SlackCardCodec()

    def __init__(self, credentials: SlackIMIntegrationCredentials) -> None:
        if not isinstance(credentials, SlackIMIntegrationCredentials):
            raise TypeError("Slack adapter requires resolved Slack credentials")
        self._credentials = credentials
        self._client = WebClient(token=credentials.bot_token, retry_handlers=[])
        self._directory = _SlackDirectory(self._client)
        self._messaging = _SlackMessaging(self._client)
        self._dynamic_card_messaging = _SlackDynamicCardMessaging(self._client, _SlackCardCodec())
        self._closed = False

    @property
    def provider(self) -> IMProvider:
        return IMProvider.SLACK

    def test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure:
        try:
            response = self._client.auth_test()
        except SlackApiError as error:
            kind = (
                CredentialTestFailureKind.AUTHENTICATION_REJECTED
                if _slack_error_code(error) in self._AUTHENTICATION_ERROR_CODES
                else CredentialTestFailureKind.UNKNOWN
            )
            return CredentialTestFailure(kind, "Slack rejected the credential test.")
        except SlackClientError:
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Slack credential testing could not be completed.",
            )
        except Exception:
            _log_safe_error("Unexpected Slack credential test failure")
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Slack credential testing could not be completed.",
            )

        team_id = response.get("team_id")
        if not isinstance(team_id, str) or not team_id:
            return CredentialTestFailure(
                CredentialTestFailureKind.TENANT_ID_UNAVAILABLE,
                "Slack did not provide a stable workspace identity.",
            )
        granted_scopes = _oauth_scopes(response.headers)
        if not self._BASELINE_BOT_SCOPES.issubset(granted_scopes):
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Slack baseline permissions could not be confirmed.",
            )
        try:
            connection_response = self._client.apps_connections_open(app_token=self._credentials.app_token)
        except SlackApiError as error:
            kind = (
                CredentialTestFailureKind.AUTHENTICATION_REJECTED
                if _slack_error_code(error) in self._AUTHENTICATION_ERROR_CODES
                else CredentialTestFailureKind.UNKNOWN
            )
            return CredentialTestFailure(kind, "Slack Socket Mode credentials could not be confirmed.")
        except SlackClientError:
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Slack Socket Mode credential testing could not be completed.",
            )
        except Exception:
            _log_safe_error("Unexpected Slack Socket Mode credential test failure")
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Slack credential testing could not be completed.",
            )
        connection_url = connection_response.get("url")
        if (
            connection_response.get("ok") is not True
            or not isinstance(connection_url, str)
            or not connection_url.strip()
        ):
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Slack Socket Mode credentials could not be confirmed.",
            )
        return CredentialTestSuccess(IMProvider.SLACK, team_id)

    @property
    def directory(self) -> IMDirectory:
        return self._directory

    @property
    def messaging(self) -> IMMessaging:
        return self._messaging

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging:
        return self._dynamic_card_messaging

    def create_webhook_handler(self, consumer: IMEventConsumer) -> IMWebhookHandler:
        return _SlackWebhookHandler(self._credentials.signing_secret, consumer)

    def create_stream_handler(self, consumer: IMEventConsumer) -> IMEventStream:
        return _SlackEventStream(
            app_token=self._credentials.app_token,
            bot_token=self._credentials.bot_token,
            consumer=consumer,
        )

    def close(self) -> None:
        self._closed = True


def _first_non_empty_string(*values: JsonValue) -> str | None:
    for value in values:
        normalized = _optional_non_empty_string(value)
        if normalized is not None:
            return normalized
    return None


def _optional_non_empty_string(value: JsonValue) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return value


def _accepted_message(
    response: SlackResponse,
    message_kind: Literal["text", "dynamic_card"],
) -> MessageSendingResult:
    if response.get("ok") is not True:
        return MessageSendingError("Slack message acceptance could not be confirmed.")
    channel_id = response.get("channel")
    message_ts = response.get("ts")
    if (
        not isinstance(channel_id, str)
        or not channel_id.strip()
        or not isinstance(message_ts, str)
        or _SlackMessageLocator._TIMESTAMP_PATTERN.fullmatch(message_ts) is None
    ):
        return MessageSendingError("Slack returned no exact message reference.")
    return MessageAccepted(_SlackMessageLocator(message_kind, channel_id, message_ts))


def _header_values(headers: tuple[tuple[str, str], ...], target_name: str) -> tuple[str, ...]:
    return tuple(value for name, value in headers if name.casefold() == target_name)


def _parse_content_type(headers: tuple[tuple[str, str], ...]) -> str | None:
    values = _header_values(headers, "content-type")
    if len(values) != 1:
        return None
    message = Message()
    message["Content-Type"] = values[0]
    return message.get_content_type()


def _webhook_response(status_code: int, body: bytes) -> WebhookResponse:
    return WebhookResponse(status_code, (("Content-Type", "text/plain; charset=utf-8"),), body)


def _authenticated_event(
    body: Mapping[str, JsonValue],
    received_at: datetime,
    *,
    serialized_body: Mapping[str, JsonValue] | None = None,
) -> AuthenticatedIMEvent | None:
    provider_tenant_id = _provider_tenant_id(body)
    if provider_tenant_id is None:
        return None
    inner_event = body.get("event")
    event_type = None
    if isinstance(inner_event, Mapping):
        event_type = _optional_non_empty_string(inner_event.get("type"))
    if event_type is None:
        event_type = _optional_non_empty_string(body.get("type"))
    event_id = _optional_non_empty_string(body.get("event_id"))
    occurred_at = None
    event_time = body.get("event_time")
    if isinstance(event_time, int | float) and not isinstance(event_time, bool):
        try:
            occurred_at = datetime.fromtimestamp(event_time, tz=UTC).replace(tzinfo=None)
        except (OverflowError, OSError, ValueError):
            occurred_at = None
    try:
        serialized = json.dumps(
            serialized_body if serialized_body is not None else body, sort_keys=True, separators=(",", ":")
        )
    except (TypeError, ValueError):
        return None
    return AuthenticatedIMEvent(
        provider=IMProvider.SLACK,
        provider_tenant_id=provider_tenant_id,
        event_id=event_id,
        event_type=event_type,
        occurred_at=occurred_at,
        received_at=received_at,
        payload=serialized,
    )


def _provider_tenant_id(body: Mapping[str, JsonValue]) -> str | None:
    direct = _optional_non_empty_string(body.get("team_id"))
    if direct is not None:
        return direct
    team = body.get("team")
    if isinstance(team, Mapping):
        nested = _optional_non_empty_string(team.get("id"))
        if nested is not None:
            return nested
    payload = body.get("payload")
    if isinstance(payload, Mapping):
        return _provider_tenant_id(payload)
    return None


def _slack_error_code(error: SlackApiError) -> str | None:
    error_code = error.response.get("error")
    return error_code if isinstance(error_code, str) else None


def _oauth_scopes(headers: Mapping[str, str] | None) -> frozenset[str]:
    if headers is None:
        return frozenset()
    for name, value in headers.items():
        if name.casefold() == "x-oauth-scopes":
            return frozenset(scope.strip() for scope in value.split(",") if scope.strip())
    return frozenset()


__all__ = ["SlackIMProviderAdapter"]
