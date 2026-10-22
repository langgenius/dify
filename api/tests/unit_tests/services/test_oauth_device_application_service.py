import json
import logging
from dataclasses import asdict, dataclass, field, replace
from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from constants.oauth_bearer import SubjectType
from machinery.context import RequestContext
from services.entities.account_entities import AccountSnapshot
from services.oauth_device_application_service import OAuthDeviceApplicationService
from services.oauth_device_contracts import (
    AccessDeniedError,
    AlreadyResolvedError,
    ApprovalOutcomeUnknownError,
    ApprovalSessionConsumedError,
    ApprovalTransitionConfirmation,
    AuthorizationPendingError,
    DeviceApprovalRecord,
    DeviceFlowStateView,
    DeviceFlowStatus,
    DeviceMutation,
    DeviceRequestContext,
    DeviceStateLostError,
    DeviceWorkspace,
    ExpiredOrUnknownError,
    ExpiredTokenError,
    ExternalApprovalCSRFError,
    ExternalApprovalGrant,
    ExternalApprovalRateLimitError,
    ExternalIdentityConflictError,
    ExternalSubjectAssertion,
    ExternalUserCodeMismatchError,
    InvalidApprovalSessionError,
    InvalidSSOAssertionError,
    InvalidTransitionError,
    InvalidUserCodeError,
    IssuedOAuthToken,
    OAuthDeviceSession,
    OAuthDeviceSessionNotFoundError,
    OAuthDeviceSessionPage,
    OAuthDeviceSSOConfigurationError,
    OAuthDeviceSSOInitiationError,
    OAuthDeviceTokenRotation,
    PollPayload,
    PollTooFastError,
    SlowDownDecision,
    StateNotFoundError,
    UnsupportedClientError,
)


@dataclass
class FakeState:
    user_code: str = "ABCD-EFGH"
    client_id: str = "difyctl"
    device_label: str = "CLI"
    installation_id: str = ""
    status: DeviceFlowStatus = DeviceFlowStatus.PENDING
    token_id: str | None = None
    created_ip: str = "127.0.0.1"
    approval: DeviceApprovalRecord | None = None
    poll_payload: PollPayload | None = None

    def to_json(self) -> str:
        return json.dumps(asdict(self))


@dataclass
class FakeStore:
    states: dict[str, tuple[str, DeviceFlowStateView]] = field(default_factory=dict)
    poll_decision: SlowDownDecision = SlowDownDecision.OK
    approval_acquired: bool = True
    approval: DeviceApprovalRecord | None = None
    approve_error: Exception | None = None
    confirmation: ApprovalTransitionConfirmation | None = None
    confirm_error: Exception | None = None
    restore_error: Exception | None = None
    remaining: int = 900
    acquired: list[tuple[str, str, int]] = field(default_factory=list)
    released: list[tuple[str, str]] = field(default_factory=list)
    started: list[tuple[str, str, str, str]] = field(default_factory=list)
    restored: list[str] = field(default_factory=list)

    def start(self, client_id: str, device_label: str, installation_id: str, created_ip: str) -> tuple[str, str, int]:
        self.started.append((client_id, device_label, installation_id, created_ip))
        return "device-1", "ABCD-EFGH", 900

    def load_by_user_code(self, user_code: str) -> tuple[str, DeviceFlowStateView] | None:
        return self.states.get(user_code)

    def load_by_device_code(self, device_code: str) -> DeviceFlowStateView | None:
        return next((state for code, state in self.states.values() if code == device_code), None)

    def approve(self, device_code: str, transition_id: str, approval: DeviceApprovalRecord) -> None:
        if self.approve_error is not None:
            raise self.approve_error
        self.approval = approval
        state = self.load_by_device_code(device_code)
        if state is not None:
            state.status = DeviceFlowStatus.APPROVED
            state.token_id = f"transition:{transition_id}"
            state.approval = approval

    def deny(self, device_code: str, transition_id: str) -> None:
        state = self.load_by_device_code(device_code)
        if state is not None:
            state.status = DeviceFlowStatus.DENIED
            state.token_id = f"transition:{transition_id}"

    def confirm_approval(self, device_code: str, transition_id: str) -> ApprovalTransitionConfirmation:
        if self.confirm_error is not None:
            raise self.confirm_error
        if self.confirmation is not None:
            return self.confirmation
        state = self.load_by_device_code(device_code)
        if state is None:
            return ApprovalTransitionConfirmation.UNKNOWN
        if state.status is DeviceFlowStatus.APPROVED and state.token_id == f"transition:{transition_id}":
            return ApprovalTransitionConfirmation.PUBLISHED
        return ApprovalTransitionConfirmation.NOT_PUBLISHED

    def consume_on_poll(self, device_code: str) -> tuple[DeviceFlowStateView, int] | None:
        for user_code, (code, state) in self.states.items():
            if code == device_code:
                del self.states[user_code]
                return state, self.remaining
        return None

    def restore(self, device_code: str, state: DeviceFlowStateView, ttl_seconds: int) -> bool:
        _ = ttl_seconds
        if self.restore_error is not None:
            raise self.restore_error
        if self.load_by_device_code(device_code) is not None:
            return False
        self.states[state.user_code] = (device_code, state)
        self.restored.append(device_code)
        return True

    def remaining_seconds(self, device_code: str) -> int:
        _ = device_code
        return self.remaining

    def record_poll(self, device_code: str, interval_seconds: int) -> SlowDownDecision:
        _ = (device_code, interval_seconds)
        return self.poll_decision

    def try_acquire_approval(self, guard_id: str, owner_id: str, ttl_seconds: int) -> bool:
        self.acquired.append((guard_id, owner_id, ttl_seconds))
        return self.approval_acquired

    def release_approval(self, guard_id: str, owner_id: str) -> None:
        self.released.append((guard_id, owner_id))


@dataclass
class FakeAccounts:
    account: AccountSnapshot
    active_external_emails: set[str] = field(default_factory=set)

    def get(self, account_id: str) -> AccountSnapshot | None:
        return self.account if account_id == self.account.id else None

    def has_active_email(self, email: str) -> bool:
        return email in self.active_external_emails


@dataclass
class FakeWorkspaces:
    rows: tuple[DeviceWorkspace, ...]
    error: Exception | None = None

    def list_for_device_flow(self, account_id: str) -> tuple[DeviceWorkspace, ...]:
        _ = account_id
        if self.error is not None:
            raise self.error
        return self.rows


@dataclass
class FakeTokens:
    account_token: IssuedOAuthToken
    external_token: IssuedOAuthToken
    external_issues: int = 0
    account_issues: int = 0
    issue_error: Exception | None = None
    device_keys: list[str] = field(default_factory=list)
    sessions: tuple[OAuthDeviceSession, ...] = ()
    revoke_allowed: bool = True

    def issue_account_token(
        self,
        *,
        account: AccountSnapshot,
        workspace_id: str,
        client_id: str,
        device_label: str,
        device_key: str,
    ) -> IssuedOAuthToken:
        _ = (account, workspace_id, client_id, device_label)
        if self.issue_error is not None:
            raise self.issue_error
        self.device_keys.append(device_key)
        self.account_issues += 1
        return self.account_token

    def issue_external_token(
        self,
        *,
        subject_email: str,
        subject_issuer: str,
        client_id: str,
        device_label: str,
        device_key: str,
    ) -> IssuedOAuthToken:
        _ = (subject_email, subject_issuer, client_id, device_label)
        if self.issue_error is not None:
            raise self.issue_error
        self.device_keys.append(device_key)
        self.external_issues += 1
        return self.external_token

    def list_account_sessions(self, *, account_id: str, page: int, limit: int) -> OAuthDeviceSessionPage:
        _ = account_id
        return OAuthDeviceSessionPage(page=page, limit=limit, total=len(self.sessions), items=self.sessions)

    def revoke_account_session(self, *, account_id: str, token_id: str) -> bool:
        _ = (account_id, token_id)
        return self.revoke_allowed


@dataclass
class FakeSSO:
    assertion: ExternalSubjectAssertion
    grant: ExternalApprovalGrant
    assertion_nonce_available: bool = True
    approval_nonce_available: bool = True
    callback_url: str | None = None
    reserved_nonces: list[tuple[str, str]] = field(default_factory=list)
    released_nonces: list[tuple[str, str]] = field(default_factory=list)

    def initiate(self, *, user_code: str, callback_url: str, ttl_seconds: int) -> str:
        _ = (user_code, ttl_seconds)
        self.callback_url = callback_url
        return "https://idp.example/authorize"

    def verify_assertion(self, assertion: str) -> ExternalSubjectAssertion:
        _ = assertion
        return self.assertion

    def mint_approval_grant(
        self,
        *,
        issuer: str,
        subject_email: str,
        subject_issuer: str,
        user_code: str,
    ) -> str:
        _ = (issuer, subject_email, subject_issuer, user_code)
        return "approval-grant"

    def verify_approval_grant(self, token: str) -> ExternalApprovalGrant:
        _ = token
        return self.grant

    def consume_assertion_nonce(self, nonce: str) -> bool:
        _ = nonce
        return self.assertion_nonce_available

    def reserve_approval_nonce(self, nonce: str, reservation_id: str) -> bool:
        self.reserved_nonces.append((nonce, reservation_id))
        return self.approval_nonce_available

    def release_approval_nonce(self, nonce: str, reservation_id: str) -> None:
        self.released_nonces.append((nonce, reservation_id))


@dataclass
class FakeLimiter:
    limited: bool = False
    recorded: list[str] = field(default_factory=list)

    def is_rate_limited(self, subject_email: str) -> bool:
        _ = subject_email
        return self.limited

    def record(self, subject_email: str) -> None:
        self.recorded.append(subject_email)


@dataclass(frozen=True, slots=True)
class FakeSettings:
    known_client_ids: frozenset[str] = frozenset({"difyctl"})
    verification_base_url: str | None = "https://console.example"
    sso_base_url: str | None = "https://api.example"


@dataclass
class Harness:
    service: OAuthDeviceApplicationService
    store: FakeStore
    accounts: FakeAccounts
    workspaces: FakeWorkspaces
    tokens: FakeTokens
    sso: FakeSSO
    limiter: FakeLimiter


def _account() -> AccountSnapshot:
    now = datetime.now(UTC)
    return AccountSnapshot(
        id="account-1",
        name="Ada",
        email="ada@example.com",
        avatar=None,
        is_password_set=True,
        interface_language="en-US",
        interface_theme="light",
        timezone="UTC",
        last_login_at=now,
        last_login_ip="127.0.0.1",
        status="active",
        initialized_at=now,
        created_at=now,
    )


def _harness(*, settings: FakeSettings | None = None) -> Harness:
    account = _account()
    store = FakeStore(states={"ABCD-EFGH": ("device-1", FakeState())})
    accounts = FakeAccounts(account)
    token = IssuedOAuthToken(
        token="secret-token",
        expires_at="2030-01-01T00:00:00+00:00",
        rotation=OAuthDeviceTokenRotation(
            token_id="token-1",
            replaced_token_id=None,
            replaced_token_hash=None,
        ),
    )
    tokens = FakeTokens(account_token=token, external_token=token)
    external_assertion = ExternalSubjectAssertion(
        subject_email="external@example.com",
        subject_issuer="https://idp.example",
        user_code="ABCD-EFGH",
        nonce="assertion-nonce",
    )
    approval_grant = ExternalApprovalGrant(
        subject_email=external_assertion.subject_email,
        subject_issuer=external_assertion.subject_issuer,
        user_code=external_assertion.user_code,
        nonce="approval-nonce",
        csrf_token="csrf-token",
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
    )
    sso = FakeSSO(assertion=external_assertion, grant=approval_grant)
    limiter = FakeLimiter()
    workspaces = FakeWorkspaces((DeviceWorkspace(id="workspace-1", name="Primary", role="owner", current=True),))
    service = OAuthDeviceApplicationService(
        store=store,
        accounts=accounts,
        workspaces=workspaces,
        tokens=tokens,
        sessions=tokens,
        sso=sso,
        external_approval_limiter=limiter,
        settings=settings or FakeSettings(),
    )
    return Harness(
        service=service,
        store=store,
        accounts=accounts,
        workspaces=workspaces,
        tokens=tokens,
        sso=sso,
        limiter=limiter,
    )


def _approve(harness: Harness, *, external: bool) -> DeviceMutation:
    if external:
        return harness.service.approve_external(
            DeviceRequestContext("request-1", None),
            approval_grant="grant",
            csrf_token="csrf-token",
            user_code="ABCD-EFGH",
        )
    return harness.service.approve(RequestContext("request-1", None, "account-1", "workspace-1"), user_code="ABCD-EFGH")


def _approved_harness(*, external: bool = False) -> Harness:
    harness = _harness()
    _approve(harness, external=external)
    return harness


def _poll(harness: Harness, *, poll_ip: str = "127.0.0.1") -> PollPayload:
    return harness.service.poll(device_code="device-1", poll_ip=poll_ip)


def _issues(harness: Harness) -> int:
    return harness.tokens.account_issues + harness.tokens.external_issues


def test_start_rejects_unknown_client_before_writing_state() -> None:
    harness = _harness()

    with pytest.raises(UnsupportedClientError):
        harness.service.start(
            client_id="unknown",
            device_label="CLI",
            installation_id="",
            created_ip="127.0.0.1",
            request_origin="https://api.example",
        )


def test_poll_preserves_slow_down_precedence() -> None:
    harness = _harness()
    harness.store.poll_decision = SlowDownDecision.SLOW_DOWN

    with pytest.raises(PollTooFastError):
        harness.service.poll(device_code="device-1", poll_ip="127.0.0.1")


def test_cross_ip_audit_uses_real_token_id_from_poll_payload(caplog: pytest.LogCaptureFixture) -> None:
    harness = _harness()
    _device_code, state = harness.store.states["ABCD-EFGH"]
    state.status = DeviceFlowStatus.APPROVED
    state.token_id = "transition:approve-1:token-1"
    state.poll_payload = {
        "token": "secret-token",
        "expires_at": "2030-01-01T00:00:00+00:00",
        "subject_type": "account",
        "account": {"id": "account-1"},
        "workspaces": [],
        "default_workspace_id": None,
        "token_id": "token-1",
    }

    with caplog.at_level(logging.WARNING):
        harness.service.poll(device_code="device-1", poll_ip="192.0.2.10")

    assert "token_id=token-1" in caplog.text
    assert "transition:approve-1" not in caplog.text


def test_account_sessions_delegate_to_token_repository() -> None:
    harness = _harness()
    session = OAuthDeviceSession(
        id="token-1",
        prefix="dfoa_",
        client_id="difyctl",
        device_label="CLI",
        created_at=None,
        last_used_at=None,
        expires_at=None,
    )
    harness.tokens.sessions = (session,)

    result = harness.service.list_account_sessions(account_id="account-1", page=2, limit=10)

    assert result.items == (session,)
    assert result.page == 2


def test_revoke_account_session_hides_missing_or_foreign_token() -> None:
    harness = _harness()
    harness.tokens.revoke_allowed = False

    with pytest.raises(OAuthDeviceSessionNotFoundError):
        harness.service.revoke_account_session(account_id="account-1", token_id="foreign-token")


def test_sso_initiation_uses_configured_api_origin() -> None:
    harness = _harness()

    result = harness.service.initiate_sso(
        DeviceRequestContext("request-1", None),
        user_code="abcd-efgh",
    )

    assert result.redirect_url == "https://idp.example/authorize"
    assert harness.sso.callback_url == "https://api.example/openapi/v1/oauth/device/sso-complete"


def test_sso_completion_exchanges_valid_assertion_for_approval_grant() -> None:
    harness = _harness()

    result = harness.service.complete_sso(
        DeviceRequestContext("request-1", None),
        inbound_error=None,
        inbound_user_code=None,
        assertion="signed-assertion",
    )

    assert result.error_code is None
    assert result.user_code == "ABCD-EFGH"
    assert result.approval_grant == "approval-grant"


@pytest.mark.parametrize("csrf_token", ["", "wrong"])
def test_external_approval_rejects_bad_csrf_before_minting(csrf_token: str) -> None:
    harness = _harness()

    with pytest.raises(ExternalApprovalCSRFError):
        harness.service.approve_external(
            DeviceRequestContext("request-1", None),
            approval_grant="grant",
            csrf_token=csrf_token,
            user_code="ABCD-EFGH",
        )

    assert harness.tokens.external_issues == 0
    assert harness.sso.reserved_nonces == []
    assert harness.store.acquired == []


@pytest.mark.parametrize("base_url", [None, "https://console.example/"])
def test_start_returns_device_codes_with_configured_or_request_origin(base_url: str | None) -> None:
    harness = _harness(settings=FakeSettings(verification_base_url=base_url))

    result = harness.service.start(
        client_id="difyctl",
        device_label="CLI",
        installation_id="abcd1234",
        created_ip="127.0.0.1",
        request_origin="https://request.example/",
    )

    assert result.device_code == "device-1"
    assert result.user_code == "ABCD-EFGH"
    assert result.verification_uri == (base_url or "https://request.example/") + "device"
    assert result.expires_in == 900
    assert result.interval == 5
    assert harness.store.started == [("difyctl", "CLI", "abcd1234", "127.0.0.1")]


@pytest.mark.parametrize(
    ("state", "expected_error"),
    [
        (None, ExpiredTokenError),
        (FakeState(), AuthorizationPendingError),
        (FakeState(status=DeviceFlowStatus.DENIED), AccessDeniedError),
        (FakeState(status=DeviceFlowStatus.APPROVED), ExpiredTokenError),
    ],
    ids=["expired", "pending", "denied", "approved-without-token"],
)
def test_poll_rejects_unavailable_tokens(state: FakeState | None, expected_error: type[Exception]) -> None:
    harness = _harness()
    harness.store.states = {} if state is None else {"ABCD-EFGH": ("device-1", state)}

    with pytest.raises(expected_error):
        harness.service.poll(device_code="device-1", poll_ip="127.0.0.1")

    if state is not None and state.status is DeviceFlowStatus.PENDING:
        assert harness.store.states["ABCD-EFGH"][1] is state
    assert harness.tokens.account_issues == harness.tokens.external_issues == 0


def test_poll_does_not_mint_an_approval_consumed_by_another_request() -> None:
    harness = _approved_harness()

    with patch.object(harness.store, "consume_on_poll", return_value=None), pytest.raises(ExpiredTokenError):
        _poll(harness)

    assert harness.tokens.account_issues == 0
    assert harness.store.released == [harness.store.acquired[0][:2]]


@pytest.mark.parametrize("status", [None, *DeviceFlowStatus])
def test_lookup_only_accepts_pending_codes(status: DeviceFlowStatus | None) -> None:
    harness = _harness()
    harness.store.states = {} if status is None else {"ABCD-EFGH": ("device-1", FakeState(status=status))}

    result = harness.service.lookup(user_code=" abcd-efgh ")

    assert result.valid is (status is DeviceFlowStatus.PENDING)
    assert result.expires_in_remaining == (900 if result.valid else 0)
    assert result.client_id == (None if status is None else "difyctl")


@pytest.mark.parametrize("operation", ["approve", "deny"])
@pytest.mark.parametrize("status", [None, DeviceFlowStatus.APPROVED, DeviceFlowStatus.DENIED])
def test_account_decisions_reject_expired_or_resolved_codes(operation: str, status: DeviceFlowStatus | None) -> None:
    harness = _harness()
    harness.store.states = {} if status is None else {"ABCD-EFGH": ("device-1", FakeState(status=status))}

    expected_error = ExpiredOrUnknownError if status is None else AlreadyResolvedError
    if operation == "approve":
        with pytest.raises(expected_error):
            harness.service.approve(
                RequestContext("request-1", None, "account-1", "workspace-1"), user_code="ABCD-EFGH"
            )
    else:
        with pytest.raises(expected_error):
            harness.service.deny(user_code="ABCD-EFGH")

    assert harness.tokens.account_issues == 0
    assert harness.store.acquired == []


def test_denial_changes_poll_result_without_issuing_token() -> None:
    harness = _harness()

    result = harness.service.deny(user_code=" abcd-efgh ")

    assert result.status == "denied"
    with pytest.raises(AccessDeniedError):
        harness.service.poll(device_code="device-1", poll_ip="127.0.0.1")
    assert harness.tokens.account_issues == harness.tokens.external_issues == 0


@pytest.mark.parametrize("error", [StateNotFoundError("expired"), InvalidTransitionError("already approved")])
def test_deny_reports_state_lost_if_transition_races(error: Exception) -> None:
    harness = _harness()

    with patch.object(harness.store, "deny", side_effect=error), pytest.raises(DeviceStateLostError):
        harness.service.deny(user_code="ABCD-EFGH")

    assert harness.store.states["ABCD-EFGH"][1].status is DeviceFlowStatus.PENDING


def test_account_approval_requires_existing_account() -> None:
    harness = _harness()

    with pytest.raises(DeviceStateLostError):
        harness.service.approve(
            RequestContext("request-1", None, "missing-account", "workspace-1"), user_code="ABCD-EFGH"
        )

    assert harness.tokens.account_issues == 0
    assert harness.store.acquired == []


@pytest.mark.parametrize("external", [False, True], ids=["account", "external"])
def test_approval_records_the_subject_without_minting(external: bool) -> None:
    harness = _harness()

    result = _approve(harness, external=external)

    assert result.status == "approved"
    expected: DeviceApprovalRecord = (
        {
            "subject_type": SubjectType.EXTERNAL_SSO,
            "account_id": None,
            "workspace_id": None,
            "subject_email": "external@example.com",
            "subject_issuer": "https://idp.example",
        }
        if external
        else {
            "subject_type": SubjectType.ACCOUNT,
            "account_id": "account-1",
            "workspace_id": "workspace-1",
            "subject_email": "ada@example.com",
            "subject_issuer": "dify:account",
        }
    )
    assert harness.store.approval == expected
    assert _issues(harness) == 0
    assert harness.store.acquired == []
    assert len(harness.sso.reserved_nonces) == (1 if external else 0)
    assert harness.sso.released_nonces == []


@pytest.mark.parametrize("external", [False, True], ids=["account", "external"])
def test_first_poll_mints_once_and_returns_payload(external: bool) -> None:
    harness = _approved_harness(external=external)

    payload = _poll(harness)

    assert payload["token"] == "secret-token"
    assert payload["token_id"] == "token-1"
    assert _issues(harness) == 1
    if external:
        assert payload["subject_type"] == "external_sso"
        assert payload["subject_email"] == "external@example.com"
        assert payload["subject_issuer"] == "https://idp.example"
        assert payload["account"] is None
        assert payload["workspaces"] == []
    else:
        assert payload["subject_type"] == "account"
        assert payload["account"] == {"id": "account-1", "email": "ada@example.com", "name": "Ada"}
        assert payload["workspaces"] == [{"id": "workspace-1", "name": "Primary", "role": "owner"}]
        assert payload["default_workspace_id"] == "workspace-1"
    assert harness.store.released == [harness.store.acquired[0][:2]]
    with pytest.raises(ExpiredTokenError):
        _poll(harness)
    assert _issues(harness) == 1


def test_poll_waits_while_another_poll_holds_the_rotation_guard() -> None:
    harness = _approved_harness()
    harness.store.approval_acquired = False

    with pytest.raises(AuthorizationPendingError):
        _poll(harness)

    assert harness.tokens.account_issues == 0
    assert harness.store.load_by_device_code("device-1") is not None
    assert harness.store.released == []


@pytest.mark.parametrize("external", [False, True], ids=["account", "external"])
def test_mint_failure_restores_the_approval_for_a_retry(external: bool) -> None:
    harness = _approved_harness(external=external)
    harness.tokens.issue_error = RuntimeError("db down")

    with pytest.raises(RuntimeError, match="db down"):
        _poll(harness)

    assert harness.store.restored == ["device-1"]
    assert harness.store.released == [harness.store.acquired[0][:2]]
    harness.tokens.issue_error = None
    assert _poll(harness)["token"] == "secret-token"
    assert _issues(harness) == 1


def test_poll_lists_workspaces_before_minting() -> None:
    harness = _approved_harness()
    harness.workspaces.error = RuntimeError("workspace unavailable")

    with pytest.raises(RuntimeError, match="workspace unavailable"):
        _poll(harness)

    assert harness.tokens.account_issues == 0
    assert harness.store.restored == ["device-1"]


def test_restore_failure_does_not_hide_the_mint_error() -> None:
    harness = _approved_harness()
    harness.tokens.issue_error = RuntimeError("db down")
    harness.store.restore_error = ConnectionError("redis down")

    with pytest.raises(RuntimeError, match="db down"):
        _poll(harness)

    assert harness.store.released == [harness.store.acquired[0][:2]]


def test_poll_denies_when_the_approving_account_is_gone() -> None:
    harness = _approved_harness()
    harness.accounts.account = replace(harness.accounts.account, id="account-2")

    with pytest.raises(AccessDeniedError):
        _poll(harness)

    assert harness.tokens.account_issues == 0
    assert harness.store.restored == []
    with pytest.raises(ExpiredTokenError):
        _poll(harness)


def test_external_poll_rejects_email_that_became_a_dify_account() -> None:
    harness = _approved_harness(external=True)
    harness.accounts.active_external_emails.add("external@example.com")

    with pytest.raises(AccessDeniedError):
        _poll(harness)

    assert harness.tokens.external_issues == 0
    assert harness.store.restored == []


def test_legacy_approved_state_returns_its_stored_payload() -> None:
    harness = _harness()
    legacy_payload: PollPayload = {
        "token": "dfoa_minted-by-an-old-worker",
        "expires_at": "2030-01-01T00:00:00+00:00",
        "subject_type": "account",
        "account": {"id": "account-1"},
        "workspaces": [],
        "default_workspace_id": None,
        "token_id": "token-0",
    }
    harness.store.states["ABCD-EFGH"] = (
        "device-1",
        FakeState(status=DeviceFlowStatus.APPROVED, token_id="transition:a:token-0", poll_payload=legacy_payload),
    )

    assert _poll(harness) == legacy_payload

    assert _issues(harness) == 0
    assert harness.store.acquired == []
    with pytest.raises(ExpiredTokenError):
        _poll(harness)


def test_poll_refuses_a_subject_type_it_cannot_mint(caplog: pytest.LogCaptureFixture) -> None:
    harness = _approved_harness()
    approval = harness.store.approval
    assert approval is not None
    approval["subject_type"] = SubjectType.RESOURCE_ACCESS

    with caplog.at_level(logging.ERROR), pytest.raises(ExpiredTokenError):
        _poll(harness)

    assert "resource_access" in caplog.text
    assert _issues(harness) == 0
    assert harness.store.acquired == []


@pytest.mark.parametrize("external", [False, True], ids=["account", "external"])
def test_audits_name_the_token_only_once_it_is_issued(external: bool, caplog: pytest.LogCaptureFixture) -> None:
    harness = _harness()

    with caplog.at_level(logging.WARNING):
        _approve(harness, external=external)
        _poll(harness, poll_ip="192.0.2.10")

    events = {record.__dict__.get("event"): record.__dict__ for record in caplog.records}
    approved = events["oauth.device_flow_approved"]
    issued = events["oauth.device_token_issued"]
    assert "token_id" not in approved
    assert approved["subject_type"] == ("external_sso" if external else "account")
    assert issued["token_id"] == "token-1"
    assert issued["expires_at"] == "2030-01-01T00:00:00+00:00"
    assert issued["account_id"] == (None if external else "account-1")
    assert issued["tenant_id"] == (None if external else "workspace-1")
    assert issued["scopes"] == sorted(SubjectType.EXTERNAL_SSO.scopes if external else SubjectType.ACCOUNT.scopes)
    cross_ip = next(record for record in caplog.records if "cross_ip_poll" in record.getMessage())
    assert cross_ip.__dict__["token_id"] == "token-1"


@pytest.mark.parametrize("external", [False, True], ids=["account", "external"])
@pytest.mark.parametrize(
    ("installation_id", "expected_key"),
    [("abcd1234", "install:abcd1234"), ("", "CLI")],
    ids=["install", "legacy"],
)
def test_poll_mints_on_the_device_key_from_the_code_request(
    external: bool, installation_id: str, expected_key: str
) -> None:
    harness = _harness()
    harness.store.states["ABCD-EFGH"] = ("device-1", FakeState(installation_id=installation_id))
    _approve(harness, external=external)

    _poll(harness)

    assert harness.tokens.device_keys == [expected_key]


@pytest.mark.parametrize("external", [False, True], ids=["account", "external"])
def test_rotation_guard_follows_the_device_key_not_the_label(external: bool) -> None:
    harness = _harness()
    attempts = [
        FakeState(device_label="host", installation_id="aaaa1111"),
        FakeState(device_label="renamed-host", installation_id="aaaa1111"),
        FakeState(device_label="host", installation_id="bbbb2222"),
    ]
    for attempt in attempts:
        harness.store.states["ABCD-EFGH"] = ("device-1", attempt)
        _approve(harness, external=external)
        _poll(harness)

    first, renamed, other_install = (guard_id for guard_id, _owner, _ttl in harness.store.acquired)
    assert first == renamed
    assert first != other_install


def test_rotation_guard_is_shared_across_device_codes_for_the_same_token_identity() -> None:
    harness = _harness()
    for device_code in ("device-1", "device-2"):
        harness.store.states["ABCD-EFGH"] = (device_code, FakeState())
        _approve(harness, external=False)
        harness.service.poll(device_code=device_code, poll_ip="127.0.0.1")

    assert len(harness.store.acquired) == 2
    assert harness.store.acquired[0][0] == harness.store.acquired[1][0]
    assert harness.store.acquired[0][1] != harness.store.acquired[1][1]
    assert all(ttl == 60 for _, _, ttl in harness.store.acquired)


@pytest.mark.parametrize("external", [False, True], ids=["account", "external"])
@pytest.mark.parametrize("error", [StateNotFoundError("expired"), InvalidTransitionError("already approved")])
def test_approval_reports_state_lost_when_the_transition_races(external: bool, error: Exception) -> None:
    harness = _harness()
    harness.store.approve_error = error

    with pytest.raises(DeviceStateLostError):
        _approve(harness, external=external)

    assert len(harness.sso.reserved_nonces) == (1 if external else 0)
    assert harness.sso.released_nonces == harness.sso.reserved_nonces
    assert _issues(harness) == 0


@pytest.mark.parametrize("external", [False, True], ids=["account", "external"])
@pytest.mark.parametrize(
    ("confirmation", "confirm_error", "expected_error", "nonce_released"),
    [
        (ApprovalTransitionConfirmation.PUBLISHED, None, None, False),
        (ApprovalTransitionConfirmation.NOT_PUBLISHED, None, ConnectionError, True),
        (ApprovalTransitionConfirmation.UNKNOWN, None, ApprovalOutcomeUnknownError, False),
        (None, ConnectionError("confirmation unavailable"), ApprovalOutcomeUnknownError, False),
    ],
    ids=["published", "not-published", "unknown", "confirm-failed"],
)
def test_ambiguous_publish_follows_the_confirmed_outcome(
    external: bool,
    confirmation: ApprovalTransitionConfirmation | None,
    confirm_error: Exception | None,
    expected_error: type[Exception] | None,
    nonce_released: bool,
) -> None:
    harness = _harness()
    harness.store.approve_error = ConnectionError("response lost")
    harness.store.confirmation = confirmation
    harness.store.confirm_error = confirm_error

    if expected_error is None:
        assert _approve(harness, external=external).status == "approved"
    else:
        with pytest.raises(expected_error):
            _approve(harness, external=external)

    assert harness.sso.released_nonces == (harness.sso.reserved_nonces if external and nonce_released else [])
    assert _issues(harness) == 0


@pytest.mark.parametrize(
    "rejection", ["missing-grant", "invalid-grant", "rate-limit", "user-code", "identity", "replay"]
)
def test_external_approval_rejections_do_not_issue_tokens(rejection: str) -> None:
    harness = _harness()
    errors = {
        "missing-grant": InvalidApprovalSessionError,
        "invalid-grant": InvalidApprovalSessionError,
        "rate-limit": ExternalApprovalRateLimitError,
        "user-code": ExternalUserCodeMismatchError,
        "identity": ExternalIdentityConflictError,
        "replay": ApprovalSessionConsumedError,
    }
    harness.limiter.limited = rejection == "rate-limit"
    harness.sso.approval_nonce_available = rejection != "replay"
    if rejection == "identity":
        harness.accounts.active_external_emails.add(harness.sso.grant.subject_email)

    with (
        patch.object(
            harness.sso,
            "verify_approval_grant",
            return_value=harness.sso.grant,
            side_effect=InvalidApprovalSessionError if rejection == "invalid-grant" else None,
        ),
        pytest.raises(errors[rejection]),
    ):
        harness.service.approve_external(
            DeviceRequestContext("request-1", None),
            approval_grant="" if rejection == "missing-grant" else "grant",
            csrf_token="csrf-token",
            user_code="OTHER-CODE" if rejection == "user-code" else "ABCD-EFGH",
        )

    assert harness.tokens.external_issues == 0
    assert harness.store.approval is None
    assert harness.store.acquired == []
    assert len(harness.sso.reserved_nonces) == (1 if rejection == "replay" else 0)
    assert harness.sso.released_nonces == []
    if rejection == "rate-limit":
        assert harness.limiter.recorded == []


@pytest.mark.parametrize(
    "rejection",
    ["missing-assertion", "invalid-assertion", "replayed-assertion", "expired-code", "resolved-code", "identity"],
)
def test_sso_completion_rejections_never_mint_approval_grant(rejection: str) -> None:
    harness = _harness()
    harness.sso.assertion_nonce_available = rejection != "replayed-assertion"
    if rejection == "expired-code":
        harness.store.states.clear()
    elif rejection == "resolved-code":
        harness.store.states["ABCD-EFGH"][1].status = DeviceFlowStatus.APPROVED
    elif rejection == "identity":
        harness.accounts.active_external_emails.add(harness.sso.assertion.subject_email)

    with (
        patch.object(
            harness.sso,
            "verify_assertion",
            return_value=harness.sso.assertion,
            side_effect=InvalidSSOAssertionError("invalid signature") if rejection == "invalid-assertion" else None,
        ),
        patch.object(harness.sso, "mint_approval_grant") as mint,
    ):
        result = harness.service.complete_sso(
            DeviceRequestContext("request-1", None),
            inbound_error=None,
            inbound_user_code=None,
            assertion=None if rejection == "missing-assertion" else "signed-assertion",
        )

    assert result.error_code == ("email_belongs_to_dify_account" if rejection == "identity" else "sso_failed")
    assert result.approval_grant is None
    mint.assert_not_called()


def test_sso_completion_preserves_upstream_error_without_consuming_assertion() -> None:
    harness = _harness()
    with patch.object(harness.sso, "verify_assertion") as verify:
        result = harness.service.complete_sso(
            DeviceRequestContext("request-1", None),
            inbound_error="sso_failed",
            inbound_user_code="ABCD-EFGH",
            assertion="signed-assertion",
        )

    assert result.error_code == "sso_failed"
    assert result.user_code == "ABCD-EFGH"
    assert result.approval_grant is None
    verify.assert_not_called()


@pytest.mark.parametrize("status", [None, DeviceFlowStatus.APPROVED, DeviceFlowStatus.DENIED])
def test_sso_initiation_requires_pending_user_code(status: DeviceFlowStatus | None) -> None:
    harness = _harness()
    harness.store.states = {} if status is None else {"ABCD-EFGH": ("device-1", FakeState(status=status))}

    with patch.object(harness.sso, "initiate") as initiate, pytest.raises(InvalidUserCodeError):
        harness.service.initiate_sso(DeviceRequestContext("request-1", None), user_code="ABCD-EFGH")

    initiate.assert_not_called()


def test_sso_initiation_requires_configured_callback_origin() -> None:
    harness = _harness(settings=FakeSettings(sso_base_url=None))

    with patch.object(harness.sso, "initiate") as initiate, pytest.raises(OAuthDeviceSSOConfigurationError):
        harness.service.initiate_sso(DeviceRequestContext("request-1", None), user_code="ABCD-EFGH")

    initiate.assert_not_called()


def test_sso_initiation_rejects_empty_provider_redirect() -> None:
    harness = _harness()

    with patch.object(harness.sso, "initiate", return_value=""), pytest.raises(OAuthDeviceSSOInitiationError):
        harness.service.initiate_sso(DeviceRequestContext("request-1", None), user_code="ABCD-EFGH")


def test_sso_completion_reports_configuration_error_without_grant() -> None:
    harness = _harness(settings=FakeSettings(sso_base_url=None))

    result = harness.service.complete_sso(
        DeviceRequestContext("request-1", None),
        inbound_error=None,
        inbound_user_code=None,
        assertion="signed-assertion",
    )

    assert result.error_code == "sso_failed"
    assert result.user_code == "ABCD-EFGH"
    assert result.approval_grant is None


def test_approval_context_requires_verified_grant() -> None:
    harness = _harness()
    context = DeviceRequestContext("request-1", None)

    with pytest.raises(InvalidApprovalSessionError):
        harness.service.get_approval_context(context, approval_grant="")
    with (
        patch.object(harness.sso, "verify_approval_grant", side_effect=InvalidApprovalSessionError),
        pytest.raises(InvalidApprovalSessionError),
    ):
        harness.service.get_approval_context(context, approval_grant="invalid")

    result = harness.service.get_approval_context(context, approval_grant="valid")
    assert result.subject_email == harness.sso.grant.subject_email
    assert result.subject_issuer == harness.sso.grant.subject_issuer
    assert result.user_code == harness.sso.grant.user_code
    assert result.csrf_token == harness.sso.grant.csrf_token
    assert result.expires_at == harness.sso.grant.expires_at
