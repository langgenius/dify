from __future__ import annotations

import base64
import json
from collections.abc import Mapping
from typing import Literal, overload

import pytest

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
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import feishu_lark as adapter_module
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMIntegrationCredentials,
    FeishuIMProviderAdapter,
    LarkIMIntegrationCredentials,
    LarkIMProviderAdapter,
)
from core.human_input_v2.im_provider import (
    CorrelationToken,
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    Directory,
    DirectoryEntry,
    DirectoryReadFailure,
    DynamicCardMessagingError,
    MessageAccepted,
    MessageLocator,
    MessageSendingError,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    StaticCardIntent,
)


class FakeSDKGateway:
    def __init__(self) -> None:
        self.tenant_responses: list[Mapping[str, object] | Exception] = []
        self.scope_responses: list[Mapping[str, object] | Exception] = []
        self.department_responses: list[Mapping[str, object] | Exception] = []
        self.user_responses: list[Mapping[str, object] | Exception] = []
        self.create_responses: list[Mapping[str, object] | Exception] = []
        self.patch_responses: list[Mapping[str, object] | Exception] = []
        self.calls: list[tuple[str, object]] = []

    @staticmethod
    def _next(responses: list[Mapping[str, object] | Exception]) -> Mapping[str, object]:
        response = responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    @staticmethod
    def _department_value(department: object) -> object:
        return getattr(department, "value", department)

    def query_tenant(self) -> Mapping[str, object]:
        self.calls.append(("query_tenant", None))
        return self._next(self.tenant_responses)

    def list_scope(self, page_token: str | None) -> Mapping[str, object]:
        self.calls.append(("list_scope", page_token))
        return self._next(self.scope_responses)

    def list_departments(self, department_id: object, page_token: str | None) -> Mapping[str, object]:
        self.calls.append(("list_departments", (self._department_value(department_id), page_token)))
        return self._next(self.department_responses)

    def list_users(self, department_id: object, page_token: str | None) -> Mapping[str, object]:
        self.calls.append(("list_users", (self._department_value(department_id), page_token)))
        return self._next(self.user_responses)

    def create_message(self, receive_id: str, msg_type: str, content: str) -> Mapping[str, object]:
        self.calls.append(("create_message", (receive_id, msg_type, content)))
        return self._next(self.create_responses)

    def patch_message(self, message_id: str, content: str) -> Mapping[str, object]:
        self.calls.append(("patch_message", (message_id, content)))
        return self._next(self.patch_responses)


class IdentityAwareFakeSDKGateway(FakeSDKGateway):
    """Capture the private department identity sent across the SDK boundary."""

    @staticmethod
    def _identity_parts(department: object) -> tuple[object, object]:
        return (getattr(department, "value", department), getattr(department, "id_type", None))

    def list_departments(self, department_id: object, page_token: str | None) -> Mapping[str, object]:
        self.calls.append(("list_departments", (*self._identity_parts(department_id), page_token)))
        return self._next(self.department_responses)

    def list_users(self, department_id: object, page_token: str | None) -> Mapping[str, object]:
        self.calls.append(("list_users", (*self._identity_parts(department_id), page_token)))
        return self._next(self.user_responses)


@overload
def _credentials(provider: Literal[IMProvider.FEISHU]) -> FeishuIMIntegrationCredentials: ...


@overload
def _credentials(provider: Literal[IMProvider.LARK]) -> LarkIMIntegrationCredentials: ...


def _credentials(
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
) -> FeishuIMIntegrationCredentials | LarkIMIntegrationCredentials:
    values = {
        "provider": provider,
        "app_id": "cli_sanitized_app",
        "app_secret": "sanitized-app-secret",
        "verification_token": "sanitized-verification-token",
        "encrypt_key": "sanitized-encrypt-key",
    }
    if provider is IMProvider.FEISHU:
        return FeishuIMIntegrationCredentials.model_validate(values)
    return LarkIMIntegrationCredentials.model_validate(values)


def _adapter(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
    gateway: FakeSDKGateway,
) -> FeishuIMProviderAdapter | LarkIMProviderAdapter:
    monkeypatch.setattr(adapter_module, "_create_sdk_gateway", lambda _credentials, _domain: gateway)
    if provider is IMProvider.FEISHU:
        return FeishuIMProviderAdapter(_credentials(provider))
    return LarkIMProviderAdapter(_credentials(provider))


def _tenant_response(tenant_key: str = "tenant_sanitized") -> Mapping[str, object]:
    return {"code": 0, "data": {"tenant": {"tenant_key": tenant_key}}}


def _accepted_card_reference(
    monkeypatch: pytest.MonkeyPatch,
    *,
    message_id: str = "om_sanitized_card",
) -> MessageLocator:
    source_gateway = FakeSDKGateway()
    source_gateway.tenant_responses.append(_tenant_response())
    source_gateway.create_responses.append({"code": 0, "data": {"message_id": message_id}})
    source = _adapter(monkeypatch, IMProvider.FEISHU, source_gateway)
    accepted = source.dynamic_card_messaging.send_card(
        ProviderUserId("union_sanitized_user"),
        _intent(),
        CorrelationToken("opaque-correlation-token"),
    )
    assert isinstance(accepted, MessageAccepted)
    return accepted.locator


def _assert_invalid_reference_without_mutation(
    monkeypatch: pytest.MonkeyPatch,
    opaque: str,
) -> None:
    invalid = MessageLocator(opaque)
    replacement_gateway = FakeSDKGateway()
    replacement = _adapter(monkeypatch, IMProvider.FEISHU, replacement_gateway)

    result = replacement.dynamic_card_messaging.replace_with_static(invalid, StaticCardIntent("Submitted"))

    assert isinstance(result, ReplacementError)
    assert result.kind is ReplacementErrorKind.INVALID_REFERENCE
    assert replacement_gateway.calls == []


def _page(
    items: list[Mapping[str, object]],
    *,
    next_page_token: str | None = None,
) -> Mapping[str, object]:
    return {
        "code": 0,
        "data": {
            "items": items,
            "has_more": next_page_token is not None,
            "page_token": next_page_token,
        },
    }


def _scope_page(
    *,
    department_ids: list[str] | None = None,
    user_ids: list[str] | None = None,
    next_page_token: str | None = None,
) -> Mapping[str, object]:
    return {
        "code": 0,
        "data": {
            "department_ids": department_ids or [],
            "user_ids": user_ids or [],
            "has_more": next_page_token is not None,
            "page_token": next_page_token,
        },
    }


def _intent(input_type: str = "paragraph") -> ResolvedForm:
    if input_type == "select":
        input_block: ResolvedFormContent = SelectInput("comment", ("Approve", "Reject"), "Approve")
    elif input_type == "file":
        input_block = FileInput("comment", (), (), ())
    elif input_type == "file-list":
        input_block = FileListInput("comment", (), (), (), 1)
    else:
        input_block = ParagraphInput("comment", "Initial")
    return ResolvedForm(
        title="Approval",
        blocks=(MarkdownText("Rendered **content**"), input_block),
        user_actions=(
            ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),
            ResolvedFormAction("reject", "Reject", ButtonStyle.DEFAULT),
        ),
        legacy_form_content="This value must not be rendered",
    )


def _provider_confirmed_form_intent() -> ResolvedForm:
    return ResolvedForm(
        title="Synthetic decision",
        blocks=(
            MarkdownText("Synthetic **approval** content"),
            ParagraphInput("explanation", "Synthetic default"),
            SelectInput("decision", ("allow", "deny"), "allow"),
        ),
        user_actions=(
            ResolvedFormAction("continue", "Continue", ButtonStyle.PRIMARY),
            ResolvedFormAction("stop", "Stop", ButtonStyle.ACCENT),
        ),
        legacy_form_content="This value must not be rendered",
    )


@pytest.mark.parametrize(
    ("provider", "expected_domain"),
    [
        (IMProvider.FEISHU, "https://open.feishu.cn"),
        (IMProvider.LARK, "https://open.larksuite.com"),
    ],
)
def test_wrappers_use_typed_provider_and_expected_sdk_domain(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
    expected_domain: str,
) -> None:
    observed: list[tuple[object, str]] = []
    gateway = FakeSDKGateway()
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_gateway",
        lambda credentials, domain: observed.append((credentials, domain)) or gateway,
    )

    adapter = (
        FeishuIMProviderAdapter(_credentials(IMProvider.FEISHU))
        if provider is IMProvider.FEISHU
        else LarkIMProviderAdapter(_credentials(IMProvider.LARK))
    )

    assert adapter.provider is provider
    assert observed == [(_credentials(provider), expected_domain)]


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_credentials_validate_complete_scope_then_prove_root_department_access(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
) -> None:
    gateway = FakeSDKGateway()
    gateway.tenant_responses.append(_tenant_response())
    gateway.scope_responses.extend(
        [
            _scope_page(
                department_ids=["dept_first_level"],
                user_ids=["union_root_user"],
                next_page_token="scope-next",
            ),
            _scope_page(department_ids=["dept_second_page"]),
        ]
    )
    gateway.department_responses.append(_page([{"department_id": "dept_first_level"}]))
    adapter = _adapter(monkeypatch, provider, gateway)

    assert adapter.test_credentials() == CredentialTestSuccess(provider, "tenant_sanitized")
    assert gateway.calls == [
        ("query_tenant", None),
        ("list_scope", None),
        ("list_scope", "scope-next"),
        ("list_departments", ("0", None)),
    ]


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_credentials_accept_open_department_id_only_root_children(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
) -> None:
    gateway = FakeSDKGateway()
    gateway.tenant_responses.append(_tenant_response())
    gateway.scope_responses.append(_scope_page())
    gateway.department_responses.append(_page([{"open_department_id": "open_dept_sanitized"}]))
    adapter = _adapter(monkeypatch, provider, gateway)

    assert adapter.test_credentials() == CredentialTestSuccess(provider, "tenant_sanitized")


@pytest.mark.parametrize(
    ("tenant_response", "scope_response", "expected_kind"),
    [
        ({"code": 99991663, "msg": "sanitized rejection"}, None, CredentialTestFailureKind.AUTHENTICATION_REJECTED),
        ({"code": 0, "data": {"tenant": {}}}, None, CredentialTestFailureKind.TENANT_ID_UNAVAILABLE),
        (_tenant_response(), {"code": 403, "msg": "sanitized permission rejection"}, CredentialTestFailureKind.UNKNOWN),
    ],
)
def test_credential_failure_is_classified_and_safe(
    monkeypatch: pytest.MonkeyPatch,
    tenant_response: Mapping[str, object],
    scope_response: Mapping[str, object] | None,
    expected_kind: CredentialTestFailureKind,
) -> None:
    gateway = FakeSDKGateway()
    gateway.tenant_responses.append(tenant_response)
    if scope_response is not None:
        gateway.scope_responses.append(scope_response)
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, gateway)

    result = adapter.test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is expected_kind
    assert "sanitized rejection" not in result.reason
    assert "sanitized-app-secret" not in result.reason


@pytest.mark.parametrize(
    "scope_responses",
    [
        [
            {
                "code": 0,
                "data": {
                    "department_ids": [],
                    "user_ids": [],
                    "has_more": True,
                },
            }
        ],
        [
            _scope_page(next_page_token="scope-repeat"),
            _scope_page(next_page_token="scope-repeat"),
        ],
        [
            _scope_page(next_page_token="scope-next"),
            {"code": 403, "msg": "sanitized rejection"},
        ],
        [
            _scope_page(next_page_token="scope-next"),
            RuntimeError("sanitized transport failure"),
        ],
        [
            {
                "code": 0,
                "data": {
                    "department_ids": [],
                    "user_ids": [],
                    "has_more": "true",
                    "page_token": "scope-next",
                },
            }
        ],
        [
            {
                "code": 0,
                "data": {
                    "department_ids": [],
                    "user_ids": [],
                    "has_more": True,
                    "page_token": 1,
                },
            }
        ],
    ],
    ids=("missing-token", "token-loop", "rejected-page", "transport-failure", "invalid-has-more", "invalid-token"),
)
def test_credentials_reject_incomplete_or_malformed_scope_pagination(
    monkeypatch: pytest.MonkeyPatch,
    scope_responses: list[Mapping[str, object] | Exception],
) -> None:
    gateway = FakeSDKGateway()
    gateway.tenant_responses.append(_tenant_response())
    gateway.scope_responses.extend(scope_responses)
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, gateway)

    result = adapter.test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is CredentialTestFailureKind.UNKNOWN
    assert not any(call[0] == "list_departments" for call in gateway.calls)
    assert "sanitized" not in result.reason.casefold()


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
@pytest.mark.parametrize("invalid_code", [False, "0"], ids=("boolean", "string"))
def test_credentials_reject_non_integer_scope_success_code(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
    invalid_code: object,
) -> None:
    gateway = FakeSDKGateway()
    gateway.tenant_responses.append(_tenant_response())
    gateway.scope_responses.append(
        {
            "code": invalid_code,
            "data": {"department_ids": [], "user_ids": [], "has_more": False},
        }
    )
    adapter = _adapter(monkeypatch, provider, gateway)

    result = adapter.test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is CredentialTestFailureKind.UNKNOWN
    assert not any(call[0] == "list_departments" for call in gateway.calls)


@pytest.mark.parametrize(
    "root_response",
    [
        RuntimeError("sanitized transport failure"),
        {"code": 403, "msg": "sanitized permission rejection"},
        {"code": 0, "data": None},
        {"code": 0, "data": {"items": [], "has_more": "false"}},
        {"code": 0, "data": {"items": [{}], "has_more": False}},
    ],
    ids=("transport-failure", "permission-rejection", "missing-data", "invalid-shape", "invalid-department"),
)
def test_credentials_require_authoritative_root_department_proof(
    monkeypatch: pytest.MonkeyPatch,
    root_response: Mapping[str, object] | Exception,
) -> None:
    gateway = FakeSDKGateway()
    gateway.tenant_responses.append(_tenant_response())
    gateway.scope_responses.append(
        _scope_page(
            department_ids=["dept_first_level"],
            user_ids=["union_root_user"],
        )
    )
    gateway.department_responses.append(root_response)
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, gateway)

    result = adapter.test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is CredentialTestFailureKind.UNKNOWN
    assert gateway.calls[-1] == ("list_departments", ("0", None))
    assert "sanitized" not in result.reason.casefold()


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_directory_publishes_complete_ordered_union_id_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
) -> None:
    gateway = FakeSDKGateway()
    gateway.user_responses.extend(
        [
            _page(
                [{"union_id": "union_root", "name": "Root User", "email": "root@example.invalid"}],
                next_page_token="users-next",
            ),
            _page([{"union_id": "union_optional", "name": " ", "email": "optional@example.invalid"}]),
            _page([{"union_id": "union_child", "name": "Child User", "enterprise_email": "child@example.invalid"}]),
        ]
    )
    gateway.department_responses.extend(
        [
            _page([{"department_id": "dept_child"}], next_page_token="departments-next"),
            _page([]),
            _page([]),
        ]
    )
    adapter = _adapter(monkeypatch, provider, gateway)

    result = adapter.directory.read_directory()

    assert isinstance(result, Directory)
    assert [(str(entry.provider_user_id), entry.display_name, entry.email) for entry in result.entries] == [
        ("union_root", "Root User", "root@example.invalid"),
        ("union_optional", None, "optional@example.invalid"),
        ("union_child", "Child User", "child@example.invalid"),
    ]
    assert gateway.calls == [
        ("list_users", ("0", None)),
        ("list_users", ("0", "users-next")),
        ("list_departments", ("0", None)),
        ("list_departments", ("0", "departments-next")),
        ("list_users", ("dept_child", None)),
        ("list_departments", ("dept_child", None)),
    ]


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_directory_keeps_open_department_identity_and_accepts_omitted_empty_page_items(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
) -> None:
    gateway = IdentityAwareFakeSDKGateway()
    gateway.user_responses.extend(
        [
            _page([{"union_id": "union_root", "name": "Root User"}]),
            _page([{"union_id": "union_target_like", "name": "Target Like", "email": "target@example.invalid"}]),
            {"code": 0, "data": {"has_more": False}},
        ]
    )
    gateway.department_responses.extend(
        [
            _page([{"open_department_id": "open_dept_child"}]),
            {"code": 0, "data": {"has_more": False}},
        ]
    )
    adapter = _adapter(monkeypatch, provider, gateway)

    result = adapter.directory.read_directory()

    assert result == Directory(
        (
            DirectoryEntry(ProviderUserId("union_root"), "Root User", None),
            DirectoryEntry(ProviderUserId("union_target_like"), "Target Like", "target@example.invalid"),
        )
    )
    assert gateway.calls == [
        ("list_users", ("0", "department_id", None)),
        ("list_departments", ("0", "department_id", None)),
        ("list_users", ("open_dept_child", "open_department_id", None)),
        ("list_departments", ("open_dept_child", "open_department_id", None)),
    ]
    assert not any(call[0] == "list_scope" for call in gateway.calls)


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
@pytest.mark.parametrize("omitted_boundary", ["users", "departments"])
def test_directory_accepts_independently_omitted_items_on_empty_terminal_pages(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
    omitted_boundary: str,
) -> None:
    gateway = FakeSDKGateway()
    omitted_items_page = {"code": 0, "data": {"has_more": False}}
    gateway.user_responses.append(omitted_items_page if omitted_boundary == "users" else _page([]))
    gateway.department_responses.append(omitted_items_page if omitted_boundary == "departments" else _page([]))
    adapter = _adapter(monkeypatch, provider, gateway)

    result = adapter.directory.read_directory()

    assert result == Directory(())
    assert gateway.calls == [
        ("list_users", ("0", None)),
        ("list_departments", ("0", None)),
    ]


def test_directory_discards_partial_entries_after_later_page_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    gateway = FakeSDKGateway()
    gateway.user_responses.extend(
        [_page([{"union_id": "union_root", "name": "Root User"}], next_page_token="next"), RuntimeError("raw")]
    )
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, gateway)

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert "union_root" not in result.reason
    assert "raw" not in result.reason


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_empty_directory_is_a_complete_successful_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
) -> None:
    gateway = FakeSDKGateway()
    gateway.user_responses.append(_page([]))
    gateway.department_responses.append(_page([]))
    adapter = _adapter(monkeypatch, provider, gateway)

    result = adapter.directory.read_directory()

    assert result == Directory(())


def test_directory_ignores_scope_entries_and_publishes_only_root_bfs_users(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = FakeSDKGateway()
    gateway.scope_responses.append(
        _scope_page(
            department_ids=["dept_selected"],
            user_ids=["union_directly_selected"],
        )
    )
    gateway.user_responses.append(
        _page([{"union_id": "union_root", "name": "Root User", "email": "root@example.invalid"}])
    )
    gateway.department_responses.append(_page([]))
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, gateway)

    result = adapter.directory.read_directory()

    assert result == Directory((DirectoryEntry(ProviderUserId("union_root"), "Root User", "root@example.invalid"),))
    assert gateway.calls == [
        ("list_users", ("0", None)),
        ("list_departments", ("0", None)),
    ]


def test_directory_preserves_listing_profile_facts_and_missing_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = FakeSDKGateway()
    gateway.user_responses.append(
        _page(
            [
                {
                    "union_id": "union_enterprise",
                    "name": "Enterprise User",
                    "enterprise_email": "enterprise@example.invalid",
                    "email": "fallback@example.invalid",
                },
                {
                    "union_id": "union_fallback",
                    "name": " ",
                    "enterprise_email": " ",
                    "email": "fallback@example.invalid",
                },
                {"union_id": "union_withheld"},
            ]
        )
    )
    gateway.department_responses.append(_page([]))
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, gateway)

    result = adapter.directory.read_directory()

    assert result == Directory(
        (
            DirectoryEntry(
                ProviderUserId("union_enterprise"),
                "Enterprise User",
                "enterprise@example.invalid",
            ),
            DirectoryEntry(ProviderUserId("union_fallback"), None, "fallback@example.invalid"),
            DirectoryEntry(ProviderUserId("union_withheld"), None, None),
        )
    )


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_directory_bfs_deduplicates_users_departments_and_topology_cycles(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
) -> None:
    gateway = IdentityAwareFakeSDKGateway()
    gateway.user_responses.extend(
        [
            _page(
                [
                    {
                        "union_id": "union_overlap",
                        "name": "First Observation",
                        "enterprise_email": "first@example.invalid",
                    },
                ],
                next_page_token="root-users-next",
            ),
            _page(
                [
                    {"union_id": "union_root", "name": "Root User"},
                    {"union_id": "union_withheld"},
                ],
            ),
            _page(
                [
                    {
                        "union_id": "union_overlap",
                        "name": "Later Observation",
                        "email": "later@example.invalid",
                    },
                    {"union_id": "union_child", "name": "Child User", "email": "child@example.invalid"},
                ]
            ),
        ]
    )
    gateway.department_responses.extend(
        [
            _page([{"open_department_id": "open_dept_child"}], next_page_token="root-departments-next"),
            _page([{"open_department_id": "open_dept_child"}]),
            _page([{"department_id": "0"}]),
        ]
    )
    adapter = _adapter(monkeypatch, provider, gateway)

    result = adapter.directory.read_directory()

    assert result == Directory(
        (
            DirectoryEntry(ProviderUserId("union_overlap"), "First Observation", "first@example.invalid"),
            DirectoryEntry(ProviderUserId("union_root"), "Root User", None),
            DirectoryEntry(ProviderUserId("union_withheld"), None, None),
            DirectoryEntry(ProviderUserId("union_child"), "Child User", "child@example.invalid"),
        )
    )
    assert gateway.calls == [
        ("list_users", ("0", "department_id", None)),
        ("list_users", ("0", "department_id", "root-users-next")),
        ("list_departments", ("0", "department_id", None)),
        ("list_departments", ("0", "department_id", "root-departments-next")),
        ("list_users", ("open_dept_child", "open_department_id", None)),
        ("list_departments", ("open_dept_child", "open_department_id", None)),
    ]
    assert not any(call[0] == "list_scope" for call in gateway.calls)


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
@pytest.mark.parametrize(
    "malformed_boundary",
    [
        "user-non-list-items",
        "user-missing-union-id",
        "department-non-list-items",
        "department-missing-open-id",
    ],
)
def test_directory_rejects_malformed_non_empty_pages_after_partial_accumulation(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
    malformed_boundary: str,
) -> None:
    gateway = FakeSDKGateway()
    if malformed_boundary.startswith("user-"):
        malformed_items: object = (
            {"union_id": "union_malformed"}
            if malformed_boundary == "user-non-list-items"
            else [{"name": "Missing Union ID"}]
        )
        gateway.user_responses.extend(
            [
                _page([{"union_id": "union_partial"}], next_page_token="users-next"),
                {"code": 0, "data": {"items": malformed_items, "has_more": False}},
            ]
        )
        expected_calls = [
            ("list_users", ("0", None)),
            ("list_users", ("0", "users-next")),
        ]
    else:
        malformed_items = (
            {"open_department_id": "open_dept_malformed"}
            if malformed_boundary == "department-non-list-items"
            else [{"open_department_id": ""}]
        )
        gateway.user_responses.append(_page([{"union_id": "union_partial"}]))
        gateway.department_responses.extend(
            [
                _page([{"open_department_id": "open_dept_pending"}], next_page_token="departments-next"),
                {"code": 0, "data": {"items": malformed_items, "has_more": False}},
            ]
        )
        expected_calls = [
            ("list_users", ("0", None)),
            ("list_departments", ("0", None)),
            ("list_departments", ("0", "departments-next")),
        ]
    adapter = _adapter(monkeypatch, provider, gateway)

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert "union_partial" not in result.reason
    assert "malformed" not in result.reason.casefold()
    assert "open_dept_pending" not in result.reason
    assert gateway.calls == expected_calls


@pytest.mark.parametrize(
    "failure_case",
    [
        "user-rejected",
        "user-transport",
        "user-missing-token",
        "user-token-loop",
        "user-invalid-has-more",
        "department-rejected",
        "department-transport",
        "department-missing-token",
        "department-token-loop",
        "department-invalid-identity",
        "department-invalid-has-more",
    ],
)
def test_directory_rejects_incomplete_or_malformed_department_pages_without_partial_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    failure_case: str,
) -> None:
    gateway = FakeSDKGateway()
    if failure_case == "user-rejected":
        gateway.user_responses.append({"code": 403})
    elif failure_case == "user-transport":
        gateway.user_responses.append(RuntimeError("sanitized transport failure"))
    elif failure_case == "user-missing-token":
        gateway.user_responses.append({"code": 0, "data": {"items": [{"union_id": "union_partial"}], "has_more": True}})
    elif failure_case == "user-token-loop":
        gateway.user_responses.extend(
            [
                _page([{"union_id": "union_partial"}], next_page_token="users-repeat"),
                _page([], next_page_token="users-repeat"),
            ]
        )
    elif failure_case == "user-invalid-has-more":
        gateway.user_responses.append({"code": 0, "data": {"items": [], "has_more": "false"}})
    else:
        gateway.user_responses.append(_page([{"union_id": "union_partial", "name": "Partial User"}]))
        if failure_case == "department-rejected":
            gateway.department_responses.append({"code": 403})
        elif failure_case == "department-transport":
            gateway.department_responses.append(RuntimeError("sanitized transport failure"))
        elif failure_case == "department-missing-token":
            gateway.department_responses.append({"code": 0, "data": {"items": [], "has_more": True}})
        elif failure_case == "department-token-loop":
            gateway.department_responses.extend(
                [
                    _page([], next_page_token="departments-repeat"),
                    _page([], next_page_token="departments-repeat"),
                ]
            )
        elif failure_case == "department-invalid-identity":
            gateway.department_responses.append(_page([{}]))
        else:
            gateway.department_responses.append({"code": 0, "data": {"items": [], "has_more": "false"}})
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, gateway)

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert "union_partial" not in result.reason
    assert "sanitized" not in result.reason


@pytest.mark.parametrize(
    "malformed_user",
    [
        {"open_id": "ou_sanitized_wrong_identity"},
        {"union_id": ""},
        {"union_id": ["union_sanitized_user"]},
    ],
)
def test_malformed_directory_identity_fails_without_partial_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    malformed_user: Mapping[str, object],
) -> None:
    gateway = FakeSDKGateway()
    gateway.user_responses.append(_page([{"union_id": "union_valid", "name": "Valid User"}, malformed_user]))
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, gateway)

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert "union_valid" not in result.reason
    assert "ou_sanitized_wrong_identity" not in result.reason


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
@pytest.mark.parametrize("invalid_code", [False, "0"], ids=("boolean", "string"))
def test_directory_rejects_non_integer_success_code_without_partial_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
    invalid_code: object,
) -> None:
    gateway = FakeSDKGateway()
    gateway.user_responses.append(
        {
            "code": invalid_code,
            "data": {"items": [{"union_id": "union_sanitized"}], "has_more": False},
        }
    )
    adapter = _adapter(monkeypatch, provider, gateway)

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert not any(call[0] == "list_departments" for call in gateway.calls)


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_text_send_uses_union_id_exact_plain_text_and_one_creation(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
) -> None:
    gateway = FakeSDKGateway()
    gateway.tenant_responses.append(_tenant_response())
    gateway.create_responses.append({"code": 0, "data": {"message_id": "om_sanitized_message"}})
    adapter = _adapter(monkeypatch, provider, gateway)

    result = adapter.messaging.send_text(ProviderUserId("union_sanitized_user"), "Rendered plain text")

    assert isinstance(result, MessageAccepted)
    creation = [call for call in gateway.calls if call[0] == "create_message"]
    assert len(creation) == 1
    receive_id, msg_type, content = creation[0][1]
    assert (receive_id, msg_type) == ("union_sanitized_user", "text")
    assert json.loads(content) == {"text": "Rendered plain text"}


def test_text_send_falls_back_to_content_equivalent_plain_text(monkeypatch: pytest.MonkeyPatch) -> None:
    gateway = FakeSDKGateway()
    gateway.tenant_responses.append(_tenant_response())
    gateway.create_responses.append({"code": 0, "data": {"message_id": "om_sanitized_message"}})
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, gateway)

    result = adapter.messaging.send_text(
        ProviderUserId("union_sanitized_user"),
        "Decision: **Approve**",
    )

    assert isinstance(result, MessageAccepted)
    creation = next(call for call in gateway.calls if call[0] == "create_message")
    assert json.loads(creation[1][2]) == {"text": "Decision: Approve"}


def test_ambiguous_text_send_is_safe_and_never_replayed(monkeypatch: pytest.MonkeyPatch) -> None:
    gateway = FakeSDKGateway()
    gateway.tenant_responses.append(_tenant_response())
    gateway.create_responses.append(RuntimeError("sensitive raw provider response"))
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, gateway)

    result = adapter.messaging.send_text(ProviderUserId("union_sanitized_user"), "Rendered text")

    assert isinstance(result, MessageSendingError)
    assert "sensitive raw provider response" not in result.reason
    assert len([call for call in gateway.calls if call[0] == "create_message"]) == 1


def test_explicit_text_rejection_is_safe_and_attempted_once(monkeypatch: pytest.MonkeyPatch) -> None:
    gateway = FakeSDKGateway()
    gateway.tenant_responses.append(_tenant_response())
    gateway.create_responses.append({"code": 230001, "msg": "sanitized rejection"})
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, gateway)

    result = adapter.messaging.send_text(ProviderUserId("union_sanitized_user"), "Rendered text")

    assert isinstance(result, MessageSendingError)
    assert "sanitized rejection" not in result.reason
    assert len([call for call in gateway.calls if call[0] == "create_message"]) == 1


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
@pytest.mark.parametrize("invalid_code", [False, "0"], ids=("boolean", "string"))
def test_text_send_rejects_non_integer_success_code(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
    invalid_code: object,
) -> None:
    gateway = FakeSDKGateway()
    gateway.tenant_responses.append(_tenant_response())
    gateway.create_responses.append({"code": invalid_code, "data": {"message_id": "om_sanitized_message"}})
    adapter = _adapter(monkeypatch, provider, gateway)

    result = adapter.messaging.send_text(ProviderUserId("union_sanitized_user"), "Rendered text")

    assert isinstance(result, MessageSendingError)
    assert len([call for call in gateway.calls if call[0] == "create_message"]) == 1


@pytest.mark.parametrize("input_type", ["file", "file-list"])
def test_file_controls_make_whole_card_unrepresentable_without_mutation(
    monkeypatch: pytest.MonkeyPatch,
    input_type: str,
) -> None:
    gateway = FakeSDKGateway()
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, gateway)
    intent = _intent(input_type)

    assessment = adapter.dynamic_card_messaging.assess(intent)

    assert assessment.representable is False
    with pytest.raises(DynamicCardMessagingError):
        adapter.dynamic_card_messaging.send_card(
            ProviderUserId("union_sanitized_user"),
            intent,
            CorrelationToken("opaque-correlation-token"),
        )
    assert not gateway.calls


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_provider_confirmed_form_preserves_markdown_after_input_without_reordering(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
) -> None:
    gateway = FakeSDKGateway()
    adapter = _adapter(monkeypatch, provider, gateway)
    intent = ResolvedForm(
        title="Approval",
        blocks=(ParagraphInput("comment", None), MarkdownText("After input")),
        user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="This value must not be rendered",
    )

    assessment = adapter.dynamic_card_messaging.assess(intent)
    encoded = adapter_module._MSFeishuLarkCardCodec().encode(
        intent,
        CorrelationToken("opaque-correlation-token"),
    )

    assert assessment.representable is True
    body = encoded["body"]
    assert isinstance(body, dict)
    body_elements = body["elements"]
    assert isinstance(body_elements, list)
    form = body_elements[0]
    assert isinstance(form, dict)
    form_elements = form["elements"]
    assert isinstance(form_elements, list)
    tags: list[object] = []
    for element in form_elements:
        assert isinstance(element, dict)
        tags.append(element["tag"])
    assert tags == ["input", "markdown", "column_set"]
    assert gateway.calls == []


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_card_renderer_matches_provider_confirmed_form_contract(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
) -> None:
    gateway = FakeSDKGateway()
    gateway.tenant_responses.append(_tenant_response())
    gateway.create_responses.append({"code": 0, "data": {"message_id": "om_sanitized_card"}})
    adapter = _adapter(monkeypatch, provider, gateway)
    intent = _provider_confirmed_form_intent()

    result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("union_sanitized_user"),
        intent,
        CorrelationToken("synthetic-correlation-token"),
    )

    assert isinstance(result, MessageAccepted)
    creations = [call for call in gateway.calls if call[0] == "create_message"]
    assert len(creations) == 1
    creation = creations[0]
    _, msg_type, content = creation[1]
    assert msg_type == "interactive"
    assert json.loads(content) == adapter_module._MSFeishuLarkCardCodec().encode(
        intent,
        CorrelationToken("synthetic-correlation-token"),
    )


@pytest.mark.parametrize(
    ("provider_response", "expected_stage"),
    [
        ({"code": 230001, "msg": "sensitive provider rejection"}, "provider-response"),
        (RuntimeError("sensitive SDK exception"), "create-message"),
        ({"code": 0, "data": {"message_id": ""}}, "response-validation"),
    ],
)
def test_card_send_logs_only_the_safe_acceptance_failure_stage(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider_response: Mapping[str, object] | Exception,
    expected_stage: str,
) -> None:
    gateway = FakeSDKGateway()
    gateway.tenant_responses.append(_tenant_response())
    gateway.create_responses.append(provider_response)
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, gateway)

    result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("union_sanitized_user"),
        _intent(),
        CorrelationToken("synthetic-correlation-token"),
    )

    assert result == MessageSendingError("Feishu card acceptance could not be confirmed.")
    assert len([call for call in gateway.calls if call[0] == "create_message"]) == 1
    assert any(
        record.name == adapter_module.__name__
        and record.getMessage() == f"Feishu/Lark card acceptance failed at {expected_stage} stage"
        for record in caplog.records
    )
    assert "sensitive provider rejection" not in caplog.text
    assert "sensitive SDK exception" not in caplog.text


def test_reference_round_trips_and_updates_only_exact_original_message(monkeypatch: pytest.MonkeyPatch) -> None:
    source_gateway = FakeSDKGateway()
    source_gateway.tenant_responses.append(_tenant_response())
    source_gateway.create_responses.append({"code": 0, "data": {"message_id": "om_sanitized_card"}})
    source = _adapter(monkeypatch, IMProvider.FEISHU, source_gateway)
    accepted = source.dynamic_card_messaging.send_card(
        ProviderUserId("union_sanitized_user"),
        _intent(),
        CorrelationToken("opaque-correlation-token"),
    )
    assert isinstance(accepted, MessageAccepted)
    padding = "=" * (-len(str(accepted.locator)) % 4)
    serialized_payload = base64.urlsafe_b64decode(str(accepted.locator) + padding)
    assert json.loads(serialized_payload) == {
        "v": 1,
        "p": "feishu",
        "message_id": "om_sanitized_card",
    }
    persisted = MessageLocator(str(accepted.locator))

    replacement_gateway = FakeSDKGateway()
    replacement_gateway.tenant_responses.append(_tenant_response())
    replacement_gateway.patch_responses.append({"code": 0, "data": {}})
    replacement = _adapter(monkeypatch, IMProvider.FEISHU, replacement_gateway)

    result = replacement.dynamic_card_messaging.replace_with_static(
        persisted,
        StaticCardIntent("Submitted **successfully**"),
    )

    assert result is None
    mutation = next(call for call in replacement_gateway.calls if call[0] == "patch_message")
    assert mutation[1][0] == "om_sanitized_card"
    static_card = json.loads(mutation[1][1])
    assert static_card == {
        "schema": "2.0",
        "body": {"elements": [{"tag": "markdown", "content": "Submitted **successfully**"}]},
    }


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_reference_survives_provider_app_secret_rotation(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
) -> None:
    source_gateway = FakeSDKGateway()
    source_gateway.tenant_responses.append(_tenant_response())
    source_gateway.create_responses.append({"code": 0, "data": {"message_id": "om_sanitized_card"}})
    source = _adapter(monkeypatch, provider, source_gateway)
    accepted = source.dynamic_card_messaging.send_card(
        ProviderUserId("union_sanitized_user"),
        _intent(),
        CorrelationToken("opaque-correlation-token"),
    )
    assert isinstance(accepted, MessageAccepted)

    replacement_gateway = FakeSDKGateway()
    replacement_gateway.tenant_responses.append(_tenant_response())
    replacement_gateway.patch_responses.append({"code": 0})
    monkeypatch.setattr(adapter_module, "_create_sdk_gateway", lambda _credentials, _domain: replacement_gateway)
    rotated_credentials = _credentials(provider).model_copy(
        update={"app_secret": "sanitized-rotated-app-secret"},
    )
    replacement = (
        FeishuIMProviderAdapter(rotated_credentials)
        if isinstance(rotated_credentials, FeishuIMIntegrationCredentials)
        else LarkIMProviderAdapter(rotated_credentials)
    )

    result = replacement.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Submitted after credential rotation"),
    )

    assert result is None
    mutation = next(call for call in replacement_gateway.calls if call[0] == "patch_message")
    assert mutation[1][0] == "om_sanitized_card"


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_message_reference_does_not_depend_on_dify_secret_key(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
) -> None:
    source_gateway = FakeSDKGateway()
    source_gateway.tenant_responses.append(_tenant_response())
    source_gateway.create_responses.append({"code": 0, "data": {"message_id": "om_sanitized_card"}})
    source = _adapter(monkeypatch, provider, source_gateway)
    accepted = source.dynamic_card_messaging.send_card(
        ProviderUserId("union_sanitized_user"),
        _intent(),
        CorrelationToken("opaque-correlation-token"),
    )
    assert isinstance(accepted, MessageAccepted)

    replacement_gateway = FakeSDKGateway()
    replacement_gateway.tenant_responses.append(_tenant_response())
    replacement_gateway.patch_responses.append({"code": 0})
    replacement = _adapter(monkeypatch, provider, replacement_gateway)

    result = replacement.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Submitted"),
    )

    assert result is None
    assert len([call for call in replacement_gateway.calls if call[0] == "patch_message"]) == 1


def test_cross_provider_reference_is_invalid_without_mutation(monkeypatch: pytest.MonkeyPatch) -> None:
    source_gateway = FakeSDKGateway()
    source_gateway.tenant_responses.append(_tenant_response())
    source_gateway.create_responses.append({"code": 0, "data": {"message_id": "om_sanitized_card"}})
    source = _adapter(monkeypatch, IMProvider.FEISHU, source_gateway)
    accepted = source.dynamic_card_messaging.send_card(
        ProviderUserId("union_sanitized_user"),
        _intent(),
        CorrelationToken("opaque-correlation-token"),
    )
    assert isinstance(accepted, MessageAccepted)
    lark_gateway = FakeSDKGateway()
    lark = _adapter(monkeypatch, IMProvider.LARK, lark_gateway)

    result = lark.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Submitted"),
    )

    assert isinstance(result, ReplacementError)
    assert result.kind is ReplacementErrorKind.INVALID_REFERENCE
    assert not lark_gateway.calls


def test_malformed_reference_is_invalid_without_provider_io(monkeypatch: pytest.MonkeyPatch) -> None:
    source_gateway = FakeSDKGateway()
    source_gateway.tenant_responses.append(_tenant_response())
    source_gateway.create_responses.append({"code": 0, "data": {"message_id": "om_sanitized_card"}})
    source = _adapter(monkeypatch, IMProvider.FEISHU, source_gateway)
    accepted = source.dynamic_card_messaging.send_card(
        ProviderUserId("union_sanitized_user"),
        _intent(),
        CorrelationToken("opaque-correlation-token"),
    )
    assert isinstance(accepted, MessageAccepted)
    locator_value = str(accepted.locator)
    malformed_suffix = "A" if not locator_value.endswith("A") else "B"
    malformed = MessageLocator(locator_value[:-1] + malformed_suffix)
    replacement_gateway = FakeSDKGateway()
    replacement = _adapter(monkeypatch, IMProvider.FEISHU, replacement_gateway)

    result = replacement.dynamic_card_messaging.replace_with_static(malformed, StaticCardIntent("Submitted"))

    assert isinstance(result, ReplacementError)
    assert result.kind is ReplacementErrorKind.INVALID_REFERENCE
    assert replacement_gateway.calls == []


def test_reference_rejects_redundant_base64_padding_without_message_mutation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reference = _accepted_card_reference(monkeypatch)

    _assert_invalid_reference_without_mutation(monkeypatch, f"{str(reference)}=")


@pytest.mark.parametrize(
    ("message_id", "canonical_character", "standard_base64_alias"),
    [("om_\u00be", "-", "+"), ("om_\u00bf", "_", "/")],
    ids=("plus-alias", "slash-alias"),
)
def test_reference_rejects_standard_base64_aliases_without_message_mutation(
    monkeypatch: pytest.MonkeyPatch,
    message_id: str,
    canonical_character: str,
    standard_base64_alias: str,
) -> None:
    reference = _accepted_card_reference(monkeypatch, message_id=message_id)
    assert canonical_character in str(reference)
    aliased_payload = str(reference).replace(canonical_character, standard_base64_alias)

    _assert_invalid_reference_without_mutation(monkeypatch, aliased_payload)


@pytest.mark.parametrize(
    "opaque_template",
    [
        ".{reference}",
        "{reference}.",
        "{reference}.extra",
    ],
    ids=("leading-dot", "trailing-dot", "extra-segment"),
)
def test_reference_rejects_extra_segments_and_dots_without_message_mutation(
    monkeypatch: pytest.MonkeyPatch,
    opaque_template: str,
) -> None:
    reference = _accepted_card_reference(monkeypatch)
    opaque = opaque_template.format(reference=str(reference))

    _assert_invalid_reference_without_mutation(monkeypatch, opaque)


def test_reference_does_not_require_tenant_lookup_before_patch(monkeypatch: pytest.MonkeyPatch) -> None:
    source_gateway = FakeSDKGateway()
    source_gateway.tenant_responses.append(_tenant_response("tenant_source"))
    source_gateway.create_responses.append({"code": 0, "data": {"message_id": "om_sanitized_card"}})
    source = _adapter(monkeypatch, IMProvider.FEISHU, source_gateway)
    accepted = source.dynamic_card_messaging.send_card(
        ProviderUserId("union_sanitized_user"),
        _intent(),
        CorrelationToken("opaque-correlation-token"),
    )
    assert isinstance(accepted, MessageAccepted)
    replacement_gateway = FakeSDKGateway()
    replacement_gateway.patch_responses.append({"code": 0, "data": {}})
    replacement = _adapter(monkeypatch, IMProvider.FEISHU, replacement_gateway)

    result = replacement.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Submitted"),
    )

    assert result is None
    assert [call[0] for call in replacement_gateway.calls] == ["patch_message"]


@pytest.mark.parametrize("provider_code", [230001, 230011, 230020])
def test_provider_stale_reference_is_classified_without_replay(
    monkeypatch: pytest.MonkeyPatch,
    provider_code: int,
) -> None:
    source_gateway = FakeSDKGateway()
    source_gateway.tenant_responses.append(_tenant_response())
    source_gateway.create_responses.append({"code": 0, "data": {"message_id": "om_sanitized_card"}})
    source = _adapter(monkeypatch, IMProvider.FEISHU, source_gateway)
    accepted = source.dynamic_card_messaging.send_card(
        ProviderUserId("union_sanitized_user"),
        _intent(),
        CorrelationToken("opaque-correlation-token"),
    )
    assert isinstance(accepted, MessageAccepted)
    replacement_gateway = FakeSDKGateway()
    replacement_gateway.tenant_responses.append(_tenant_response())
    replacement_gateway.patch_responses.append({"code": provider_code, "msg": "sanitized stale response"})
    replacement = _adapter(monkeypatch, IMProvider.FEISHU, replacement_gateway)

    result = replacement.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Submitted"),
    )

    assert isinstance(result, ReplacementError)
    assert result.kind is ReplacementErrorKind.STALE_REFERENCE
    assert "sanitized stale response" not in result.reason
    assert len([call for call in replacement_gateway.calls if call[0] == "patch_message"]) == 1


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
@pytest.mark.parametrize("invalid_code", [False, "0"], ids=("boolean", "string"))
def test_card_replacement_rejects_non_integer_success_code(
    monkeypatch: pytest.MonkeyPatch,
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK],
    invalid_code: object,
) -> None:
    source_gateway = FakeSDKGateway()
    source_gateway.tenant_responses.append(_tenant_response())
    source_gateway.create_responses.append({"code": 0, "data": {"message_id": "om_sanitized_card"}})
    source = _adapter(monkeypatch, provider, source_gateway)
    accepted = source.dynamic_card_messaging.send_card(
        ProviderUserId("union_sanitized_user"),
        _intent(),
        CorrelationToken("opaque-correlation-token"),
    )
    assert isinstance(accepted, MessageAccepted)
    replacement_gateway = FakeSDKGateway()
    replacement_gateway.tenant_responses.append(_tenant_response())
    replacement_gateway.patch_responses.append({"code": invalid_code})
    replacement = _adapter(monkeypatch, provider, replacement_gateway)

    result = replacement.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Submitted"),
    )

    assert isinstance(result, ReplacementError)
    assert result.kind is ReplacementErrorKind.UNKNOWN
    assert len([call for call in replacement_gateway.calls if call[0] == "patch_message"]) == 1


def test_root_close_blocks_new_capability_access_without_invalidating_created_handler(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, FakeSDKGateway())
    directory = adapter.directory

    adapter.close()
    adapter.close()

    with pytest.raises(RuntimeError, match="closed"):
        _ = adapter.directory
    assert directory is not None
