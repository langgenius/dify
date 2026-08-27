import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime

import pytest

from machinery.context import RequestContext
from services.entities.account_entities import AccountSnapshot
from services.oauth_device_application_service import OAuthDeviceApplicationService
from services.oauth_device_contracts import (
    ApprovalInProgressError,
    ApprovalOutcomeUnknownError,
    ApprovalTransitionConfirmation,
    DeviceFlowStatus,
    DeviceRequestContext,
    DeviceStateLostError,
    DeviceWorkspace,
    ExternalApprovalCSRFError,
    ExternalApprovalGrant,
    ExternalSubjectAssertion,
    IssuedOAuthToken,
    OAuthDeviceSession,
    OAuthDeviceSessionNotFoundError,
    OAuthDeviceSessionPage,
    OAuthDeviceTokenRotation,
    PollPayload,
    PollTooFastError,
    SlowDownDecision,
    StateNotFoundError,
    UnsupportedClientError,
)


@dataclass
class FakeState:
    client_id: str = "difyctl"
    device_label: str = "CLI"
    status: DeviceFlowStatus = DeviceFlowStatus.PENDING
    token_id: str | None = None
    transition_id: str | None = None
    created_ip: str = "127.0.0.1"
    poll_payload: PollPayload | None = None


@dataclass
class FakeStore:
    states: dict[str, tuple[str, FakeState]] = field(default_factory=dict)
    poll_decision: SlowDownDecision = SlowDownDecision.OK
    approval_acquired: bool = True
    approved_payload: PollPayload | None = None
    approve_error: Exception | None = None
    confirmation: ApprovalTransitionConfirmation | None = None
    confirm_error: Exception | None = None
    acquired: list[tuple[str, str, int]] = field(default_factory=list)
    released: list[tuple[str, str]] = field(default_factory=list)

    def start(self, client_id: str, device_label: str, created_ip: str) -> tuple[str, str, int]:
        _ = (client_id, device_label, created_ip)
        return "device-1", "ABCD-EFGH", 900

    def load_by_user_code(self, user_code: str) -> tuple[str, FakeState] | None:
        return self.states.get(user_code)

    def load_by_device_code(self, device_code: str) -> FakeState | None:
        found = next((state for code, state in self.states.values() if code == device_code), None)
        return found

    def approve(
        self,
        device_code: str,
        transition_id: str,
        token_id: str,
        poll_payload: PollPayload,
    ) -> None:
        if self.approve_error is not None:
            raise self.approve_error
        self.approved_payload = poll_payload
        state = self.load_by_device_code(device_code)
        if state is not None:
            state.status = DeviceFlowStatus.APPROVED
            state.transition_id = transition_id
            state.token_id = token_id
            state.poll_payload = poll_payload

    def deny(self, device_code: str, transition_id: str) -> None:
        state = self.load_by_device_code(device_code)
        if state is not None:
            state.status = DeviceFlowStatus.DENIED
            state.transition_id = transition_id

    def confirm_approval(
        self,
        device_code: str,
        transition_id: str,
        token_id: str,
    ) -> ApprovalTransitionConfirmation:
        if self.confirm_error is not None:
            raise self.confirm_error
        if self.confirmation is not None:
            return self.confirmation
        state = self.load_by_device_code(device_code)
        if state is None:
            return ApprovalTransitionConfirmation.UNKNOWN
        if (
            state.status is DeviceFlowStatus.APPROVED
            and state.transition_id == transition_id
            and state.token_id == token_id
        ):
            return ApprovalTransitionConfirmation.PUBLISHED
        return ApprovalTransitionConfirmation.NOT_PUBLISHED

    def consume_on_poll(self, device_code: str) -> FakeState | None:
        return self.load_by_device_code(device_code)

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
    rollbacks: list[str] = field(default_factory=list)
    sessions: tuple[OAuthDeviceSession, ...] = ()
    revoke_allowed: bool = True

    def issue_account_token(
        self,
        *,
        account: AccountSnapshot,
        workspace_id: str,
        client_id: str,
        device_label: str,
    ) -> IssuedOAuthToken:
        _ = (account, workspace_id, client_id, device_label)
        self.account_issues += 1
        return self.account_token

    def issue_external_token(
        self,
        *,
        subject_email: str,
        subject_issuer: str,
        client_id: str,
        device_label: str,
    ) -> IssuedOAuthToken:
        _ = (subject_email, subject_issuer, client_id, device_label)
        self.external_issues += 1
        return self.external_token

    def rollback_token(self, token: IssuedOAuthToken) -> bool:
        self.rollbacks.append(token.token_id)
        return True

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


def _harness() -> Harness:
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
        settings=FakeSettings(),
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


def test_start_rejects_unknown_client_before_writing_state() -> None:
    harness = _harness()

    with pytest.raises(UnsupportedClientError):
        harness.service.start(
            client_id="unknown",
            device_label="CLI",
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


def test_approve_mints_and_publishes_account_payload() -> None:
    harness = _harness()

    result = harness.service.approve(
        RequestContext("request-1", None, "account-1", "workspace-1"),
        user_code="abcd-efgh",
    )

    assert result.status == "approved"
    assert harness.store.approved_payload is not None
    assert harness.store.approved_payload["default_workspace_id"] == "workspace-1"
    assert harness.store.released == [harness.store.acquired[0][:2]]


def test_approve_does_not_release_guard_owned_by_another_request() -> None:
    harness = _harness()
    harness.store.approval_acquired = False

    with pytest.raises(ApprovalInProgressError):
        harness.service.approve(
            RequestContext("request-1", None, "account-1", "workspace-1"),
            user_code="ABCD-EFGH",
        )

    assert harness.store.released == []


def test_account_approve_rolls_back_rotation_when_state_publish_fails() -> None:
    harness = _harness()
    harness.store.approve_error = StateNotFoundError("device-1")

    with pytest.raises(DeviceStateLostError):
        harness.service.approve(
            RequestContext("request-1", None, "account-1", "workspace-1"),
            user_code="ABCD-EFGH",
        )

    assert harness.tokens.rollbacks == ["token-1"]
    assert harness.store.released == [harness.store.acquired[0][:2]]


def test_account_approve_keeps_token_when_ambiguous_publish_is_confirmed() -> None:
    harness = _harness()
    harness.store.approve_error = ConnectionError("response lost")
    harness.store.confirmation = ApprovalTransitionConfirmation.PUBLISHED

    result = harness.service.approve(
        RequestContext("request-1", None, "account-1", "workspace-1"),
        user_code="ABCD-EFGH",
    )

    assert result.status == "approved"
    assert harness.tokens.rollbacks == []


def test_account_approve_does_not_compensate_unknown_publish_outcome() -> None:
    harness = _harness()
    harness.store.approve_error = ConnectionError("response lost")
    harness.store.confirmation = ApprovalTransitionConfirmation.UNKNOWN

    with pytest.raises(ApprovalOutcomeUnknownError):
        harness.service.approve(
            RequestContext("request-1", None, "account-1", "workspace-1"),
            user_code="ABCD-EFGH",
        )

    assert harness.tokens.rollbacks == []


def test_account_approve_completes_workspace_query_before_rotating_token() -> None:
    harness = _harness()
    harness.workspaces.error = RuntimeError("workspace unavailable")

    with pytest.raises(RuntimeError, match="workspace unavailable"):
        harness.service.approve(
            RequestContext("request-1", None, "account-1", "workspace-1"),
            user_code="ABCD-EFGH",
        )

    assert harness.tokens.account_issues == 0


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


def test_external_approval_rejects_bad_csrf_before_minting() -> None:
    harness = _harness()

    with pytest.raises(ExternalApprovalCSRFError):
        harness.service.approve_external(
            DeviceRequestContext("request-1", None),
            approval_grant="grant",
            csrf_token="wrong",
            user_code="ABCD-EFGH",
        )

    assert harness.tokens.external_issues == 0


def test_external_approval_publishes_external_payload() -> None:
    harness = _harness()

    result = harness.service.approve_external(
        DeviceRequestContext("request-1", None),
        approval_grant="grant",
        csrf_token="csrf-token",
        user_code="abcd-efgh",
    )

    assert result.status == "approved"
    assert harness.store.approved_payload is not None
    assert harness.store.approved_payload["subject_type"] == "external_sso"
    assert harness.store.approved_payload["account"] is None
    assert harness.tokens.external_issues == 1
    assert len(harness.sso.reserved_nonces) == 1
    assert harness.sso.released_nonces == []


def test_external_approval_releases_nonce_and_rolls_back_when_publish_fails() -> None:
    harness = _harness()
    harness.store.approve_error = StateNotFoundError("device-1")

    with pytest.raises(DeviceStateLostError):
        harness.service.approve_external(
            DeviceRequestContext("request-1", None),
            approval_grant="grant",
            csrf_token="csrf-token",
            user_code="ABCD-EFGH",
        )

    assert harness.tokens.rollbacks == ["token-1"]
    assert len(harness.sso.reserved_nonces) == 1
    assert harness.sso.released_nonces == harness.sso.reserved_nonces
    assert harness.store.released == [harness.store.acquired[0][:2]]


def test_external_approval_keeps_recoverable_nonce_when_publish_outcome_is_unknown() -> None:
    harness = _harness()
    harness.store.approve_error = ConnectionError("response lost")
    harness.store.confirmation = ApprovalTransitionConfirmation.UNKNOWN

    with pytest.raises(ApprovalOutcomeUnknownError):
        harness.service.approve_external(
            DeviceRequestContext("request-1", None),
            approval_grant="grant",
            csrf_token="csrf-token",
            user_code="ABCD-EFGH",
        )

    assert harness.tokens.rollbacks == []
    assert len(harness.sso.reserved_nonces) == 1
    assert harness.sso.released_nonces == []


def test_rotation_guard_is_shared_across_device_codes_for_the_same_token_identity() -> None:
    harness = _harness()
    context = RequestContext("request-1", None, "account-1", "workspace-1")
    harness.service.approve(context, user_code="ABCD-EFGH")
    harness.store.states["ABCD-EFGH"] = ("device-2", FakeState())

    harness.service.approve(context, user_code="ABCD-EFGH")

    assert len(harness.store.acquired) == 2
    assert harness.store.acquired[0][0] == harness.store.acquired[1][0]
    assert harness.store.acquired[0][1] != harness.store.acquired[1][1]
    assert all(ttl == 60 for _, _, ttl in harness.store.acquired)
