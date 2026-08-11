from __future__ import annotations

import base64
import importlib.util
import json
import pickle
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import fields
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import httpx
import jwt
import pytest
import requests
from azure.core.exceptions import ClientAuthenticationError
from botbuilder.schema import ConversationResourceResponse, ResourceResponse
from botframework.connector.auth import ChannelValidation, ClaimsIdentity, JwtTokenExtractor
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm
from msrest.exceptions import HttpOperationError

from core.human_input import ButtonStyle
from core.human_input_v2 import (
    FileInput,
    FileListInput,
    MarkdownText,
    ParagraphInput,
    ResolvedForm,
    ResolvedFormAction,
    ResolvedFormContent,
    SelectInput,
)
from core.human_input_v2.im_integration.adapters import ms_teams
from core.human_input_v2.im_provider import (
    CardAssessment,
    CorrelationToken,
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    Directory,
    DirectoryReadFailure,
    DynamicCardMessagingError,
    EventAcceptance,
    MessageAccepted,
    MessageReference,
    MessageSendingError,
    MSTeamsIMIntegrationCredentials,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    StaticCardIntent,
    WebhookRequest,
)

_RECEIVED_AT = datetime(2026, 8, 6, 8, 0, 0)
_WEBHOOK_FIXTURE_PATH = Path(__file__).parents[4] / "fixtures" / "im_provider" / "ms_teams_webhook_activity.json"
_UUID_PATTERN = re.compile(r"\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b")


def _credentials() -> MSTeamsIMIntegrationCredentials:
    return MSTeamsIMIntegrationCredentials(
        provider="ms_teams",
        tenant_id="11111111-1111-1111-1111-111111111111",
        client_id="22222222-2222-2222-2222-222222222222",
        client_secret="test-only-client-secret",
    )


class _Consumer:
    def accept(self, event) -> EventAcceptance:
        del event
        return EventAcceptance.ACCEPTED


class _RecordingConsumer:
    def __init__(self, acceptance: EventAcceptance = EventAcceptance.ACCEPTED) -> None:
        self.acceptance = acceptance
        self.events = []

    def accept(self, event) -> EventAcceptance:
        self.events.append(event)
        return self.acceptance


class _ThreadSafeRecordingConsumer:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.events = []

    def accept(self, event) -> EventAcceptance:
        with self._lock:
            self.events.append(event)
        return EventAcceptance.ACCEPTED


class _FailingConsumer:
    def accept(self, event) -> EventAcceptance:
        del event
        raise RuntimeError("sensitive consumer details")


class _ProviderMetadataResponse:
    def __init__(self, response_body: dict[str, object]) -> None:
        self._response_body = response_body

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self._response_body


class _ForeignMessageReference(MessageReference):
    pass


def _unsigned_token(claims: dict[str, object]) -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    return f"{header}.{payload}."


def _adapter_with_tokens(mocker, *, graph_claims: dict[str, object], bot_claims: dict[str, object]):
    graph_credential = mocker.patch.object(ms_teams, "ClientSecretCredential", autospec=True).return_value
    graph_credential.get_token.return_value = SimpleNamespace(token=_unsigned_token(graph_claims))
    graph_client = mocker.patch.object(ms_teams.httpx, "Client", autospec=True).return_value
    bot_credentials = mocker.patch.object(ms_teams, "MicrosoftAppCredentials", autospec=True).return_value
    bot_credentials.get_access_token.return_value = _unsigned_token(bot_claims)
    adapter = ms_teams.MSTeamsIMProviderAdapter(_credentials())
    return adapter, graph_credential, graph_client, bot_credentials


def _card_intent(
    *,
    input_type: str = "paragraph",
    markdown_text: str = "Rendered **content**",
    action_style: ButtonStyle = ButtonStyle.PRIMARY,
) -> ResolvedForm:
    if input_type == "select":
        input_block: ResolvedFormContent = SelectInput("comment", ("One", "Two"), "One")
    elif input_type == "file":
        input_block = FileInput("comment", (), (), ())
    elif input_type == "file-list":
        input_block = FileListInput("comment", (), (), (), 1)
    else:
        input_block = ParagraphInput("comment", "Initial")
    return ResolvedForm(
        title="Approval",
        blocks=(MarkdownText(markdown_text), input_block, MarkdownText("After input")),
        user_actions=(
            ResolvedFormAction("approve", "Approve", action_style),
            ResolvedFormAction("reject", "Reject", ButtonStyle.ACCENT),
        ),
        legacy_form_content="This value must not be rendered",
    )


def _custom_card_intent(
    *,
    blocks: tuple[ResolvedFormContent, ...],
    title: str | None = "Approval",
    action_style: ButtonStyle = ButtonStyle.DEFAULT,
) -> ResolvedForm:
    return ResolvedForm(
        title=title,
        blocks=blocks,
        user_actions=(ResolvedFormAction("approve", "Approve", action_style),),
        legacy_form_content="This value must not be rendered",
    )


def _teams_activity_body(*, include_event_id: bool = True) -> dict[str, object]:
    activity = json.loads(_WEBHOOK_FIXTURE_PATH.read_text())
    assert isinstance(activity, dict)
    conversation = activity["conversation"]
    channel_data = activity["channelData"]
    assert isinstance(conversation, dict)
    assert isinstance(channel_data, dict)
    tenant = channel_data["tenant"]
    assert isinstance(tenant, dict)
    conversation["tenantId"] = _credentials().tenant_id
    tenant["id"] = _credentials().tenant_id
    if include_event_id:
        activity["id"] = "sanitized-provider-event"
    else:
        activity.pop("id", None)
    return activity


def _webhook_request(activity: dict[str, object], *, authorization: str = "Bearer sanitized-token") -> WebhookRequest:
    return WebhookRequest(
        method="POST",
        headers=(
            ("Authorization", authorization),
            ("Content-Type", "application/json; charset=utf-8"),
        ),
        body=json.dumps(activity, separators=(",", ":")).encode(),
        received_at=_RECEIVED_AT,
    )


def _authenticated_webhook_handler(mocker, consumer):
    adapter, _, _, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    authenticate_request = mocker.patch.object(
        ms_teams.JwtTokenValidation,
        "authenticate_request",
        autospec=True,
    )
    authenticate_request.return_value = ClaimsIdentity(
        {"aud": _credentials().client_id, "iss": "https://api.botframework.com"},
        True,
    )
    return adapter, adapter.create_webhook_handler(consumer), authenticate_request


def test_ms_teams_adapter_module_is_available() -> None:
    assert importlib.util.find_spec("core.human_input_v2.im_integration.adapters.ms_teams") is not None


def test_ms_teams_adapter_class_is_available() -> None:
    assert hasattr(ms_teams, "MSTeamsIMProviderAdapter")


def test_ms_teams_adapter_rejects_any_other_credential_type() -> None:
    with pytest.raises(TypeError):
        ms_teams.MSTeamsIMProviderAdapter(None)


def test_construction_exposes_webhook_only_capabilities_without_provider_io(mocker) -> None:
    assert all(hasattr(ms_teams, name) for name in ("ClientSecretCredential", "MicrosoftAppCredentials", "httpx"))
    graph_credential = mocker.patch.object(ms_teams, "ClientSecretCredential", autospec=True).return_value
    graph_client = mocker.patch.object(ms_teams.httpx, "Client", autospec=True).return_value
    bot_credentials = mocker.patch.object(ms_teams, "MicrosoftAppCredentials", autospec=True).return_value
    adapter = ms_teams.MSTeamsIMProviderAdapter(_credentials())

    assert adapter.provider.value == "ms_teams"
    assert adapter.directory is adapter.directory
    assert adapter.messaging is adapter.messaging
    assert adapter.dynamic_card_messaging is adapter.dynamic_card_messaging
    assert adapter.create_webhook_handler(_Consumer()) is not None
    assert adapter.create_stream_handler(_Consumer()) is None
    graph_credential.get_token.assert_not_called()
    graph_client.request.assert_not_called()
    bot_credentials.get_access_token.assert_not_called()

    adapter.close()
    adapter.close()
    assert graph_credential.close.call_count == 2
    assert graph_client.close.call_count == 2


def test_credential_test_confirms_graph_permission_bot_auth_and_tenant(mocker) -> None:
    adapter, _, _, bot_credentials = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )

    assert hasattr(adapter, "test_credentials")
    assert adapter.test_credentials() == CredentialTestSuccess(adapter.provider, _credentials().tenant_id)


def test_credential_test_returns_safe_typed_failures(mocker) -> None:
    adapter, graph_credential, _, bot_credentials = _adapter_with_tokens(
        mocker,
        graph_claims={"aud": "https://graph.microsoft.com", "roles": ["User.Read.All"]},
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    unavailable = adapter.test_credentials()
    assert isinstance(unavailable, CredentialTestFailure)
    assert unavailable.kind is CredentialTestFailureKind.TENANT_ID_UNAVAILABLE

    graph_credential.get_token.return_value = SimpleNamespace(
        token=_unsigned_token(
            {
                "aud": "https://graph.microsoft.com",
                "tid": _credentials().tenant_id,
                "roles": [],
            }
        )
    )
    missing_permission = adapter.test_credentials()
    assert isinstance(missing_permission, CredentialTestFailure)
    assert missing_permission.kind is CredentialTestFailureKind.UNKNOWN

    graph_credential.get_token.return_value = SimpleNamespace(
        token=_unsigned_token(
            {
                "aud": "https://graph.microsoft.com",
                "tid": _credentials().tenant_id,
                "roles": ["User.Read.All"],
            }
        )
    )
    bot_credentials.get_access_token.side_effect = PermissionError("invalid_client: sensitive provider details")
    rejected = adapter.test_credentials()
    assert isinstance(rejected, CredentialTestFailure)
    assert rejected.kind is CredentialTestFailureKind.AUTHENTICATION_REJECTED
    assert "sensitive provider details" not in rejected.reason


def test_credential_test_treats_transient_bot_auth_failure_as_unknown(mocker) -> None:
    adapter, _, _, bot_credentials = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    bot_credentials.get_access_token.side_effect = PermissionError("temporarily_unavailable: test-only upstream outage")

    result = adapter.test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is CredentialTestFailureKind.UNKNOWN


def test_credential_test_compares_guid_claims_case_insensitively(mocker) -> None:
    credentials = MSTeamsIMIntegrationCredentials(
        provider="ms_teams",
        tenant_id="AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
        client_id="BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
        client_secret="test-only-client-secret",
    )
    graph_credential = mocker.patch.object(ms_teams, "ClientSecretCredential", autospec=True).return_value
    graph_credential.get_token.return_value = SimpleNamespace(
        token=_unsigned_token(
            {
                "aud": "https://graph.microsoft.com",
                "tid": credentials.tenant_id.lower(),
                "roles": ["User.Read.All"],
            }
        )
    )
    mocker.patch.object(ms_teams.httpx, "Client", autospec=True)
    bot_credentials = mocker.patch.object(ms_teams, "MicrosoftAppCredentials", autospec=True).return_value
    bot_credentials.get_access_token.return_value = _unsigned_token(
        {
            "aud": "https://api.botframework.com",
            "appid": credentials.client_id.lower(),
            "tid": credentials.tenant_id.lower(),
        }
    )
    adapter = ms_teams.MSTeamsIMProviderAdapter(credentials)

    result = adapter.test_credentials()

    assert result == CredentialTestSuccess(adapter.provider, credentials.tenant_id.lower())


@pytest.mark.parametrize("malformed_claim", ["graph_tenant", "bot_tenant", "bot_client"])
def test_credential_test_rejects_malformed_guid_claims_safely(mocker, malformed_claim: str) -> None:
    graph_tenant_id = _credentials().tenant_id
    bot_tenant_id = _credentials().tenant_id
    bot_client_id = _credentials().client_id
    if malformed_claim == "graph_tenant":
        graph_tenant_id = "not-a-guid"
    elif malformed_claim == "bot_tenant":
        bot_tenant_id = "not-a-guid"
    else:
        bot_client_id = "not-a-guid"
    adapter, _, _, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": graph_tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": bot_client_id,
            "tid": bot_tenant_id,
        },
    )

    result = adapter.test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is CredentialTestFailureKind.UNKNOWN


def test_credential_test_normalizes_graph_and_bot_boundary_failures(mocker, caplog) -> None:
    adapter, graph_credential, _, bot_credentials = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    graph_credential.get_token.side_effect = ClientAuthenticationError("sensitive graph rejection")
    graph_rejected = adapter.test_credentials()
    assert isinstance(graph_rejected, CredentialTestFailure)
    assert graph_rejected.kind is CredentialTestFailureKind.AUTHENTICATION_REJECTED

    graph_credential.get_token.side_effect = RuntimeError("sensitive graph failure")
    graph_unknown = adapter.test_credentials()
    assert isinstance(graph_unknown, CredentialTestFailure)
    assert graph_unknown.kind is CredentialTestFailureKind.UNKNOWN

    graph_credential.get_token.side_effect = None
    graph_credential.get_token.return_value = SimpleNamespace(token="not-a-jwt")
    malformed_graph_token = adapter.test_credentials()
    assert isinstance(malformed_graph_token, CredentialTestFailure)
    assert malformed_graph_token.kind is CredentialTestFailureKind.UNKNOWN

    graph_credential.get_token.return_value = SimpleNamespace(
        token=_unsigned_token(
            {
                "aud": "https://graph.microsoft.com",
                "tid": "33333333-3333-3333-3333-333333333333",
                "roles": ["User.Read.All"],
            }
        )
    )
    mismatched_graph_tenant = adapter.test_credentials()
    assert isinstance(mismatched_graph_tenant, CredentialTestFailure)
    assert mismatched_graph_tenant.kind is CredentialTestFailureKind.AUTHENTICATION_REJECTED

    graph_credential.get_token.return_value = SimpleNamespace(
        token=_unsigned_token(
            {
                "aud": "https://graph.microsoft.com",
                "tid": _credentials().tenant_id,
                "roles": ["User.Read.All"],
            }
        )
    )
    bot_credentials.get_access_token.side_effect = RuntimeError("sensitive bot failure")
    bot_unknown = adapter.test_credentials()
    assert isinstance(bot_unknown, CredentialTestFailure)
    assert bot_unknown.kind is CredentialTestFailureKind.UNKNOWN

    bot_credentials.get_access_token.side_effect = None
    bot_credentials.get_access_token.return_value = "not-a-jwt"
    malformed_bot_token = adapter.test_credentials()
    assert isinstance(malformed_bot_token, CredentialTestFailure)
    assert malformed_bot_token.kind is CredentialTestFailureKind.UNKNOWN
    assert "sensitive graph rejection" not in caplog.text
    assert "sensitive graph failure" not in caplog.text
    assert "sensitive bot failure" not in caplog.text


def test_directory_returns_one_ordered_complete_graph_snapshot(mocker) -> None:
    adapter, _, graph_client, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    graph_client.get.side_effect = [
        httpx.Response(
            200,
            request=httpx.Request("GET", "https://graph.microsoft.com/v1.0/users"),
            json={
                "value": [
                    {"id": "sanitized-user-a", "displayName": "Ada", "mail": "ada@example.test"},
                    {"id": "sanitized-user-b", "displayName": None, "mail": None},
                ],
                "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skiptoken=test-only-page",
            },
        ),
        httpx.Response(
            200,
            request=httpx.Request("GET", "https://graph.microsoft.com/v1.0/users"),
            json={"value": [{"id": "sanitized-user-c", "displayName": "Lin", "mail": None}]},
        ),
    ]

    assert hasattr(adapter.directory, "read_directory")
    snapshot = adapter.directory.read_directory()

    assert isinstance(snapshot, Directory)
    assert [(str(entry.provider_user_id), entry.display_name, entry.email) for entry in snapshot.entries] == [
        ("sanitized-user-a", "Ada", "ada@example.test"),
        ("sanitized-user-b", None, None),
        ("sanitized-user-c", "Lin", None),
    ]
    assert graph_client.get.call_count == 2


def test_directory_discards_partial_entries_and_rejects_untrusted_pagination(mocker) -> None:
    adapter, _, graph_client, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    graph_client.get.return_value = httpx.Response(
        200,
        request=httpx.Request("GET", "https://graph.microsoft.com/v1.0/users"),
        json={
            "value": [{"id": "sanitized-user-a", "displayName": "Ada", "mail": None}],
            "@odata.nextLink": "https://example.invalid/v1.0/users?$skiptoken=not-followed",
        },
    )

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert "sanitized-user-a" not in result.reason
    graph_client.get.assert_called_once()


def test_directory_normalizes_blank_optional_fields_and_rejects_pagination_loops(mocker) -> None:
    adapter, _, graph_client, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    next_link = "https://graph.microsoft.com/v1.0/users?$skiptoken=test-only-page"
    graph_client.get.side_effect = [
        httpx.Response(
            200,
            request=httpx.Request("GET", "https://graph.microsoft.com/v1.0/users"),
            json={
                "value": [{"id": "sanitized-user-a", "displayName": " ", "mail": ""}],
                "@odata.nextLink": next_link,
            },
        ),
        httpx.Response(
            200,
            request=httpx.Request("GET", next_link),
            json={"value": [], "@odata.nextLink": next_link},
        ),
    ]

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert graph_client.get.call_count == 2


def test_directory_normalizes_unexpected_failure_without_provider_details(mocker, caplog) -> None:
    adapter, _, graph_client, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    graph_client.get.side_effect = RuntimeError("sensitive graph response")

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert "sensitive graph response" not in result.reason
    assert "sensitive graph response" not in caplog.text


def test_text_send_resolves_personal_conversation_and_returns_exact_reference(mocker) -> None:
    adapter, _, _, bot_credentials = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    assert hasattr(ms_teams, "ConnectorClient")
    connector = ms_teams.ConnectorClient(bot_credentials, base_url="https://smba.trafficmanager.net/teams/")
    mocker.patch.object(ms_teams, "ConnectorClient", autospec=True, return_value=connector)
    create_conversation = mocker.patch.object(connector.conversations, "create_conversation", autospec=True)
    send_to_conversation = mocker.patch.object(connector.conversations, "send_to_conversation", autospec=True)
    create_conversation.return_value = ConversationResourceResponse(
        id="sanitized-conversation",
        service_url="https://smba.trafficmanager.net/teams/",
    )
    send_to_conversation.return_value = ResourceResponse(id="sanitized-activity")

    accepted = adapter.messaging.send_text(ProviderUserId("sanitized-user-a"), "**Review requested**")

    assert isinstance(accepted, MessageAccepted)
    assert "sanitized-conversation" not in repr(accepted.reference)
    conversation_parameters = connector.conversations.create_conversation.call_args.args[0]
    assert conversation_parameters.tenant_id == _credentials().tenant_id
    assert conversation_parameters.bot.id == f"28:{_credentials().client_id}"
    assert [member.id for member in conversation_parameters.members] == ["sanitized-user-a"]
    create_conversation.assert_called_once()
    send_to_conversation.assert_called_once()
    conversation_id, activity = send_to_conversation.call_args.args
    assert conversation_id == "sanitized-conversation"
    assert activity.type == "message"
    assert activity.text == "**Review requested**"
    assert connector.config.retry_policy.retries == 0


def test_text_send_failure_is_safe_and_does_not_replay_message_creation(mocker) -> None:
    adapter, _, _, bot_credentials = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    connector = ms_teams.ConnectorClient(bot_credentials, base_url="https://smba.trafficmanager.net/teams/")
    mocker.patch.object(ms_teams, "ConnectorClient", autospec=True, return_value=connector)
    create_conversation = mocker.patch.object(connector.conversations, "create_conversation", autospec=True)
    send_to_conversation = mocker.patch.object(connector.conversations, "send_to_conversation", autospec=True)
    create_conversation.return_value = ConversationResourceResponse(
        id="sanitized-conversation",
        service_url="https://smba.trafficmanager.net/teams/",
    )
    send_to_conversation.side_effect = RuntimeError("sensitive provider response")

    result = adapter.messaging.send_text(ProviderUserId("sanitized-user-a"), "Review requested")

    assert isinstance(result, MessageSendingError)
    assert "sensitive provider response" not in result.reason
    create_conversation.assert_called_once()
    send_to_conversation.assert_called_once()


@pytest.mark.parametrize(
    ("conversation_response", "message_response", "expected_send_count"),
    [
        (None, ResourceResponse(id="unused"), 0),
        (ConversationResourceResponse(id=None), ResourceResponse(id="unused"), 0),
        (
            ConversationResourceResponse(id="sanitized-conversation", service_url="https://example.invalid/"),
            ResourceResponse(id="unused"),
            0,
        ),
        (ConversationResourceResponse(id="sanitized-conversation"), None, 1),
        (ConversationResourceResponse(id="sanitized-conversation"), ResourceResponse(id=None), 1),
    ],
)
def test_text_send_requires_typed_exact_provider_acceptance(
    mocker,
    conversation_response,
    message_response,
    expected_send_count: int,
) -> None:
    adapter, _, _, bot_credentials = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    connector = ms_teams.ConnectorClient(bot_credentials, base_url="https://smba.trafficmanager.net/teams/")
    mocker.patch.object(ms_teams, "ConnectorClient", autospec=True, return_value=connector)
    create_conversation = mocker.patch.object(connector.conversations, "create_conversation", autospec=True)
    send_to_conversation = mocker.patch.object(connector.conversations, "send_to_conversation", autospec=True)
    create_conversation.return_value = conversation_response
    send_to_conversation.return_value = message_response

    result = adapter.messaging.send_text(ProviderUserId("sanitized-user-a"), "Review requested")

    assert isinstance(result, MessageSendingError)
    create_conversation.assert_called_once()
    assert send_to_conversation.call_count == expected_send_count


def test_card_assessment_accepts_complete_adaptive_card_intent_without_provider_io(mocker) -> None:
    adapter, _, _, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    connector_client = mocker.patch.object(ms_teams, "ConnectorClient", autospec=True)

    assessment = adapter.dynamic_card_messaging.assess(_card_intent(input_type="select"))

    assert assessment == CardAssessment(representable=True)
    connector_client.assert_not_called()


@pytest.mark.parametrize("input_type", ["file", "file-list"])
def test_card_assessment_rejects_any_unsupported_input_as_one_complete_intent(mocker, input_type: str) -> None:
    adapter, _, _, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    connector_client = mocker.patch.object(ms_teams, "ConnectorClient", autospec=True)

    assessment = adapter.dynamic_card_messaging.assess(_card_intent(input_type=input_type))

    assert assessment.representable is False
    assert assessment.reason
    connector_client.assert_not_called()


@pytest.mark.parametrize(
    "intent",
    [
        _card_intent(action_style=ButtonStyle.GHOST),
        _card_intent(markdown_text="x" * 30_000),
    ],
    ids=("unsupported-action-style", "provider-payload-limit"),
)
def test_card_assessment_rejects_unpreservable_presentation_facts(mocker, intent: ResolvedForm) -> None:
    adapter, _, _, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )

    assessment = adapter.dynamic_card_messaging.assess(intent)

    assert assessment.representable is False
    assert assessment.reason


def test_unrepresentable_card_send_fails_before_provider_state_creation(mocker) -> None:
    adapter, _, _, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    connector_client = mocker.patch.object(ms_teams, "ConnectorClient", autospec=True)

    with pytest.raises(DynamicCardMessagingError):
        adapter.dynamic_card_messaging.send_card(
            ProviderUserId("sanitized-user-a"),
            _card_intent(input_type="file"),
            CorrelationToken("sanitized-correlation"),
        )

    connector_client.assert_not_called()


@pytest.mark.parametrize(
    "intent",
    [
        _custom_card_intent(
            blocks=(SelectInput("choice", (), None),),
        ),
        _custom_card_intent(
            blocks=(SelectInput("choice", ("",), None),),
        ),
        _custom_card_intent(
            blocks=(SelectInput("choice", ("One", "One"), "One"),),
        ),
        _custom_card_intent(
            blocks=(
                ParagraphInput("comment", None),
                ParagraphInput("comment", None),
            ),
        ),
        _custom_card_intent(blocks=(MarkdownText(""),)),
        _custom_card_intent(blocks=(), title=""),
    ],
    ids=("empty-options", "empty-option", "duplicate-options", "duplicate-input", "empty-markdown", "empty-title"),
)
def test_card_assessment_rejects_unpreservable_resolved_controls_and_presentation(
    mocker,
    intent: ResolvedForm,
) -> None:
    adapter, _, _, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )

    assessment = adapter.dynamic_card_messaging.assess(intent)

    assert assessment.representable is False


def test_card_send_rejects_correlation_that_exceeds_provider_payload_limit_before_io(mocker) -> None:
    adapter, _, _, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    connector_client = mocker.patch.object(ms_teams, "ConnectorClient", autospec=True)

    with pytest.raises(DynamicCardMessagingError):
        adapter.dynamic_card_messaging.send_card(
            ProviderUserId("sanitized-user-a"),
            _card_intent(),
            CorrelationToken("x" * 30_000),
        )

    connector_client.assert_not_called()


@pytest.mark.parametrize("button_style", [ButtonStyle.PRIMARY, ButtonStyle.ACCENT, ButtonStyle.DEFAULT])
def test_card_renderer_omits_unsupported_teams_action_style(button_style: ButtonStyle) -> None:
    card = ms_teams._MSTeamsCardCodec().encode(
        _custom_card_intent(blocks=(), action_style=button_style),
        CorrelationToken("sanitized-correlation"),
    )

    assert card["actions"] == [
        {
            "type": "Action.Submit",
            "title": "Approve",
            "data": {
                "__dify.human_input": {
                    "version": 1,
                    "action_id": "approve",
                    "correlation_token": "sanitized-correlation",
                }
            },
        }
    ]


def test_card_send_preserves_controls_actions_and_correlation_in_one_message(mocker) -> None:
    adapter, _, _, bot_credentials = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    connector = ms_teams.ConnectorClient(bot_credentials, base_url="https://smba.trafficmanager.net/teams/")
    mocker.patch.object(ms_teams, "ConnectorClient", autospec=True, return_value=connector)
    create_conversation = mocker.patch.object(connector.conversations, "create_conversation", autospec=True)
    send_to_conversation = mocker.patch.object(connector.conversations, "send_to_conversation", autospec=True)
    create_conversation.return_value = ConversationResourceResponse(
        id="sanitized-conversation",
        service_url="https://smba.trafficmanager.net/teams/",
    )
    send_to_conversation.return_value = ResourceResponse(id="sanitized-card-activity")

    accepted = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("sanitized-user-a"),
        _card_intent(input_type="select"),
        CorrelationToken("sanitized-correlation"),
    )

    assert isinstance(accepted, MessageAccepted)
    assert "sanitized-card-activity" not in repr(accepted.reference)
    create_conversation.assert_called_once()
    send_to_conversation.assert_called_once()
    _, activity = send_to_conversation.call_args.args
    assert activity.type == "message"
    assert activity.summary == "Approval"
    assert len(activity.attachments) == 1
    attachment = activity.attachments[0]
    assert attachment.content_type == "application/vnd.microsoft.card.adaptive"
    content = attachment.content
    assert content["$schema"] == "http://adaptivecards.io/schemas/adaptive-card.json"
    assert content["version"] == "1.5"
    assert [element["type"] for element in content["body"]] == [
        "TextBlock",
        "TextBlock",
        "Input.ChoiceSet",
        "TextBlock",
    ]
    choice_input = content["body"][2]
    assert choice_input["id"] == "comment"
    assert choice_input["value"] == "One"
    assert [choice["value"] for choice in choice_input["choices"]] == ["One", "Two"]
    assert content["actions"] == [
        {
            "type": "Action.Submit",
            "title": "Approve",
            "data": {
                "__dify.human_input": {
                    "version": 1,
                    "action_id": "approve",
                    "correlation_token": "sanitized-correlation",
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
                    "correlation_token": "sanitized-correlation",
                }
            },
        },
    ]


def test_card_reference_updates_the_exact_activity_after_adapter_recreation(mocker) -> None:
    adapter, _, _, bot_credentials = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    connector = ms_teams.ConnectorClient(bot_credentials, base_url="https://smba.trafficmanager.net/teams/")
    mocker.patch.object(ms_teams, "ConnectorClient", autospec=True, return_value=connector)
    create_conversation = mocker.patch.object(connector.conversations, "create_conversation", autospec=True)
    send_to_conversation = mocker.patch.object(connector.conversations, "send_to_conversation", autospec=True)
    create_conversation.return_value = ConversationResourceResponse(
        id="sanitized-conversation",
        service_url="https://smba.trafficmanager.net/teams/",
    )
    send_to_conversation.return_value = ResourceResponse(id="sanitized-card-activity")
    accepted = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("sanitized-user-a"),
        _card_intent(),
        CorrelationToken("sanitized-correlation"),
    )
    assert isinstance(accepted, MessageAccepted)
    persisted_reference = pickle.loads(  # noqa: S301 - trusted in-process test value
        pickle.dumps(accepted.reference)
    )
    update_activity = mocker.patch.object(connector.conversations, "update_activity", autospec=True)
    recreated_adapter = ms_teams.MSTeamsIMProviderAdapter(_credentials())

    result = recreated_adapter.dynamic_card_messaging.replace_with_static(
        persisted_reference,
        StaticCardIntent("Decision **recorded**"),
    )

    assert result is None
    update_activity.assert_called_once()
    conversation_id, activity_id, activity = update_activity.call_args.args
    assert conversation_id == "sanitized-conversation"
    assert activity_id == "sanitized-card-activity"
    assert activity.type == "message"
    assert activity.text == "Decision **recorded**"
    assert not activity.attachments
    assert connector.config.retry_policy.retries == 0


def test_message_reference_does_not_expose_provider_locator_fields() -> None:
    reference: MessageReference = ms_teams._MSTeamsMessageLocator(
        message_kind="dynamic_card",
        tenant_id=_credentials().tenant_id,
        client_id=_credentials().client_id,
        service_url="https://smba.trafficmanager.net/teams/",
        conversation_id="sanitized-conversation",
        activity_id="sanitized-card-activity",
    )

    exposed_locator_fields = {
        name
        for name in ("tenant_id", "client_id", "service_url", "conversation_id", "activity_id")
        if hasattr(reference, name)
    }

    assert exposed_locator_fields == set()


def test_message_reference_rejects_an_altered_opaque_value_without_provider_io(mocker) -> None:
    reference = ms_teams._MSTeamsMessageLocator(
        message_kind="dynamic_card",
        tenant_id=_credentials().tenant_id,
        client_id=_credentials().client_id,
        service_url="https://smba.trafficmanager.net/teams/",
        conversation_id="sanitized-conversation",
        activity_id="sanitized-card-activity",
    )
    assert [field.name for field in fields(reference)] == ["_serialized_value"]
    serialized_value = reference._serialized_value
    replacement_character = "A" if serialized_value[-1] != "A" else "B"
    altered_reference = object.__new__(ms_teams._MSTeamsMessageLocator)
    object.__setattr__(altered_reference, "_serialized_value", serialized_value[:-1] + replacement_character)
    adapter, _, _, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    connector_client = mocker.patch.object(ms_teams, "ConnectorClient", autospec=True)

    result = adapter.dynamic_card_messaging.replace_with_static(
        altered_reference,
        StaticCardIntent("Recorded"),
    )

    assert result == ReplacementError(
        ReplacementErrorKind.INVALID_REFERENCE,
        "The Microsoft Teams message reference is invalid.",
    )
    connector_client.assert_not_called()


@pytest.mark.parametrize("reference", [MessageReference(), _ForeignMessageReference()])
def test_card_update_rejects_incompatible_reference_without_provider_io(
    mocker,
    reference: MessageReference,
) -> None:
    adapter, _, _, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    connector_client = mocker.patch.object(ms_teams, "ConnectorClient", autospec=True)

    result = adapter.dynamic_card_messaging.replace_with_static(reference, StaticCardIntent("Recorded"))

    assert result == ReplacementError(
        ReplacementErrorKind.INVALID_REFERENCE,
        "The Microsoft Teams message reference is invalid.",
    )
    connector_client.assert_not_called()


@pytest.mark.parametrize(
    ("provider_error", "expected_kind"),
    [
        ("stale", ReplacementErrorKind.STALE_REFERENCE),
        ("http_unknown", ReplacementErrorKind.UNKNOWN),
        ("unknown", ReplacementErrorKind.UNKNOWN),
    ],
)
def test_card_update_classifies_provider_failure_without_replaying_or_leaking_details(
    mocker,
    caplog,
    provider_error: str,
    expected_kind: ReplacementErrorKind,
) -> None:
    adapter, _, _, bot_credentials = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    connector = ms_teams.ConnectorClient(bot_credentials, base_url="https://smba.trafficmanager.net/teams/")
    mocker.patch.object(ms_teams, "ConnectorClient", autospec=True, return_value=connector)
    update_activity = mocker.patch.object(connector.conversations, "update_activity", autospec=True)
    if provider_error == "stale":
        response = requests.Response()
        response.status_code = 404
        response.reason = "sanitized-not-found"
        response._content = b"{}"
        update_activity.side_effect = HttpOperationError(None, response)
    elif provider_error == "http_unknown":
        response = requests.Response()
        response.status_code = 400
        response.reason = "sanitized-bad-request"
        response._content = b"{}"
        update_activity.side_effect = HttpOperationError(None, response)
    else:
        update_activity.side_effect = RuntimeError("sensitive provider response")
    reference = ms_teams._MSTeamsMessageLocator(
        message_kind="dynamic_card",
        tenant_id=_credentials().tenant_id,
        client_id=_credentials().client_id,
        service_url="https://smba.trafficmanager.net/teams/",
        conversation_id="sanitized-conversation",
        activity_id="sanitized-card-activity",
    )

    result = adapter.dynamic_card_messaging.replace_with_static(reference, StaticCardIntent("Recorded"))

    assert isinstance(result, ReplacementError)
    assert result.kind is expected_kind
    assert "sensitive provider response" not in result.reason
    assert "sensitive provider response" not in caplog.text
    update_activity.assert_called_once()


@pytest.mark.parametrize("include_event_id", [True, False])
def test_webhook_authenticates_tenant_and_preserves_the_complete_activity_payload(
    mocker,
    include_event_id: bool,
) -> None:
    adapter, _, _, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    authenticate_request = mocker.patch.object(
        ms_teams.JwtTokenValidation,
        "authenticate_request",
        autospec=True,
    )
    authenticate_request.return_value = ClaimsIdentity(
        {"aud": _credentials().client_id, "iss": "https://api.botframework.com"},
        True,
    )
    consumer = _RecordingConsumer()
    handler = adapter.create_webhook_handler(consumer)
    activity_body = _teams_activity_body(include_event_id=include_event_id)

    response = handler.handle(_webhook_request(activity_body))

    assert response.status_code == 200
    assert response.body == b""
    assert len(consumer.events) == 1
    event = consumer.events[0]
    assert event.provider.value == "ms_teams"
    assert event.provider_tenant_id == _credentials().tenant_id
    assert event.event_id == ("sanitized-provider-event" if include_event_id else None)
    assert event.event_type == "invoke"
    assert event.occurred_at == datetime(2026, 8, 6, 7, 59, 58)
    assert event.received_at == _RECEIVED_AT
    assert json.loads(event.payload) == activity_body
    authenticate_request.assert_awaited_once()
    authenticated_activity, authorization, _, _ = authenticate_request.call_args.args
    assert authenticated_activity.channel_id == "msteams"
    assert authenticated_activity.service_url == "https://smba.trafficmanager.net/teams/"
    assert authorization == "Bearer sanitized-token"


@pytest.mark.parametrize(
    ("acceptance", "expected_status"),
    [
        (EventAcceptance.ACCEPTED, 200),
        (EventAcceptance.NOT_ACCEPTED, 503),
    ],
)
def test_webhook_maps_consumer_acceptance_to_bot_framework_ack(
    mocker,
    acceptance: EventAcceptance,
    expected_status: int,
) -> None:
    consumer = _RecordingConsumer(acceptance)
    _, handler, authenticate_request = _authenticated_webhook_handler(mocker, consumer)

    response = handler.handle(_webhook_request(_teams_activity_body()))

    assert response.status_code == expected_status
    assert len(consumer.events) == 1
    authenticate_request.assert_awaited_once()


def test_webhook_rejects_authentication_and_tenant_mismatch_before_consumer(mocker) -> None:
    consumer = _RecordingConsumer()
    _, handler, authenticate_request = _authenticated_webhook_handler(mocker, consumer)
    authenticate_request.side_effect = PermissionError("sensitive token details")

    unauthenticated = handler.handle(_webhook_request(_teams_activity_body()))

    assert unauthenticated.status_code == 401
    assert consumer.events == []

    authenticate_request.side_effect = None
    authenticate_request.return_value = ClaimsIdentity(
        {"aud": _credentials().client_id, "iss": "https://api.botframework.com"},
        True,
    )
    mismatched_body = _teams_activity_body()
    mismatched_body["conversation"] = {
        "id": "sanitized-conversation",
        "tenantId": "33333333-3333-3333-3333-333333333333",
    }
    mismatched = handler.handle(_webhook_request(mismatched_body))

    assert mismatched.status_code == 403
    assert consumer.events == []
    assert authenticate_request.await_count == 2


@pytest.mark.parametrize(
    "webhook_request",
    [
        WebhookRequest(
            method="GET",
            headers=(("Authorization", "Bearer sanitized-token"), ("Content-Type", "application/json")),
            body=b"{}",
            received_at=_RECEIVED_AT,
        ),
        WebhookRequest(
            method="POST",
            headers=(("Content-Type", "application/json"),),
            body=b"{}",
            received_at=_RECEIVED_AT,
        ),
        WebhookRequest(
            method="POST",
            headers=(
                ("Authorization", "Bearer first"),
                ("authorization", "Bearer second"),
                ("Content-Type", "application/json"),
            ),
            body=b"{}",
            received_at=_RECEIVED_AT,
        ),
        WebhookRequest(
            method="POST",
            headers=(("Authorization", "Bearer sanitized-token"), ("Content-Type", "text/plain")),
            body=b"{}",
            received_at=_RECEIVED_AT,
        ),
        WebhookRequest(
            method="POST",
            headers=(("Authorization", "Bearer sanitized-token"), ("Content-Type", "application/json")),
            body=b"not-json",
            received_at=_RECEIVED_AT,
        ),
        WebhookRequest(
            method="POST",
            headers=(("Authorization", "Bearer sanitized-token"), ("Content-Type", "application/json")),
            body=b"[]",
            received_at=_RECEIVED_AT,
        ),
        WebhookRequest(
            method="POST",
            headers=(
                ("Authorization", "Bearer sanitized-token"),
                ("Content-Type", "application/json"),
                ("content-type", "application/json"),
            ),
            body=b"{}",
            received_at=_RECEIVED_AT,
        ),
    ],
    ids=("method", "missing-auth", "duplicate-auth", "content-type", "body", "non-object", "duplicate-content-type"),
)
def test_webhook_rejects_invalid_http_boundary_without_authentication_or_consumption(
    mocker,
    webhook_request: WebhookRequest,
) -> None:
    consumer = _RecordingConsumer()
    _, handler, authenticate_request = _authenticated_webhook_handler(mocker, consumer)

    response = handler.handle(webhook_request)

    assert response.status_code >= 400
    assert consumer.events == []
    authenticate_request.assert_not_awaited()


def test_webhook_rejects_invalid_activity_shape_and_service_url_before_authentication(mocker) -> None:
    consumer = _RecordingConsumer()
    _, handler, authenticate_request = _authenticated_webhook_handler(mocker, consumer)

    invalid_shape = handler.handle(_webhook_request({"type": "invoke"}))
    untrusted_activity = _teams_activity_body()
    untrusted_activity["serviceUrl"] = "https://example.invalid/teams/"
    untrusted_service_url = handler.handle(_webhook_request(untrusted_activity))

    assert invalid_shape.status_code == 400
    assert untrusted_service_url.status_code == 400
    assert consumer.events == []
    authenticate_request.assert_not_awaited()


@pytest.mark.parametrize("non_standard_value", [float("nan"), float("inf"), float("-inf")])
def test_webhook_rejects_non_standard_json_constants_before_authentication(mocker, non_standard_value: float) -> None:
    consumer = _RecordingConsumer()
    _, handler, authenticate_request = _authenticated_webhook_handler(mocker, consumer)
    activity = _teams_activity_body()
    activity["nonStandard"] = non_standard_value

    response = handler.handle(_webhook_request(activity))

    assert response.status_code == 400
    assert consumer.events == []
    authenticate_request.assert_not_awaited()


def test_webhook_accepts_authoritative_tenant_with_blank_event_id_and_no_provider_time(mocker) -> None:
    consumer = _RecordingConsumer()
    _, handler, _ = _authenticated_webhook_handler(mocker, consumer)
    activity = _teams_activity_body()
    activity["id"] = " "
    activity.pop("timestamp")
    conversation = activity["conversation"]
    assert isinstance(conversation, dict)
    conversation.pop("tenantId")

    response = handler.handle(_webhook_request(activity))

    assert response.status_code == 200
    assert len(consumer.events) == 1
    assert consumer.events[0].event_id is None
    assert consumer.events[0].occurred_at is None


def test_webhook_rejects_an_identity_not_marked_authenticated(mocker) -> None:
    consumer = _RecordingConsumer()
    _, handler, authenticate_request = _authenticated_webhook_handler(mocker, consumer)
    authenticate_request.return_value = ClaimsIdentity({}, False)

    response = handler.handle(_webhook_request(_teams_activity_body()))

    assert response.status_code == 401
    assert consumer.events == []


def test_webhook_consumer_failure_is_safe_and_not_acknowledged(mocker, caplog) -> None:
    _, handler, _ = _authenticated_webhook_handler(mocker, _FailingConsumer())

    response = handler.handle(_webhook_request(_teams_activity_body()))

    assert response.status_code == 503
    assert "sensitive consumer details" not in response.body.decode()
    assert "sensitive consumer details" not in caplog.text


def test_webhook_handler_remains_usable_after_root_close(mocker) -> None:
    consumer = _RecordingConsumer()
    adapter, handler, _ = _authenticated_webhook_handler(mocker, consumer)
    adapter.close()
    adapter.close()

    response = handler.handle(_webhook_request(_teams_activity_body()))

    assert response.status_code == 200
    assert len(consumer.events) == 1


def test_webhook_handler_supports_overlapping_calls_without_shared_request_state(mocker) -> None:
    consumer = _ThreadSafeRecordingConsumer()
    adapter, _, _, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )

    async def authenticate_request(*args, **kwargs):
        del args, kwargs
        return ClaimsIdentity({"aud": _credentials().client_id}, True)

    mocker.patch.object(ms_teams.JwtTokenValidation, "authenticate_request", new=authenticate_request)
    handler = adapter.create_webhook_handler(consumer)
    requests_to_handle = [
        _webhook_request({**_teams_activity_body(), "id": f"sanitized-event-{index}"}) for index in range(8)
    ]

    with ThreadPoolExecutor(max_workers=8) as executor:
        responses = tuple(executor.map(handler.handle, requests_to_handle))

    assert [response.status_code for response in responses] == [200] * 8
    assert {event.event_id for event in consumer.events} == {f"sanitized-event-{index}" for index in range(8)}


def test_committed_ms_teams_fixture_contains_only_sanitized_protocol_evidence() -> None:
    fixture_text = _WEBHOOK_FIXTURE_PATH.read_text()
    normalized_fixture = fixture_text.casefold()

    assert _UUID_PATTERN.search(fixture_text) is None
    assert "authorization" not in normalized_fixture
    assert "bearer " not in normalized_fixture
    assert "client_secret" not in normalized_fixture
    assert "access_token" not in normalized_fixture
    assert "refresh_token" not in normalized_fixture
    assert "private_key" not in normalized_fixture
    assert "password" not in normalized_fixture

    fixture = json.loads(fixture_text)
    assert isinstance(fixture, dict)
    assert fixture["id"] == "test-only-event"
    assert fixture["conversation"] == {
        "id": "test-only-conversation",
        "tenantId": "test-only-tenant",
    }
    assert fixture["channelData"]["tenant"] == {"id": "test-only-tenant"}
    assert fixture["value"]["correlation_token"] == "test-only-correlation"


def test_webhook_official_jwt_validation_rejects_tampering_wrong_audience_and_expiry(mocker) -> None:
    signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    wrong_signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = RSAAlgorithm.to_jwk(signing_key.public_key(), as_dict=True)
    public_jwk.update({"kid": "test-only-key", "endorsements": []})
    metadata_url = "https://test-only.invalid/openid-configuration"
    jwks_url = "https://test-only.invalid/keys"
    mocker.patch.object(ChannelValidation, "open_id_metadata_endpoint", metadata_url)
    JwtTokenExtractor.metadataCache.pop(metadata_url, None)
    metadata_get = mocker.patch(
        "botframework.connector.auth.jwt_token_extractor.requests.get",
        side_effect=[
            _ProviderMetadataResponse({"jwks_uri": jwks_url}),
            _ProviderMetadataResponse({"keys": [public_jwk]}),
        ],
    )
    adapter, _, _, _ = _adapter_with_tokens(
        mocker,
        graph_claims={
            "aud": "https://graph.microsoft.com",
            "tid": _credentials().tenant_id,
            "roles": ["User.Read.All"],
        },
        bot_claims={
            "aud": "https://api.botframework.com",
            "appid": _credentials().client_id,
            "tid": _credentials().tenant_id,
        },
    )
    consumer = _RecordingConsumer()
    handler = adapter.create_webhook_handler(consumer)
    current_timestamp = int(datetime.now().timestamp())
    base_claims = {
        "iss": "https://api.botframework.com",
        "aud": _credentials().client_id,
        "serviceurl": "https://smba.trafficmanager.net/teams/",
        "nbf": current_timestamp - 60,
        "exp": current_timestamp + 600,
    }

    valid_token = jwt.encode(base_claims, signing_key, algorithm="RS256", headers={"kid": "test-only-key"})
    valid_response = handler.handle(_webhook_request(_teams_activity_body(), authorization=f"Bearer {valid_token}"))

    assert valid_response.status_code == 200
    assert len(consumer.events) == 1
    invalid_tokens = (
        jwt.encode(base_claims, wrong_signing_key, algorithm="RS256", headers={"kid": "test-only-key"}),
        jwt.encode(
            {**base_claims, "aud": "test-only-wrong-audience"},
            signing_key,
            algorithm="RS256",
            headers={"kid": "test-only-key"},
        ),
        jwt.encode(
            {**base_claims, "exp": current_timestamp - 600},
            signing_key,
            algorithm="RS256",
            headers={"kid": "test-only-key"},
        ),
    )
    for invalid_token in invalid_tokens:
        invalid_response = handler.handle(
            _webhook_request(_teams_activity_body(), authorization=f"Bearer {invalid_token}")
        )
        assert invalid_response.status_code == 401
    assert len(consumer.events) == 1
    assert metadata_get.call_count == 2
    JwtTokenExtractor.metadataCache.pop(metadata_url, None)
