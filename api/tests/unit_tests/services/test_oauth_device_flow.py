import json
from dataclasses import dataclass, field

from services.oauth_device_contracts import ApprovalTransitionConfirmation, DeviceFlowStatus, PollPayload
from services.oauth_device_flow import DeviceFlowRedis, DeviceFlowState


@dataclass
class _Redis:
    response: str
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

    def register_script(self, script: str):
        self.script_sources.append(script)

        def execute(*, keys, args=()):
            self.script_calls.append((script, tuple(keys), tuple(args or ())))
            if "return raw" in script:
                return self.response
            return 1

        return execute


def test_consume_on_poll_uses_one_cluster_safe_script_key() -> None:
    state = DeviceFlowState(
        user_code="ABCD-EFGH",
        client_id="difyctl",
        device_label="CLI",
        status=DeviceFlowStatus.APPROVED,
    )
    redis = _Redis(response=state.to_json())
    store = DeviceFlowRedis(redis)

    result = store.consume_on_poll("device-1")

    assert result is not None
    assert result.user_code == "ABCD-EFGH"
    consume_script = next(source for source in redis.script_sources if "return raw" in source)
    assert "KEYS[2]" not in consume_script
    assert [(keys, args) for source, keys, args in redis.script_calls if source == consume_script] == [
        (("device_code:device-1",), ())
    ]
    assert redis.deleted == ["user_code:ABCD-EFGH"]


def test_user_code_cleanup_failure_does_not_lose_consumed_token() -> None:
    state = DeviceFlowState(
        user_code="ABCD-EFGH",
        client_id="difyctl",
        device_label="CLI",
        status=DeviceFlowStatus.APPROVED,
    )
    redis = _Redis(response=state.to_json(), delete_error=ConnectionError("redis unavailable"))

    result = DeviceFlowRedis(redis).consume_on_poll("device-1")

    assert result is not None
    assert result.user_code == "ABCD-EFGH"


def test_approve_and_deny_share_atomic_pending_transition_script() -> None:
    redis = _Redis(response="")
    store = DeviceFlowRedis(redis)
    poll_payload: PollPayload = {
        "token": "secret-token",
        "expires_at": "2030-01-01T00:00:00+00:00",
        "subject_type": "account",
        "account": {"id": "account-1"},
        "workspaces": [],
        "default_workspace_id": None,
        "token_id": "token-1",
    }

    store.approve("device-1", "approve-1", "token-1", poll_payload)
    store.deny("device-2", "deny-1")

    transition_script = next(source for source in redis.script_sources if "decoded.status ~= 'pending'" in source)
    transition_calls = [(keys, args) for source, keys, args in redis.script_calls if source == transition_script]
    assert "redis.call('SETEX'" in transition_script
    assert "decoded.transition_id" not in transition_script
    assert [args[0] for _, args in transition_calls] == ["approved", "denied"]
    assert transition_calls[0][1][1] == "transition:approve-1:token-1"
    assert [keys for keys, _ in transition_calls] == [("device_code:device-1",), ("device_code:device-2",)]


def test_approval_confirmation_reads_marker_from_existing_token_id_field() -> None:
    state = DeviceFlowState(
        user_code="ABCD-EFGH",
        client_id="difyctl",
        device_label="CLI",
        status=DeviceFlowStatus.APPROVED,
        token_id="transition:approve-1:token-1",
    )
    store = DeviceFlowRedis(_Redis(response=state.to_json()))

    assert store.confirm_approval("device-1", "approve-1", "token-1") is ApprovalTransitionConfirmation.PUBLISHED
    assert store.confirm_approval("device-1", "approve-2", "token-1") is ApprovalTransitionConfirmation.NOT_PUBLISHED


def test_approval_guard_release_compares_owner_before_delete() -> None:
    redis = _Redis(response="")
    store = DeviceFlowRedis(redis)

    assert store.try_acquire_approval("rotation-1", "owner-1", 900) is True
    store.release_approval("rotation-1", "owner-1")

    release_script = next(source for source in redis.script_sources if "ARGV[1]" in source and "DEL" in source)
    assert "redis.call('GET', KEYS[1]) == ARGV[1]" in release_script
    assert redis.script_calls[-1][1:] == (("oauth_device:approval_guard:rotation-1",), ("owner-1",))


def test_approved_state_stores_plaintext_token_only_in_poll_payload() -> None:
    poll_payload: PollPayload = {
        "token": "secret-token",
        "expires_at": "2030-01-01T00:00:00+00:00",
        "subject_type": "account",
        "account": {"id": "account-1"},
        "workspaces": [],
        "default_workspace_id": None,
        "token_id": "token-1",
    }
    serialized = DeviceFlowState(
        user_code="ABCD-EFGH",
        client_id="difyctl",
        device_label="CLI",
        status=DeviceFlowStatus.APPROVED,
        token_id="transition:approve-1:token-1",
        poll_payload=poll_payload,
    ).to_json()
    data = json.loads(serialized)

    assert data["poll_payload"]["token"] == "secret-token"
    assert serialized.count("secret-token") == 1
    assert {"subject_email", "account_id", "subject_issuer", "minted_token", "transition_id"}.isdisjoint(data)


def test_transition_marker_does_not_add_a_top_level_state_field() -> None:
    serialized = DeviceFlowState(
        user_code="ABCD-EFGH",
        client_id="difyctl",
        device_label="CLI",
        status=DeviceFlowStatus.APPROVED,
        token_id="transition:approve-1:token-1",
        poll_payload=None,
    ).to_json()
    old_schema_fields = {
        "user_code",
        "client_id",
        "device_label",
        "status",
        "token_id",
        "created_at",
        "created_ip",
        "last_poll_at",
        "poll_payload",
    }

    assert set(json.loads(serialized)) <= old_schema_fields


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
