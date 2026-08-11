from __future__ import annotations

import inspect
import json
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import fields
from datetime import datetime
from pathlib import Path

import pytest

from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ParagraphInput, ResolvedForm, ResolvedFormAction, SelectInput
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import ms_teams
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    CardAssessment,
    CorrelationToken,
    DynamicCardMessagingError,
    IMCardEvent,
    ProviderUserId,
    UnrecognizedIMEvent,
)

_CALLBACK_FIXTURE_PATH = Path(__file__).parent / "fixtures" / "ms_teams_card_submit.json"
_RECEIVED_AT = datetime(2026, 8, 12, 2, 26, 40)
_MISSING_CALLBACK_VALUE = object()


def _form(*, first_input_name: str = "comment-🧪") -> ResolvedForm:
    return ResolvedForm(
        title="Approval request",
        blocks=(
            MarkdownText("Review the generated answer."),
            ParagraphInput(first_input_name, "Looks good"),
            SelectInput("decision", ("ship", "hold"), "hold"),
        ),
        user_actions=(
            ResolvedFormAction("approve-✅", "Approve", ButtonStyle.PRIMARY),
            ResolvedFormAction("reject", "Reject", ButtonStyle.ACCENT),
        ),
        legacy_form_content="This value must not be rendered",
    )


def _callback_fixture() -> dict[str, object]:
    callback = json.loads(_CALLBACK_FIXTURE_PATH.read_text())
    assert isinstance(callback, dict)
    return callback


def _event(
    callback: dict[str, object] | None = None,
    *,
    provider: IMProvider = IMProvider.MS_TEAMS,
    event_type: str | None = "message",
    payload: str | None = None,
) -> AuthenticatedIMEvent:
    serialized_payload = payload
    if serialized_payload is None:
        serialized_payload = json.dumps(callback or _callback_fixture(), ensure_ascii=False, separators=(",", ":"))
    return AuthenticatedIMEvent(
        provider=provider,
        provider_tenant_id="test-only-tenant",
        event_id="test-only-card-event",
        event_type=event_type,
        occurred_at=None,
        received_at=_RECEIVED_AT,
        payload=serialized_payload,
    )


def test_class_level_codec_encodes_the_complete_collision_safe_adaptive_card() -> None:
    decoder = ms_teams.MSTeamsIMProviderAdapter.card_event_decoder()

    assert isinstance(decoder, ms_teams._MSTeamsCardCodec)
    assert fields(decoder) == ()
    assert decoder.assess(_form()) == CardAssessment(representable=True)
    assert decoder.encode(_form(), CorrelationToken("correlation-🔐")) == {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "body": [
            {
                "type": "TextBlock",
                "text": "Approval request",
                "wrap": True,
                "size": "Medium",
                "weight": "Bolder",
            },
            {
                "type": "TextBlock",
                "text": "Review the generated answer.",
                "wrap": True,
            },
            {
                "type": "Input.Text",
                "id": "comment-🧪",
                "label": "comment-🧪",
                "isMultiline": True,
                "value": "Looks good",
            },
            {
                "type": "Input.ChoiceSet",
                "id": "decision",
                "label": "decision",
                "choices": [
                    {"title": "ship", "value": "ship"},
                    {"title": "hold", "value": "hold"},
                ],
                "style": "compact",
                "value": "hold",
            },
        ],
        "actions": [
            {
                "type": "Action.Submit",
                "title": "Approve",
                "data": {
                    "__dify.human_input": {
                        "version": 1,
                        "action_id": "approve-✅",
                        "correlation_token": "correlation-🔐",
                    }
                },
            },
            {
                "type": "Action.Submit",
                "title": "Reject",
                "data": {
                    "__dify.human_input": {
                        "version": 1,
                        "action_id": "reject",
                        "correlation_token": "correlation-🔐",
                    }
                },
            },
        ],
    }


def test_codec_renders_select_input_as_compact_choice_set() -> None:
    form = ResolvedForm(
        title=None,
        blocks=(SelectInput("decision", ("ship", "hold"), "hold"),),
        user_actions=(),
        legacy_form_content="unused",
    )

    card = ms_teams._MSTeamsCardCodec().encode(form, CorrelationToken("correlation"))

    assert card["body"] == [
        {
            "type": "Input.ChoiceSet",
            "id": "decision",
            "label": "decision",
            "choices": [
                {"title": "ship", "value": "ship"},
                {"title": "hold", "value": "hold"},
            ],
            "style": "compact",
            "value": "hold",
        }
    ]


def test_codec_rejects_the_reserved_metadata_member_before_provider_io() -> None:
    codec = ms_teams._MSTeamsCardCodec()
    colliding_form = _form(first_input_name="__dify.human_input")

    assessment = codec.assess(colliding_form)

    assert assessment.representable is False
    assert assessment.reason == "Microsoft Teams card input identifier is reserved."
    with pytest.raises(DynamicCardMessagingError) as raised:
        codec.encode(colliding_form, CorrelationToken("correlation"))
    assert str(raised.value) == assessment.reason


@pytest.mark.parametrize("activity_type", ["message", "invoke"])
def test_sanitized_submit_fixture_decodes_exact_unicode_round_trip(activity_type: str) -> None:
    callback = _callback_fixture()
    callback["type"] = activity_type

    result = ms_teams.MSTeamsIMProviderAdapter.card_event_decoder().decode(_event(callback, event_type=activity_type))

    assert result == IMCardEvent(
        provider_user_id=ProviderUserId("test-only-teams-user"),
        action_id="approve-✅",
        inputs={"comment-🧪": "Ready 🚀", "decision": "ship"},
        correlation_token=CorrelationToken("correlation-🔐"),
    )
    assert "__dify.human_input" not in result.inputs


@pytest.mark.parametrize(
    "event",
    [
        _event(provider=IMProvider.SLACK, payload="not-json"),
        _event(event_type="conversationUpdate", payload="not-json"),
        _event(
            {
                "type": "message",
                "from": {"id": "foreign-user"},
                "value": {"foreign": "interaction"},
            }
        ),
        _event(
            {
                "type": "invoke",
                "from": {"id": "foreign-user"},
                "value": {"__dify.human_input.legacy": {"action_id": "legacy"}},
            },
            event_type="invoke",
        ),
    ],
    ids=("foreign-provider", "non-card-type", "foreign-message", "near-marker"),
)
def test_non_applicable_or_foreign_events_are_unrecognized(event: AuthenticatedIMEvent) -> None:
    result = ms_teams.MSTeamsIMProviderAdapter.card_event_decoder().decode(event)

    assert isinstance(result, UnrecognizedIMEvent)


def test_decoder_removes_only_the_exact_internal_metadata_member() -> None:
    callback = _callback_fixture()
    callback_value = callback["value"]
    assert isinstance(callback_value, dict)
    callback_value["__dify.other"] = {"preserved": [True, None]}

    result = ms_teams.MSTeamsIMProviderAdapter.card_event_decoder().decode(_event(callback))

    assert isinstance(result, IMCardEvent)
    assert result.inputs == {
        "comment-🧪": "Ready 🚀",
        "decision": "ship",
        "__dify.other": {"preserved": [True, None]},
    }


@pytest.mark.parametrize(
    "payload",
    [
        "not-json",
        "[]",
        '{"type":"message","value":{"__dify.human_input":NaN}}',
        '{"type":"message","value":{"__dify.human_input":{},"unsafe":1e400}}',
    ],
    ids=("invalid-json", "non-object-root", "non-standard-constant", "overflowing-input-number"),
)
def test_transport_discriminated_invalid_json_fails_safely(payload: str) -> None:
    with pytest.raises(ms_teams.IMCardEventDecodingError) as raised:
        ms_teams.MSTeamsIMProviderAdapter.card_event_decoder().decode(_event(payload=payload))

    assert str(raised.value) in {
        "Microsoft Teams card event payload is invalid.",
        "Microsoft Teams card event schema is invalid.",
    }


@pytest.mark.parametrize("activity_type", ["message", "invoke"])
@pytest.mark.parametrize(
    "foreign_value",
    [_MISSING_CALLBACK_VALUE, None, "value", [], True, 1],
    ids=("missing", "null", "string", "array", "boolean", "integer"),
)
def test_applicable_callback_without_object_marker_is_unrecognized(
    activity_type: str,
    foreign_value: object,
) -> None:
    callback = _callback_fixture()
    callback["type"] = activity_type
    if foreign_value is _MISSING_CALLBACK_VALUE:
        callback.pop("value")
    else:
        callback["value"] = foreign_value

    result = ms_teams.MSTeamsIMProviderAdapter.card_event_decoder().decode(_event(callback, event_type=activity_type))

    assert isinstance(result, UnrecognizedIMEvent)


def test_recognized_callback_rejects_internal_actor_field_name() -> None:
    callback = _callback_fixture()
    callback.pop("from")
    callback["actor"] = {"id": "fabricated-user"}

    with pytest.raises(
        ms_teams.IMCardEventDecodingError,
        match=r"^Microsoft Teams card event schema is invalid\.$",
    ) as raised:
        ms_teams.MSTeamsIMProviderAdapter.card_event_decoder().decode(_event(callback))

    assert "fabricated-user" not in repr(raised.value)
    assert raised.value.__cause__ is None
    assert raised.value.__context__ is None


@pytest.mark.parametrize("invalid_actor", [None, "actor", {}, {"id": ""}, {"id": " "}, {"id": True}])
def test_recognized_callback_rejects_missing_or_invalid_actor(invalid_actor: object) -> None:
    callback = _callback_fixture()
    if invalid_actor is None:
        callback.pop("from")
    else:
        callback["from"] = invalid_actor

    with pytest.raises(
        ms_teams.IMCardEventDecodingError,
        match=r"^Microsoft Teams card event schema is invalid\.$",
    ):
        ms_teams.MSTeamsIMProviderAdapter.card_event_decoder().decode(_event(callback))


@pytest.mark.parametrize(
    "invalid_metadata",
    [
        None,
        "metadata",
        [],
        {},
        {"version": 2, "action_id": "approve", "correlation_token": "correlation"},
        {"version": 1, "correlation_token": "correlation"},
        {"version": 1, "action_id": "", "correlation_token": "correlation"},
        {"version": 1, "action_id": True, "correlation_token": "correlation"},
        {"version": 1, "action_id": "approve"},
        {"version": 1, "action_id": "approve", "correlation_token": None},
        {"version": 1, "action_id": "approve", "correlation_token": 7},
        {
            "version": 1,
            "action_id": "approve",
            "correlation_token": "correlation",
            "foreign": "member",
        },
    ],
    ids=(
        "null",
        "string",
        "array",
        "missing-members",
        "version",
        "missing-action",
        "empty-action",
        "typed-action",
        "missing-token",
        "null-token",
        "typed-token",
        "extra-member",
    ),
)
def test_recognized_callback_rejects_invalid_metadata(invalid_metadata: object) -> None:
    callback = _callback_fixture()
    callback_value = callback["value"]
    assert isinstance(callback_value, dict)
    callback_value["__dify.human_input"] = invalid_metadata

    with pytest.raises(
        ms_teams.IMCardEventDecodingError,
        match=r"^Microsoft Teams card event schema is invalid\.$",
    ):
        ms_teams.MSTeamsIMProviderAdapter.card_event_decoder().decode(_event(callback))


def test_decoding_error_does_not_retain_callback_secrets_or_validation_exceptions() -> None:
    callback = _callback_fixture()
    callback["from"] = {"id": "secret-actor", "name": "secret-profile"}
    callback_value = callback["value"]
    assert isinstance(callback_value, dict)
    callback_value["__dify.human_input"] = {
        "version": 1,
        "action_id": 7,
        "correlation_token": "secret-correlation-token",
    }
    callback_value["secret-input-name"] = "secret-submitted-value"

    with pytest.raises(ms_teams.IMCardEventDecodingError) as raised:
        ms_teams.MSTeamsIMProviderAdapter.card_event_decoder().decode(_event(callback))

    diagnostic = " ".join((str(raised.value), repr(raised.value), repr(raised.value.args)))
    for sensitive_value in (
        "secret-actor",
        "secret-profile",
        "secret-correlation-token",
        "secret-input-name",
        "secret-submitted-value",
    ):
        assert sensitive_value not in diagnostic
    assert raised.value.__cause__ is None
    assert raised.value.__context__ is None


def test_sanitized_callback_fixture_contains_no_live_identity_or_credential_facts() -> None:
    fixture_text = _CALLBACK_FIXTURE_PATH.read_text()
    normalized_fixture = fixture_text.casefold()

    for forbidden_marker in (
        "aadobjectid",
        "authorization",
        "bearer ",
        "client_secret",
        "access_token",
        "refresh_token",
        "private_key",
        "password",
        "experiment_id",
    ):
        assert forbidden_marker not in normalized_fixture


def test_class_level_decoder_discovery_constructs_no_credential_or_provider_clients(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected_dependency(*args: object, **kwargs: object) -> object:
        del args, kwargs
        raise AssertionError("class-level decoder discovery must not construct provider dependencies")

    monkeypatch.setattr(ms_teams, "ClientSecretCredential", unexpected_dependency)
    monkeypatch.setattr(ms_teams.httpx, "Client", unexpected_dependency)
    monkeypatch.setattr(ms_teams, "MicrosoftAppCredentials", unexpected_dependency)
    monkeypatch.setattr(ms_teams, "ConnectorClient", unexpected_dependency)

    decoder = ms_teams.MSTeamsIMProviderAdapter.card_event_decoder()

    assert isinstance(decoder, ms_teams._MSTeamsCardCodec)
    codec_source = inspect.getsource(ms_teams._MSTeamsCardCodec)
    for forbidden_dependency in (
        "ClientSecretCredential",
        "MicrosoftAppCredentials",
        "ConnectorClient",
        "MSTeamsIMIntegrationCredentials",
        "Contact",
        "VerifiedIMIdentityProof",
        "SubmissionService",
        "Workflow",
    ):
        assert forbidden_dependency not in codec_source


def test_one_decoder_handles_independent_callbacks_concurrently() -> None:
    decoder = ms_teams.MSTeamsIMProviderAdapter.card_event_decoder()

    def decode_callback(index: int) -> IMCardEvent:
        callback = deepcopy(_callback_fixture())
        callback["from"] = {"id": f"test-only-user-{index}"}
        callback_value = callback["value"]
        assert isinstance(callback_value, dict)
        callback_value["__dify.human_input"] = {
            "version": 1,
            "action_id": f"action-{index}",
            "correlation_token": f"correlation-{index}",
        }
        callback_value["sequence"] = index
        result = decoder.decode(_event(callback))
        assert isinstance(result, IMCardEvent)
        return result

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = tuple(executor.map(decode_callback, range(32)))

    assert [result.action_id for result in results] == [f"action-{index}" for index in range(32)]
    assert [result.inputs["sequence"] for result in results] == list(range(32))
    assert [str(result.correlation_token) for result in results] == [f"correlation-{index}" for index in range(32)]


def test_decoder_remains_usable_across_credential_rotation_and_root_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _ClosableDependency:
        def __init__(self) -> None:
            self.close_count = 0

        def close(self) -> None:
            self.close_count += 1

    graph_credentials: list[_ClosableDependency] = []
    graph_clients: list[_ClosableDependency] = []

    def graph_credential_factory(*args: object, **kwargs: object) -> _ClosableDependency:
        del args, kwargs
        dependency = _ClosableDependency()
        graph_credentials.append(dependency)
        return dependency

    def graph_client_factory(*args: object, **kwargs: object) -> _ClosableDependency:
        del args, kwargs
        dependency = _ClosableDependency()
        graph_clients.append(dependency)
        return dependency

    def bot_credential_factory(*args: object, **kwargs: object) -> object:
        del args, kwargs
        return object()

    monkeypatch.setattr(ms_teams, "ClientSecretCredential", graph_credential_factory)
    monkeypatch.setattr(ms_teams.httpx, "Client", graph_client_factory)
    monkeypatch.setattr(ms_teams, "MicrosoftAppCredentials", bot_credential_factory)
    decoder = ms_teams.MSTeamsIMProviderAdapter.card_event_decoder()
    first_adapter = ms_teams.MSTeamsIMProviderAdapter(
        ms_teams.MSTeamsIMIntegrationCredentials(
            provider=IMProvider.MS_TEAMS,
            tenant_id="11111111-1111-1111-1111-111111111111",
            client_id="22222222-2222-2222-2222-222222222222",
            client_secret="first-secret",
        )
    )
    second_adapter = ms_teams.MSTeamsIMProviderAdapter(
        ms_teams.MSTeamsIMIntegrationCredentials(
            provider=IMProvider.MS_TEAMS,
            tenant_id="33333333-3333-3333-3333-333333333333",
            client_id="44444444-4444-4444-4444-444444444444",
            client_secret="rotated-secret",
        )
    )

    first_adapter.close()
    second_adapter.close()
    result = decoder.decode(_event())

    assert isinstance(result, IMCardEvent)
    assert [dependency.close_count for dependency in graph_credentials] == [1, 1]
    assert [dependency.close_count for dependency in graph_clients] == [1, 1]
