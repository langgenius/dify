"""Redis state machine for OAuth device flow.

Deployment contract: the CAS writer must not run alongside the pre-CAS
GET/SETEX writer. Old approve and deny operations can overwrite a terminal
state from this implementation because they do not participate in the same
transition protocol. Drain API workers running the old writer before deploying
this version. The JSON representation remains reader-compatible so pending
device codes can survive that restart.
"""

from __future__ import annotations

import json
import logging
import secrets
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime

from redis_lua_py import Key, cjson, redis, script

from services.oauth_device_contracts import (
    DEVICE_FLOW_TTL_SECONDS,
    ApprovalTransitionConfirmation,
    DeviceFlowStatus,
    InvalidTransitionError,
    PollPayload,
    SlowDownDecision,
    StateNotFoundError,
)

logger = logging.getLogger(__name__)


# ============================================================================
# Redis state machine — device_code + user_code ephemeral state
# ============================================================================


_DEVICE_CODE_KEY_PREFIX = "device_code:"
_USER_CODE_KEY_PREFIX = "user_code:"
DEVICE_CODE_KEY_FMT = _DEVICE_CODE_KEY_PREFIX + "{code}"
USER_CODE_KEY_FMT = _USER_CODE_KEY_PREFIX + "{code}"


# Atomic GET → status-check → DEL(device key). Two concurrent pollers must
# not both observe APPROVED — only the winner gets the plaintext token,
# the loser sees nil and the caller maps that to expired_token. The user-code
# mapping is cleaned up separately so Redis Cluster only sees one script key.
@script
def _consume_on_poll(device_key: Key) -> bytes | None:
    raw = redis.get(device_key)
    if raw is None:
        return None
    try:
        decoded = cjson.decode(raw)
    except Exception:
        return None
    if decoded["status"] == "pending":
        return None
    redis.delete(device_key)
    return raw


# The transition ID makes an approved write idempotent and lets callers
# distinguish a committed write from a connection failure after SETEX.
@script
def _transition(device_key: Key, target: str, transition_marker: str, poll_payload: str, ttl_floor: int) -> int:
    raw = redis.get(device_key)
    if raw is None:
        return 0
    try:
        decoded = cjson.decode(raw)
    except Exception:
        return -2

    if decoded["status"] != "pending":
        if decoded["status"] == target and decoded["token_id"] == transition_marker:
            return 2
        return -1

    decoded["status"] = target
    decoded["token_id"] = transition_marker
    decoded["poll_payload"] = None
    if target == "approved":
        try:
            cjson.decode(poll_payload)
        except Exception:
            return -2

    # cjson loses the distinction between [] and {} when decoding empty tables.
    # Preserve the validated payload JSON verbatim while encoding the state fields.
    encoded: str = cjson.encode(decoded)
    if target == "approved":
        encoded = encoded[:-1] + ',"poll_payload":' + poll_payload + "}"

    ttl = redis.ttl(device_key)
    if ttl < ttl_floor:
        ttl = ttl_floor
    redis.setex(device_key, ttl, encoded)
    return 1


@script
def _release_guard(guard_key: Key, owner_id: str) -> int:
    if redis.get(guard_key) == owner_id:
        return redis.delete(guard_key)
    return 0


APPROVED_TTL_SECONDS_MIN = 60  # plaintext-token lifetime floor

USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXY3456789"  # ambiguous chars dropped
USER_CODE_SEGMENT_LEN = 4
USER_CODE_MAX_CLAIM_ATTEMPTS = 5
_TRANSITION_TOKEN_PREFIX = "transition:"
_LEGACY_APPROVAL_FIELDS = ("subject_email", "account_id", "subject_issuer", "minted_token", "transition_id")


@dataclass
class DeviceFlowState:
    """Ephemeral device state; approved payload is consumed exactly once."""

    user_code: str
    client_id: str
    device_label: str
    status: DeviceFlowStatus
    token_id: str | None = None
    created_at: str = ""
    created_ip: str = ""
    last_poll_at: str = ""
    poll_payload: PollPayload | None = field(default=None)

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, raw: str) -> DeviceFlowState:
        data = json.loads(raw)
        # Device codes live for at most 15 minutes, but tolerate state written
        # by the previous schema during a rolling deployment.
        for field_name in _LEGACY_APPROVAL_FIELDS:
            data.pop(field_name, None)
        if "status" in data:
            data["status"] = DeviceFlowStatus(data["status"])
        return cls(**data)


def _random_device_code() -> str:
    return "dc_" + secrets.token_urlsafe(24)


def _random_user_code_segment() -> str:
    return "".join(secrets.choice(USER_CODE_ALPHABET) for _ in range(USER_CODE_SEGMENT_LEN))


def _random_user_code() -> str:
    return f"{_random_user_code_segment()}-{_random_user_code_segment()}"


class UserCodeExhaustedError(Exception):
    pass


class DeviceFlowRedis:
    def __init__(self, redis_client) -> None:
        self._redis = redis_client

    def start(self, client_id: str, device_label: str, created_ip: str) -> tuple[str, str, int]:
        device_code = _random_device_code()
        user_code = self._claim_user_code(device_code)
        state = DeviceFlowState(
            user_code=user_code,
            client_id=client_id,
            device_label=device_label,
            status=DeviceFlowStatus.PENDING,
            created_at=datetime.now(UTC).isoformat(),
            created_ip=created_ip,
        )
        self._redis.setex(
            DEVICE_CODE_KEY_FMT.format(code=device_code),
            DEVICE_FLOW_TTL_SECONDS,
            state.to_json(),
        )
        return device_code, user_code, DEVICE_FLOW_TTL_SECONDS

    def _claim_user_code(self, device_code: str) -> str:
        for _ in range(USER_CODE_MAX_CLAIM_ATTEMPTS):
            user_code = _random_user_code()
            key = USER_CODE_KEY_FMT.format(code=user_code)
            ok = self._redis.set(key, device_code, nx=True, ex=DEVICE_FLOW_TTL_SECONDS)
            if ok:
                return user_code
        raise UserCodeExhaustedError("could not allocate a unique user_code in 5 attempts")

    def load_by_user_code(self, user_code: str) -> tuple[str, DeviceFlowState] | None:
        raw_dc = self._redis.get(USER_CODE_KEY_FMT.format(code=user_code))
        if not raw_dc:
            return None
        device_code = raw_dc.decode() if isinstance(raw_dc, (bytes, bytearray)) else raw_dc
        state = self._load_state(device_code)
        if state is None:
            return None
        return device_code, state

    def load_by_device_code(self, device_code: str) -> DeviceFlowState | None:
        return self._load_state(device_code)

    def _load_state(self, device_code: str) -> DeviceFlowState | None:
        raw = self._redis.get(DEVICE_CODE_KEY_FMT.format(code=device_code))
        if not raw:
            return None
        text_ = raw.decode() if isinstance(raw, (bytes, bytearray)) else raw
        try:
            return DeviceFlowState.from_json(text_)
        except (ValueError, KeyError):
            logger.exception("device_flow: corrupt state for %s", device_code)
            return None

    def approve(
        self,
        device_code: str,
        transition_id: str,
        token_id: str,
        poll_payload: PollPayload,
    ) -> None:
        self._transition(
            device_code=device_code,
            target=DeviceFlowStatus.APPROVED,
            transition_id=transition_id,
            token_id=token_id,
            poll_payload=poll_payload,
            ttl_floor=APPROVED_TTL_SECONDS_MIN,
        )

    def deny(self, device_code: str, transition_id: str) -> None:
        self._transition(
            device_code=device_code,
            target=DeviceFlowStatus.DENIED,
            transition_id=transition_id,
            token_id="",
            poll_payload=None,
            ttl_floor=1,
        )

    def confirm_approval(
        self,
        device_code: str,
        transition_id: str,
        token_id: str,
    ) -> ApprovalTransitionConfirmation:
        state = self._load_state(device_code)
        if state is None:
            return ApprovalTransitionConfirmation.UNKNOWN
        if state.status is DeviceFlowStatus.APPROVED and state.token_id == self._transition_marker(
            transition_id, token_id
        ):
            return ApprovalTransitionConfirmation.PUBLISHED
        return ApprovalTransitionConfirmation.NOT_PUBLISHED

    def consume_on_poll(self, device_code: str) -> DeviceFlowState | None:
        """Race-safe via Lua EVAL: GET + status-check + DEL execute in a
        single Redis transaction so only one of N concurrent pollers
        observes the APPROVED state. Losers get None, mapped to
        expired_token by the caller.
        """
        raw = _consume_on_poll(self._redis, device_key=DEVICE_CODE_KEY_FMT.format(code=device_code))
        if raw is None:
            return None
        text_ = raw.decode() if isinstance(raw, (bytes, bytearray)) else raw
        try:
            state = DeviceFlowState.from_json(text_)
        except (ValueError, KeyError):
            logger.exception("device_flow: corrupt state on consume %s", device_code)
            return None
        try:
            self._redis.delete(USER_CODE_KEY_FMT.format(code=state.user_code))
        except Exception:
            logger.exception("device_flow: failed to clean consumed user-code mapping")
        return state

    def record_poll(self, device_code: str, interval_seconds: int) -> SlowDownDecision:
        now = time.time()
        key = f"device_code:{device_code}:last_poll"
        prev_raw = self._redis.get(key)
        self._redis.setex(key, DEVICE_FLOW_TTL_SECONDS, str(now))
        if prev_raw is None:
            return SlowDownDecision.OK
        prev_s = prev_raw.decode() if isinstance(prev_raw, (bytes, bytearray)) else prev_raw
        try:
            prev = float(prev_s)
        except ValueError:
            return SlowDownDecision.OK
        if now - prev < interval_seconds:
            return SlowDownDecision.SLOW_DOWN
        return SlowDownDecision.OK

    def try_acquire_approval(self, guard_id: str, owner_id: str, ttl_seconds: int) -> bool:
        return bool(self._redis.set(self._approval_guard_key(guard_id), owner_id, nx=True, ex=ttl_seconds))

    def release_approval(self, guard_id: str, owner_id: str) -> None:
        _release_guard(self._redis, guard_key=self._approval_guard_key(guard_id), owner_id=owner_id)

    def _transition(
        self,
        *,
        device_code: str,
        target: DeviceFlowStatus,
        transition_id: str,
        token_id: str,
        poll_payload: PollPayload | None,
        ttl_floor: int,
    ) -> None:
        result = _transition(
            self._redis,
            device_key=DEVICE_CODE_KEY_FMT.format(code=device_code),
            target=target.value,
            transition_marker=self._transition_marker(transition_id, token_id),
            poll_payload=json.dumps(poll_payload) if poll_payload is not None else "",
            ttl_floor=ttl_floor,
        )
        if result in (0, -2):
            raise StateNotFoundError(device_code)
        if result == -1:
            raise InvalidTransitionError(f"cannot transition device flow to {target.value}")

    @staticmethod
    def _approval_guard_key(guard_id: str) -> str:
        return f"oauth_device:approval_guard:{guard_id}"

    @staticmethod
    def _transition_marker(transition_id: str, token_id: str) -> str:
        return f"{_TRANSITION_TOKEN_PREFIX}{transition_id}:{token_id}"
