import json
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import pytest

from constants.oauth_bearer import SubjectType
from services.oauth_device_contracts import (
    ApprovalTransitionConfirmation,
    DeviceApprovalRecord,
    DeviceFlowStatus,
    device_key_for,
)
from services.oauth_device_flow import DeviceFlowRedis, DeviceFlowState

_CONSUME_RETURN = "return {raw, ttl}"
_APPROVAL: DeviceApprovalRecord = {
    "subject_type": SubjectType.ACCOUNT,
    "account_id": "account-1",
    "workspace_id": "workspace-1",
    "subject_email": "ada@example.com",
    "subject_issuer": "dify:account",
}


@dataclass
class _Redis:
    response: str
    ttl_seconds: int = 900
    set_result: bool = True
    delete_error: Exception | None = None
    deleted: list[str] = field(default_factory=list)
    script_sources: list[str] = field(default_factory=list)
    script_calls: list[tuple[str, tuple[str, ...], tuple[object, ...]]] = field(default_factory=list)
    written: dict[str, str] = field(default_factory=dict)
    set_calls: list[tuple[str, str, int]] = field(default_factory=list)

    def setex(self, name: str, time: int, value: str) -> None:
        _ = time
        self.written[name] = value

    def set(self, name: str, value: str, *, nx: bool, ex: int) -> bool:
        assert nx
        self.set_calls.append((name, value, ex))
        return self.set_result

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
        status=DeviceFlowStatus.APPROVED,
        token_id="transition:approve-1",
        approval=_APPROVAL.copy(),
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


@pytest.mark.parametrize("redis_ttl", [-1, -2])
def test_consume_on_poll_reports_no_lifetime_left_for_a_missing_ttl(redis_ttl: int) -> None:
    redis = _Redis(response=_approved_state().to_json(), ttl_seconds=redis_ttl)

    result = DeviceFlowRedis(redis).consume_on_poll("device-1")

    assert result is not None
    assert result[1] == 0


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
    assert json.loads(str(args[2])) == _APPROVAL
    assert "token" not in json.loads(str(args[2]))

    approved = _approved_state()
    serialized = approved.to_json()
    assert "dfoa_" not in serialized
    assert json.loads(serialized)["approval"] == _APPROVAL
    assert DeviceFlowState.from_json(serialized).approval == _APPROVAL


def test_confirm_approval_marker_has_no_token_id() -> None:
    store = DeviceFlowRedis(_Redis(response=_approved_state().to_json()))

    assert store.confirm_approval("device-1", "approve-1") is ApprovalTransitionConfirmation.PUBLISHED
    assert store.confirm_approval("device-1", "approve-2") is ApprovalTransitionConfirmation.NOT_PUBLISHED


def test_restore_puts_state_back_with_its_remaining_ttl() -> None:
    redis = _Redis(response="")
    state = _approved_state()

    assert DeviceFlowRedis(redis).restore("device-1", state, 312) is True

    assert redis.set_calls == [
        ("device_code:device-1", state.to_json(), 312),
        ("user_code:ABCD-EFGH", "device-1", 312),
    ]


def test_restore_never_extends_a_code_past_its_original_expiry() -> None:
    redis = _Redis(response="")

    DeviceFlowRedis(redis).restore("device-1", _approved_state(), 1)

    assert [ttl for _name, _value, ttl in redis.set_calls] == [1, 1]


def test_restore_does_not_overwrite_a_newer_state() -> None:
    redis = _Redis(response="", set_result=False)

    assert DeviceFlowRedis(redis).restore("device-1", _approved_state(), 312) is False

    assert [name for name, _value, _ttl in redis.set_calls] == ["device_code:device-1"]


def test_remaining_seconds_returns_the_redis_ttl() -> None:
    assert DeviceFlowRedis(_Redis(response="", ttl_seconds=312)).remaining_seconds("device-1") == 312


def test_remaining_seconds_is_none_when_the_key_is_gone(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.ERROR):
        assert DeviceFlowRedis(_Redis(response="", ttl_seconds=-2)).remaining_seconds("device-1") is None

    assert caplog.text == ""


def test_remaining_seconds_logs_and_is_none_when_the_key_has_no_expiry(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.ERROR):
        assert DeviceFlowRedis(_Redis(response="", ttl_seconds=-1)).remaining_seconds("device-1") is None

    assert "no expiry" in caplog.text


def test_reader_tolerates_old_approved_state_with_poll_payload() -> None:
    legacy = {
        "user_code": "ABCD-EFGH",
        "client_id": "difyctl",
        "device_label": "CLI",
        "status": "approved",
        "token_id": "transition:approve-1:token-1",
        "created_at": "",
        "created_ip": "127.0.0.1",
        "last_poll_at": "",
        "poll_payload": {"token": "dfoa_legacy", "token_id": "token-1"},
    }

    state = DeviceFlowRedis(_Redis(response=json.dumps(legacy))).load_by_device_code("device-1")

    assert state is not None
    assert state.approval is None
    assert state.installation_id == ""
    assert state.poll_payload == legacy["poll_payload"]


@pytest.mark.parametrize(
    "approval",
    [
        {**_APPROVAL, "subject_type": "robot"},
        {**_APPROVAL, "subject_type": SubjectType.RESOURCE_ACCESS},
        {key: value for key, value in _APPROVAL.items() if key != "subject_email"},
        {**_APPROVAL, "account_id": None},
        {**_APPROVAL, "workspace_id": None},
    ],
    ids=[
        "unknown-subject-type",
        "unmintable-subject-type",
        "missing-field",
        "account-without-id",
        "account-without-workspace",
    ],
)
def test_reader_rejects_an_approval_it_cannot_honour(
    approval: dict[str, object], caplog: pytest.LogCaptureFixture
) -> None:
    raw = json.loads(_approved_state().to_json())
    raw["approval"] = approval
    store = DeviceFlowRedis(_Redis(response=json.dumps(raw)))

    with caplog.at_level(logging.ERROR):
        assert store.load_by_device_code("device-1") is None
        assert store.consume_on_poll("device-1") is None

    assert "corrupt state" in caplog.text


@pytest.mark.parametrize(
    "approval",
    [
        {
            "subject_type": SubjectType.EXTERNAL_SSO,
            "account_id": None,
            "workspace_id": None,
            "subject_email": "external@example.com",
            "subject_issuer": "https://idp.example",
        },
        _APPROVAL,
    ],
    ids=["external", "account"],
)
def test_reader_round_trips_the_approvals_it_writes(approval: DeviceApprovalRecord) -> None:
    state = _approved_state()
    state.approval = approval

    loaded = DeviceFlowRedis(_Redis(response=state.to_json())).load_by_device_code("device-1")

    assert loaded is not None
    assert loaded.approval == approval


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
        status=DeviceFlowStatus.APPROVED,
        token_id="transition:approve-1",
        approval=_APPROVAL.copy(),
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


def test_device_key_prefers_installation_id() -> None:
    assert device_key_for(installation_id="abcd1234", device_label="host") == "install:abcd1234"
    assert device_key_for(installation_id="", device_label="host") == "host"


@pytest.mark.parametrize("installation_id", ["abcd1234", ""], ids=["install", "legacy"])
def test_start_stores_the_installation_id_in_pending_state(installation_id: str) -> None:
    redis = _Redis(response="")

    device_code, _user_code, _ttl = DeviceFlowRedis(redis).start(
        client_id="difyctl",
        device_label="CLI",
        installation_id=installation_id,
        created_ip="127.0.0.1",
    )

    state = DeviceFlowState.from_json(redis.written[f"device_code:{device_code}"])
    assert state.installation_id == installation_id
    assert state.device_label == "CLI"


def test_state_round_trips_installation_id_and_reads_old_states() -> None:
    state = DeviceFlowState(
        user_code="ABCD-EFGH",
        client_id="difyctl",
        device_label="CLI",
        status=DeviceFlowStatus.PENDING,
        installation_id="abcd1234",
    )
    assert DeviceFlowState.from_json(state.to_json()).installation_id == "abcd1234"

    old = DeviceFlowState.from_json('{"user_code":"A","client_id":"difyctl","device_label":"h","status":"pending"}')
    assert old.installation_id == ""
