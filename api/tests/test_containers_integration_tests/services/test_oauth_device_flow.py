"""Device-flow state transitions against real Redis, including Lua JSON encoding."""

import pytest

from constants.oauth_bearer import SubjectType
from extensions.ext_redis import redis_client
from services.oauth_device_contracts import (
    DEVICE_FLOW_TTL_SECONDS,
    ApprovalTransitionConfirmation,
    DeviceApprovalRecord,
    DeviceFlowStatus,
    InvalidTransitionError,
)
from services.oauth_device_flow import DEVICE_CODE_KEY_FMT, USER_CODE_KEY_FMT, DeviceFlowRedis

pytestmark = pytest.mark.usefixtures("flask_app_with_containers")


_SUBJECT_EMAIL = 'user "quoted"\\path\n测试@example.com'
_APPROVALS: list[DeviceApprovalRecord] = [
    {
        "subject_type": SubjectType.ACCOUNT,
        "account_id": "account-1",
        "workspace_id": "workspace-1",
        "subject_email": _SUBJECT_EMAIL,
        "subject_issuer": "dify:account",
    },
    {
        "subject_type": SubjectType.EXTERNAL_SSO,
        "account_id": None,
        "workspace_id": None,
        "subject_email": _SUBJECT_EMAIL,
        "subject_issuer": "https://idp.example",
    },
]


@pytest.mark.parametrize("approval", _APPROVALS, ids=["account", "external"])
def test_approval_record_is_stored_without_a_token_and_claimed_once(approval: DeviceApprovalRecord) -> None:
    store = DeviceFlowRedis(redis_client)
    device_code, user_code, _ = store.start("difyctl", "CLI", "abcd1234", "127.0.0.1")

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
        assert stored.installation_id == "abcd1234"
        assert store.confirm_approval(device_code, "approve-1") is ApprovalTransitionConfirmation.PUBLISHED
        assert store.confirm_approval(device_code, "approve-2") is ApprovalTransitionConfirmation.NOT_PUBLISHED

        consumed = store.consume_on_poll(device_code)
        assert consumed is not None
        state, ttl = consumed
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
    device_code, user_code, _ = store.start("difyctl", "CLI", "", "127.0.0.1")
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
