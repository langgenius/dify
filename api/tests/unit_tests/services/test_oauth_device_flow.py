import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from services.oauth_device_contracts import (
    AccountApprovalRecord,
    ApprovalTransitionConfirmation,
    DeviceFlowStatus,
)
from services.oauth_device_flow import DeviceFlowRedis, DeviceFlowState

_CONSUME_RETURN = "return {raw, ttl}"
_APPROVAL = AccountApprovalRecord(
    account_id="account-1",
    workspace_id="workspace-1",
    subject_email="ada@example.com",
    subject_issuer="dify:account",
)
_APPROVAL_JSON = {
    "subject_type": "account",
    "account_id": "account-1",
    "workspace_id": "workspace-1",
    "subject_email": "ada@example.com",
    "subject_issuer": "dify:account",
}


@dataclass
class _Redis:
    response: str
    ttl_seconds: int = 900
    delete_error: Exception | None = None
    deleted: list[str] = field(default_factory=list)
    script_sources: list[str] = field(default_factory=list)
    script_calls: list[tuple[str, tuple[str, ...], tuple[object, ...]]] = field(default_factory=list)

    def set(self, name: str, value: str, *, nx: bool, ex: int) -> bool:
        _ = (name, value, nx, ex)
        return True

    def delete(self, name: str) -> None:
        if self.delete_error is not None:
            raise self.delete_error
        self.deleted.append(name)

    def get(self, _name: str) -> str:
        return self.response

    def ttl(self, _name: str) -> int:
        return self.ttl_seconds

    def register_script(self, script: str) -> Callable[..., object]:
        self.script_sources.append(script)

        def execute(*, keys: Sequence[str], args: Sequence[object] = ()) -> object:
            self.script_calls.append((script, tuple(keys), tuple(args or ())))
            if _CONSUME_RETURN in script:
                return [self.response, self.ttl_seconds]
            return 1

        return execute


def _approved_state() -> DeviceFlowState:
    return DeviceFlowState(
        user_code="ABCD-EFGH",
        client_id="difyctl",
        device_label="CLI",
        installation_id=None,
        status=DeviceFlowStatus.APPROVED,
        token_id="transition:approve-1",
        approval=_APPROVAL,
    )


def test_consume_on_poll_uses_one_cluster_safe_script_key() -> None:
    redis = _Redis(response=_approved_state().to_json(), ttl_seconds=312)
    store = DeviceFlowRedis(redis)

    result = store.consume_on_poll("device-1")

    assert result is not None
    state, ttl = result
    assert state.user_code == "ABCD-EFGH"
    assert ttl == 312
    consume_script = next(source for source in redis.script_sources if _CONSUME_RETURN in source)
    assert "KEYS[2]" not in consume_script
    assert consume_script.index("'TTL'") < consume_script.index("'DEL'")
    assert [(keys, args) for source, keys, args in redis.script_calls if source == consume_script] == [
        (("device_code:device-1",), ())
    ]
    assert redis.deleted == ["user_code:ABCD-EFGH"]


def test_user_code_cleanup_failure_does_not_lose_consumed_state() -> None:
    redis = _Redis(response=_approved_state().to_json(), delete_error=ConnectionError("redis unavailable"))

    result = DeviceFlowRedis(redis).consume_on_poll("device-1")

    assert result is not None
    assert result[0].user_code == "ABCD-EFGH"


def test_approve_and_deny_share_atomic_pending_transition_script() -> None:
    redis = _Redis(response="")
    store = DeviceFlowRedis(redis)

    store.approve("device-1", "approve-1", _APPROVAL)
    store.deny("device-2", "deny-1")

    transition_script = next(source for source in redis.script_sources if "decoded.status ~= 'pending'" in source)
    transition_calls = [(keys, args) for source, keys, args in redis.script_calls if source == transition_script]
    assert "redis.call('SETEX'" in transition_script
    assert "decoded.transition_id" not in transition_script
    assert [args[0] for _, args in transition_calls] == ["approved", "denied"]
    assert [args[1] for _, args in transition_calls] == ["transition:approve-1", "transition:deny-1"]
    assert [keys for keys, _ in transition_calls] == [("device_code:device-1",), ("device_code:device-2",)]


def test_approved_state_carries_approval_and_no_plaintext() -> None:
    redis = _Redis(response="")

    DeviceFlowRedis(redis).approve("device-1", "approve-1", _APPROVAL)

    transition_script = next(source for source in redis.script_sources if "decoded.status ~= 'pending'" in source)
    assert """',"approval":' .. ARGV[3]""" in transition_script
    assert 'poll_payload":' not in transition_script
    _keys, args = next((keys, args) for source, keys, args in redis.script_calls if source == transition_script)
    assert json.loads(str(args[2])) == _APPROVAL_JSON
    assert "token" not in json.loads(str(args[2]))

    approved = _approved_state()
    serialized = approved.to_json()
    assert "dfoa_" not in serialized
    assert json.loads(serialized)["approval"] == _APPROVAL_JSON
    assert DeviceFlowState.from_json(serialized).approval == _APPROVAL


def test_confirm_approval_marker_has_no_token_id() -> None:
    store = DeviceFlowRedis(_Redis(response=_approved_state().to_json()))

    assert store.confirm_approval("device-1", "approve-1") is ApprovalTransitionConfirmation.PUBLISHED
    assert store.confirm_approval("device-1", "approve-2") is ApprovalTransitionConfirmation.NOT_PUBLISHED


def test_approval_guard_release_compares_owner_before_delete() -> None:
    redis = _Redis(response="")
    store = DeviceFlowRedis(redis)

    assert store.try_acquire_approval("rotation-1", "owner-1", 900) is True
    store.release_approval("rotation-1", "owner-1")

    release_script = next(source for source in redis.script_sources if "ARGV[1]" in source and "DEL" in source)
    assert "redis.call('GET', KEYS[1]) == ARGV[1]" in release_script
    assert redis.script_calls[-1][1:] == (("oauth_device:approval_guard:rotation-1",), ("owner-1",))


def test_transition_marker_does_not_add_a_top_level_state_field() -> None:
    serialized = DeviceFlowState(
        user_code="ABCD-EFGH",
        client_id="difyctl",
        device_label="CLI",
        installation_id=None,
        status=DeviceFlowStatus.APPROVED,
        token_id="transition:approve-1",
        approval=_APPROVAL,
    ).to_json()
    state_fields = {
        "user_code",
        "client_id",
        "device_label",
        "status",
        "token_id",
        "created_at",
        "created_ip",
        "last_poll_at",
        "poll_payload",
        "installation_id",
        "approval",
    }

    assert set(json.loads(serialized)) <= state_fields


def test_state_reader_tolerates_legacy_approval_fields() -> None:
    legacy = {
        "user_code": "ABCD-EFGH",
        "client_id": "difyctl",
        "device_label": "CLI",
        "status": "pending",
        "subject_email": "legacy@example.com",
        "account_id": "account-1",
        "subject_issuer": "dify:account",
        "minted_token": "legacy-token",
    }

    state = DeviceFlowState.from_json(json.dumps(legacy))

    assert state.status is DeviceFlowStatus.PENDING
