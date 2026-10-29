"""Device-flow state transitions against real Redis, including Lua JSON encoding."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import redis_client
from models.account import Account
from models.oauth import OpenAPIOAuthAccessToken
from repositories.oauth_device_token_repository import SQLAlchemyOAuthDeviceTokenRepository
from services.entities.account_entities import AccountSnapshot
from services.oauth_device_adapters import EnvironmentOAuthDeviceTokenTTLPolicy, OAuthDeviceTokenIssuanceGateway
from services.oauth_device_contracts import (
    DEVICE_FLOW_TTL_SECONDS,
    AccountApprovalRecord,
    ApprovalTransitionConfirmation,
    DeviceApprovalRecord,
    DeviceFlowStatus,
    ExternalApprovalRecord,
    InvalidTransitionError,
)
from services.oauth_device_flow import DEVICE_CODE_KEY_FMT, USER_CODE_KEY_FMT, DeviceFlowRedis

pytestmark = pytest.mark.usefixtures("flask_app_with_containers")


_SUBJECT_EMAIL = 'user "quoted"\\path\n测试@example.com'
_APPROVALS: list[DeviceApprovalRecord] = [
    AccountApprovalRecord(
        account_id="account-1",
        workspace_id="workspace-1",
        subject_email=_SUBJECT_EMAIL,
        subject_issuer="dify:account",
    ),
    ExternalApprovalRecord(subject_email=_SUBJECT_EMAIL, subject_issuer="https://idp.example"),
]


@pytest.mark.parametrize("approval", _APPROVALS, ids=["account", "external"])
def test_approval_record_is_stored_without_a_token_and_claimed_once(approval: DeviceApprovalRecord) -> None:
    store = DeviceFlowRedis(redis_client)
    device_code, user_code, _ = store.start("difyctl", "CLI", "127.0.0.1")

    try:
        store.approve(device_code, "approve-1", approval)
        # Retrying the same transition must not rewrite or corrupt the approval.
        store.approve(device_code, "approve-1", approval)
        with pytest.raises(InvalidTransitionError):
            store.deny(device_code, "deny-1")

        raw = redis_client.get(DEVICE_CODE_KEY_FMT.format(code=device_code))
        text = raw.decode() if isinstance(raw, bytes) else str(raw)
        assert '"approval"' in text
        assert '"token"' not in text
        assert "dfoa_" not in text
        assert "dfoe_" not in text

        stored = store.load_by_device_code(device_code)
        assert stored is not None
        assert stored.status is DeviceFlowStatus.APPROVED
        assert stored.approval == approval
        assert store.confirm_approval(device_code, "approve-1") is ApprovalTransitionConfirmation.PUBLISHED
        assert store.confirm_approval(device_code, "approve-2") is ApprovalTransitionConfirmation.NOT_PUBLISHED

        consumed = store.consume_on_poll(device_code)
        assert consumed is not None
        state, ttl = consumed
        assert ttl is not None
        assert 0 < ttl <= DEVICE_FLOW_TTL_SECONDS
        assert state.approval == approval
        assert store.consume_on_poll(device_code) is None
        assert store.load_by_user_code(user_code) is None

        assert store.restore(device_code, state, ttl) is True
        assert store.restore(device_code, state, ttl) is False
        restored = store.load_by_user_code(user_code)
        assert restored is not None
        assert restored[0] == device_code
        assert restored[1].status is DeviceFlowStatus.APPROVED
        remaining = store.remaining_seconds(device_code)
        assert remaining is not None
        assert 0 < remaining <= ttl
    finally:
        redis_client.delete(DEVICE_CODE_KEY_FMT.format(code=device_code), USER_CODE_KEY_FMT.format(code=user_code))


def test_denied_state_has_no_approval_and_is_consumed_once() -> None:
    store = DeviceFlowRedis(redis_client)
    device_code, user_code, _ = store.start("difyctl", "CLI", "127.0.0.1")
    try:
        store.deny(device_code, "deny-1")
        store.deny(device_code, "deny-1")

        consumed = store.consume_on_poll(device_code)
        assert consumed is not None
        state, _ttl = consumed
        assert state.status is DeviceFlowStatus.DENIED
        assert state.approval is None
        assert state.poll_payload is None
        assert store.consume_on_poll(device_code) is None
        assert store.load_by_user_code(user_code) is None
    finally:
        redis_client.delete(DEVICE_CODE_KEY_FMT.format(code=device_code), USER_CODE_KEY_FMT.format(code=user_code))


def test_concurrent_logins_respect_cap(db_session_with_containers: Session) -> None:
    max_sessions = 3
    account = Account(name="Cap owner", email=f"cap-{uuid4().hex}@example.com")
    db_session_with_containers.add(account)
    db_session_with_containers.commit()
    snapshot = AccountSnapshot(
        id=account.id,
        name=account.name,
        email=account.email,
        avatar=None,
        is_password_set=False,
        interface_language=None,
        interface_theme=None,
        timezone=None,
        last_login_at=None,
        last_login_ip=None,
        status=account.status.value,
        initialized_at=None,
        created_at=account.created_at,
    )
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    issuer = OAuthDeviceTokenIssuanceGateway(
        tokens=SQLAlchemyOAuthDeviceTokenRepository(
            session_factory=sessions,
            redis=redis_client,
            max_sessions_per_account=max_sessions,
        ),
        ttl_policy=EnvironmentOAuthDeviceTokenTTLPolicy(),
    )

    def login(device_label: str) -> None:
        issuer.issue_account_token(
            account=snapshot,
            workspace_id="workspace-1",
            client_id="difyctl",
            device_label=device_label,
        )

    for index in range(max_sessions - 1):
        login(f"existing-{index}")
    start = Barrier(2)

    def concurrent_login(device_label: str) -> None:
        start.wait(timeout=5)
        login(device_label)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(concurrent_login, f"concurrent-{index}") for index in range(2)]
        for future in futures:
            future.result(timeout=10)

    with sessions() as check:
        live = check.scalar(
            select(func.count())
            .select_from(OpenAPIOAuthAccessToken)
            .where(OpenAPIOAuthAccessToken.account_id == account.id, OpenAPIOAuthAccessToken.revoked_at.is_(None))
        )
    assert live == max_sessions
