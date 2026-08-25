from __future__ import annotations

import base64
import inspect
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal, Self, get_args, get_origin, get_type_hints

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import MessageLocator
from core.human_input_v2.im_integration.adapters import dingtalk as dingtalk_module
from core.human_input_v2.im_integration.adapters import feishu_lark as feishu_lark_module
from core.human_input_v2.im_integration.adapters import ms_teams as ms_teams_module
from core.human_input_v2.im_integration.adapters import slack as slack_module
from core.human_input_v2.im_integration.adapters import wecom as wecom_module
from core.human_input_v2.im_integration.adapters.message_locator import _Base64JSONLocatorPayload

_URLSAFE_BASE64_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
_ASCII_TEXT = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_:/.@"


@dataclass(frozen=True, slots=True)
class _PayloadCase:
    payload_cls: type[_Base64JSONLocatorPayload]
    example: dict[str, object]
    valid_providers: tuple[IMProvider, ...]
    expected_fields: frozenset[str]
    class_source_snippets: tuple[str, ...]


def _payload_cases() -> tuple[_PayloadCase, ...]:
    return (
        _PayloadCase(
            payload_cls=slack_module._SlackLocatorPayload,
            example={
                "v": 1,
                "p": IMProvider.SLACK,
                "channel_id": "D0123456789",
                "message_ts": "1712345678.123456",
            },
            valid_providers=(IMProvider.SLACK,),
            expected_fields=frozenset({"v", "p", "channel_id", "message_ts"}),
            class_source_snippets=(
                "# version of the locator",
                "# provider of the locator",
                "# Slack channel containing the message to update:",
                "# https://docs.slack.dev/reference/methods/chat.update/",
                "# Slack timestamp of the message to update:",
            ),
        ),
        _PayloadCase(
            payload_cls=feishu_lark_module._FeishuLarkLocatorPayload,
            example={
                "v": 1,
                "p": IMProvider.FEISHU,
                "message_id": "om_sanitized_card",
            },
            valid_providers=(IMProvider.FEISHU, IMProvider.LARK),
            expected_fields=frozenset({"v", "p", "message_id"}),
            class_source_snippets=(
                "# version of the locator",
                "# provider of the locator",
                "# Feishu/Lark message identifier used to update the card:",
                "# Feishu: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/patch",
                "# Lark: https://open.larksuite.com/document/server-docs/im-v1/message-card/patch",
            ),
        ),
        _PayloadCase(
            payload_cls=dingtalk_module._DingTalkLocatorPayload,
            example={
                "v": 1,
                "p": IMProvider.DING_TALK,
                "process_query_key": "sanitized-process-key",
            },
            valid_providers=(IMProvider.DING_TALK,),
            expected_fields=frozenset({"v", "p", "process_query_key"}),
            class_source_snippets=(
                "# version of the locator",
                "# provider of the locator",
                "# DingTalk process query key returned for the sent message:",
                "# https://open.dingtalk.com/document/orgapp/chatbots-send-one-on-one-chat-messages-in-batches.md",
            ),
        ),
        _PayloadCase(
            payload_cls=wecom_module._WeComLocatorPayload,
            example={
                "v": 1,
                "p": IMProvider.WE_COM,
                "message_id": "fake-message-id-001",
            },
            valid_providers=(IMProvider.WE_COM,),
            expected_fields=frozenset({"v", "p", "message_id"}),
            class_source_snippets=(
                "# version of the locator",
                "# provider of the locator",
                "# WeCom application message identifier returned by the send API:",
                "# https://developer.work.weixin.qq.com/document/path/90236",
            ),
        ),
        _PayloadCase(
            payload_cls=ms_teams_module._MSTeamsLocatorPayload,
            example={
                "v": 1,
                "p": IMProvider.MS_TEAMS,
                "service_url": "https://smba.trafficmanager.net/teams/",
                "conversation_id": "sanitized-conversation",
                "activity_id": "sanitized-activity",
            },
            valid_providers=(IMProvider.MS_TEAMS,),
            expected_fields=frozenset({"v", "p", "service_url", "conversation_id", "activity_id"}),
            class_source_snippets=(
                "# version of the locator",
                "# provider of the locator",
                "# Bot Framework service endpoint used for subsequent message operations:",
                "# https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference?view=azure-bot-service-4.0",
                "# Bot Framework conversation containing the activity:",
                "# Bot Framework activity identifier of the exact message:",
            ),
        ),
    )


def _json_text_round_trip(locator: MessageLocator) -> MessageLocator:
    stored = json.dumps({"locator": str(locator)}, separators=(",", ":"))
    recovered = json.loads(stored)["locator"]
    assert isinstance(recovered, str)
    return MessageLocator(recovered)


def _make_invalid_json_locator(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


def _non_blank_text(*, max_size: int = 24) -> st.SearchStrategy[str]:
    return st.text(alphabet=_ASCII_TEXT, min_size=1, max_size=max_size)


@st.composite
def _teams_service_url(draw) -> str:
    path = draw(st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789-/", min_size=0, max_size=24))
    return f"https://smba.trafficmanager.net/{path}" if path else "https://smba.trafficmanager.net/teams/"


def _is_scalar_like(annotation: object) -> bool:
    alias_value = getattr(annotation, "__value__", None)
    if alias_value is not None:
        return _is_scalar_like(alias_value)
    origin = get_origin(annotation)
    if origin is None:
        return annotation in (str, int, IMProvider) or isinstance(annotation, (str, int, IMProvider))
    if origin is Literal:
        return all(isinstance(argument, (str, int, IMProvider)) for argument in get_args(annotation))
    if origin is Annotated:
        return _is_scalar_like(get_args(annotation)[0])
    return False


@pytest.mark.parametrize("case", _payload_cases(), ids=lambda case: case.payload_cls.__name__)
def test_private_locator_payload_models_are_strict_frozen_scalar_only_and_provider_typed(
    case: _PayloadCase,
) -> None:
    payload_cls = case.payload_cls
    payload = payload_cls.model_validate(case.example)

    assert issubclass(payload_cls, _Base64JSONLocatorPayload)
    assert payload_cls.model_config.get("strict") is True
    assert payload_cls.model_config.get("frozen") is True
    assert payload_cls.model_config.get("extra") == "forbid"
    assert payload_cls.model_fields["v"].is_required()
    assert payload_cls.model_fields["p"].is_required()
    assert get_type_hints(payload_cls.encode)["return"] is MessageLocator
    assert get_type_hints(payload_cls.decode)["return"] in {Self, payload_cls}

    mutable_field = next(field_name for field_name in case.example if field_name not in {"v", "p"})
    with pytest.raises(ValidationError):
        setattr(payload, mutable_field, "mutated")
    with pytest.raises(ValidationError):
        payload_cls.model_validate({**case.example, "unexpected": "value"})
    with pytest.raises(ValidationError):
        payload_cls.model_validate({**case.example, "v": "1"})
    blank_field = next(field_name for field_name in case.example if field_name not in {"v", "p"})
    with pytest.raises(ValidationError):
        payload_cls.model_validate({**case.example, blank_field: " "})
    with pytest.raises(ValidationError):
        payload_cls.model_validate({key: value for key, value in case.example.items() if key != "v"})
    with pytest.raises(ValidationError):
        payload_cls.model_validate({key: value for key, value in case.example.items() if key != "p"})
    with pytest.raises(ValidationError):
        payload_cls.model_validate({**case.example, "v": 2})
    assert payload_cls.model_validate({**case.example, "p": case.example["p"]}) == payload

    for valid_provider in case.valid_providers:
        validated = payload_cls.model_validate({**case.example, "p": valid_provider})
        assert isinstance(validated.p, IMProvider)
        assert validated.p is valid_provider

    wrong_provider = next(provider for provider in IMProvider if provider not in case.valid_providers)
    with pytest.raises(ValidationError):
        payload_cls.model_validate({**case.example, "p": wrong_provider})

    for field_name, field in payload_cls.model_fields.items():
        assert _is_scalar_like(field.annotation), field_name


@pytest.mark.parametrize("case", _payload_cases(), ids=lambda case: case.payload_cls.__name__)
def test_private_locator_payload_source_comments_and_urls_are_verbatim(case: _PayloadCase) -> None:
    payload_source = inspect.getsource(case.payload_cls)
    for snippet in case.class_source_snippets:
        assert snippet in payload_source


@pytest.mark.parametrize("case", _payload_cases(), ids=lambda case: case.payload_cls.__name__)
def test_locator_json_shape_is_exact_and_round_trips_through_public_scalar_boundary(case: _PayloadCase) -> None:
    payload = case.payload_cls.model_validate(case.example)
    encoded = payload.encode()
    recovered_locator = _json_text_round_trip(MessageLocator(encoded))
    decoded_payload = case.payload_cls.decode(str(recovered_locator))
    serialized_payload = base64.urlsafe_b64decode(str(recovered_locator) + ("=" * (-len(str(recovered_locator)) % 4)))
    decoded_json = json.loads(serialized_payload)

    assert decoded_payload == payload
    assert isinstance(decoded_json, dict)
    assert set(decoded_json) == case.expected_fields
    assert decoded_json["v"] == 1
    assert decoded_json["p"] == case.example["p"].value


@pytest.mark.parametrize(
    ("payload_cls", "invalid_locator"),
    [
        pytest.param(slack_module._SlackLocatorPayload, "invalid.", id="slack-invalid-alphabet"),
        pytest.param(slack_module._SlackLocatorPayload, "AA=", id="slack-malformed-padding"),
        pytest.param(slack_module._SlackLocatorPayload, "A", id="slack-invalid-length"),
        pytest.param(
            slack_module._SlackLocatorPayload,
            _make_invalid_json_locator(b"{"),
            id="slack-malformed-json",
        ),
        pytest.param(
            slack_module._SlackLocatorPayload,
            _make_invalid_json_locator(b'{"v":1,"p":"slack"}'),
            id="slack-incomplete-json",
        ),
        pytest.param(feishu_lark_module._FeishuLarkLocatorPayload, "invalid.", id="feishu-invalid-alphabet"),
        pytest.param(feishu_lark_module._FeishuLarkLocatorPayload, "AA=", id="feishu-malformed-padding"),
        pytest.param(feishu_lark_module._FeishuLarkLocatorPayload, "A", id="feishu-invalid-length"),
        pytest.param(dingtalk_module._DingTalkLocatorPayload, "invalid.", id="dingtalk-invalid-alphabet"),
        pytest.param(dingtalk_module._DingTalkLocatorPayload, "AA=", id="dingtalk-malformed-padding"),
        pytest.param(dingtalk_module._DingTalkLocatorPayload, "A", id="dingtalk-invalid-length"),
        pytest.param(wecom_module._WeComLocatorPayload, "invalid.", id="wecom-invalid-alphabet"),
        pytest.param(wecom_module._WeComLocatorPayload, "AA=", id="wecom-malformed-padding"),
        pytest.param(wecom_module._WeComLocatorPayload, "A", id="wecom-invalid-length"),
        pytest.param(ms_teams_module._MSTeamsLocatorPayload, "invalid.", id="teams-invalid-alphabet"),
        pytest.param(ms_teams_module._MSTeamsLocatorPayload, "AA=", id="teams-malformed-padding"),
        pytest.param(ms_teams_module._MSTeamsLocatorPayload, "A", id="teams-invalid-length"),
    ],
)
def test_locator_decoder_rejects_invalid_public_scalar_forms(
    payload_cls: type[_Base64JSONLocatorPayload],
    invalid_locator: str,
) -> None:
    with pytest.raises((ValidationError, ValueError)):
        payload_cls.decode(invalid_locator)


def test_locator_codec_helper_owns_model_json_and_base64_conversion_without_json_dumps_loads() -> None:
    helper_source = Path(inspect.getsourcefile(_Base64JSONLocatorPayload) or "").read_text(encoding="utf-8")

    assert 'self.model_dump_json().encode("utf-8")' in helper_source
    assert "return cls.model_validate_json(serialized_payload)" in helper_source
    assert helper_source.count("urlsafe_b64encode") == 1
    assert "json.dumps" not in helper_source
    assert "json.loads" not in helper_source


def test_adapter_modules_do_not_duplicate_locator_codec_logic() -> None:
    module_paths = (
        Path(slack_module.__file__).resolve(),
        Path(feishu_lark_module.__file__).resolve(),
        Path(dingtalk_module.__file__).resolve(),
        Path(wecom_module.__file__).resolve(),
        Path(ms_teams_module.__file__).resolve(),
    )

    for module_path in module_paths:
        source = module_path.read_text(encoding="utf-8")
        assert "urlsafe_b64encode" not in source
        assert ".model_dump_json()" not in source
        assert "_encode_reference(" not in source
        assert "_decode_reference(" not in source
        assert "_encode_message_locator(" not in source
        assert "_decode_message_locator(" not in source
        assert "_urlsafe_encode(" not in source
        assert "_urlsafe_decode(" not in source


@settings(max_examples=40)
@given(
    channel_id=_non_blank_text(),
    message_ts=st.tuples(
        st.integers(min_value=0, max_value=10**12),
        st.integers(min_value=0, max_value=999999),
    ).map(lambda parts: f"{parts[0]}.{parts[1]:06d}"),
)
def test_slack_locator_payload_obeys_the_codec_law(channel_id: str, message_ts: str) -> None:
    payload = slack_module._SlackLocatorPayload(
        v=1,
        p=IMProvider.SLACK,
        channel_id=channel_id,
        message_ts=message_ts,
    )
    encoded = payload.encode()

    assert _URLSAFE_BASE64_PATTERN.fullmatch(encoded) is not None
    assert slack_module._SlackLocatorPayload.decode(encoded) == payload


@settings(max_examples=40)
@given(
    provider=st.sampled_from((IMProvider.FEISHU, IMProvider.LARK)),
    message_id=_non_blank_text(),
)
def test_feishu_lark_locator_payload_obeys_the_codec_law(provider: IMProvider, message_id: str) -> None:
    payload = feishu_lark_module._FeishuLarkLocatorPayload(
        v=1,
        p=provider,
        message_id=message_id,
    )
    encoded = payload.encode()

    assert _URLSAFE_BASE64_PATTERN.fullmatch(encoded) is not None
    assert feishu_lark_module._FeishuLarkLocatorPayload.decode(encoded) == payload


@settings(max_examples=40)
@given(process_query_key=_non_blank_text())
def test_dingtalk_locator_payload_obeys_the_codec_law(process_query_key: str) -> None:
    payload = dingtalk_module._DingTalkLocatorPayload(
        v=1,
        p=IMProvider.DING_TALK,
        process_query_key=process_query_key,
    )
    encoded = payload.encode()

    assert _URLSAFE_BASE64_PATTERN.fullmatch(encoded) is not None
    assert dingtalk_module._DingTalkLocatorPayload.decode(encoded) == payload


@settings(max_examples=40)
@given(message_id=_non_blank_text())
def test_wecom_locator_payload_obeys_the_codec_law(message_id: str) -> None:
    payload = wecom_module._WeComLocatorPayload(
        v=1,
        p=IMProvider.WE_COM,
        message_id=message_id,
    )
    encoded = payload.encode()

    assert _URLSAFE_BASE64_PATTERN.fullmatch(encoded) is not None
    assert wecom_module._WeComLocatorPayload.decode(encoded) == payload


@settings(max_examples=40)
@given(
    service_url=_teams_service_url(),
    conversation_id=_non_blank_text(),
    activity_id=_non_blank_text(),
)
def test_ms_teams_locator_payload_obeys_the_codec_law(
    service_url: str,
    conversation_id: str,
    activity_id: str,
) -> None:
    payload = ms_teams_module._MSTeamsLocatorPayload(
        v=1,
        p=IMProvider.MS_TEAMS,
        service_url=service_url,
        conversation_id=conversation_id,
        activity_id=activity_id,
    )
    encoded = payload.encode()

    assert _URLSAFE_BASE64_PATTERN.fullmatch(encoded) is not None
    assert ms_teams_module._MSTeamsLocatorPayload.decode(encoded) == payload
