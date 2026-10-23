"""Redis state machine for OAuth device flow.

Deployment contract: the CAS writer must not run alongside the pre-CAS
GET/SETEX writer. Old approve and deny operations can overwrite a terminal
state from this implementation because they do not participate in the same
transition protocol. Approved states now carry an approval record instead of a
minted token. Older workers cannot parse it, and an older poller deletes the
state before it fails to parse it, so the login is lost. Drain API workers running an older version before
deploying this one. This reader still accepts states written by older workers,
so pending device codes and already-minted approvals survive that restart.
"""

from __future__ import annotations

import json
import logging
import secrets
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime

from constants.oauth_bearer import SubjectType
from services.oauth_device_contracts import (
    DEVICE_FLOW_TTL_SECONDS,
    AccountApprovalRecord,
    ApprovalTransitionConfirmation,
    DeviceApprovalRecord,
    DeviceFlowStateView,
    DeviceFlowStatus,
    ExternalApprovalRecord,
    InvalidTransitionError,
    PollPayload,
    SlowDownDecision,
    StateNotFoundError,
)

logger = logging.getLogger(__name__)

REDIS_TTL_NO_EXPIRY = -1
REDIS_TTL_MISSING = -2


# ============================================================================
# Redis state machine — device_code + user_code ephemeral state
# ============================================================================


_DEVICE_CODE_KEY_PREFIX = "device_code:"
_USER_CODE_KEY_PREFIX = "user_code:"
DEVICE_CODE_KEY_FMT = _DEVICE_CODE_KEY_PREFIX + "{code}"
USER_CODE_KEY_FMT = _USER_CODE_KEY_PREFIX + "{code}"

# Atomic GET → status-check → TTL → DEL(device key). Two concurrent pollers
# must not both observe APPROVED — only the winner claims the approval, the
# loser sees nil and the caller maps that to expired_token. The TTL lets the
# winner put the state back if minting fails. The user-code mapping is cleaned
# up separately so Redis Cluster only sees one script key.
_CONSUME_ON_POLL_LUA = """
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local ok, decoded = pcall(cjson.decode, raw)
if not ok then return nil end
if decoded.status == 'pending' then return nil end
local ttl = redis.call('TTL', KEYS[1])
redis.call('DEL', KEYS[1])
return {raw, ttl}
"""

# The transition ID makes an approved write idempotent and lets callers
# distinguish a committed write from a connection failure after SETEX.
_TRANSITION_LUA = """
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, decoded = pcall(cjson.decode, raw)
if not ok then return -2 end

local target = ARGV[1]
local transition_marker = ARGV[2]
if decoded.status ~= 'pending' then
    if decoded.status == target and decoded.token_id == transition_marker then
        return 2
    end
    return -1
end

decoded.status = target
decoded.token_id = transition_marker
decoded.poll_payload = nil
decoded.approval = nil
if target == 'approved' then
    local approval_ok = pcall(cjson.decode, ARGV[3])
    if not approval_ok then return -2 end
end

-- cjson loses the distinction between [] and {} when decoding empty tables.
-- Preserve the validated approval JSON verbatim while encoding the state fields.
local encoded = cjson.encode(decoded)
if target == 'approved' then
    encoded = string.sub(encoded, 1, -2) .. ',"approval":' .. ARGV[3] .. '}'
end

local ttl = redis.call('TTL', KEYS[1])
local floor = tonumber(ARGV[4])
if ttl < floor then ttl = floor end
redis.call('SETEX', KEYS[1], ttl, encoded)
return 1
"""

_RELEASE_GUARD_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
"""

APPROVED_TTL_SECONDS_MIN = 60  # approved-state lifetime floor

USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXY3456789"  # ambiguous chars dropped
USER_CODE_SEGMENT_LEN = 4
USER_CODE_MAX_CLAIM_ATTEMPTS = 5
_TRANSITION_TOKEN_PREFIX = "transition:"
_LEGACY_APPROVAL_FIELDS = ("subject_email", "account_id", "subject_issuer", "minted_token", "transition_id")


def _parse_account_approval(data: dict[str, object]) -> AccountApprovalRecord:
    account_id = data["account_id"]
    if account_id is None:
        raise ValueError("account approval has no account_id")
    workspace_id = data["workspace_id"]
    if workspace_id is None:
        raise ValueError("account approval has no workspace_id")
    return AccountApprovalRecord(
        account_id=str(account_id),
        workspace_id=str(workspace_id),
        subject_email=str(data["subject_email"]),
        subject_issuer=str(data["subject_issuer"]),
    )


def _parse_external_approval(data: dict[str, object]) -> ExternalApprovalRecord:
    return ExternalApprovalRecord(
        subject_email=str(data["subject_email"]),
        subject_issuer=str(data["subject_issuer"]),
    )


_APPROVAL_PARSERS: dict[SubjectType, Callable[[dict[str, object]], DeviceApprovalRecord]] = {
    SubjectType.ACCOUNT: _parse_account_approval,
    SubjectType.EXTERNAL_SSO: _parse_external_approval,
}


def _parse_approval(data: dict[str, object]) -> DeviceApprovalRecord:
    """Raises KeyError or ValueError for a record this version cannot honour."""
    subject_type = SubjectType(str(data["subject_type"]))
    parser = _APPROVAL_PARSERS.get(subject_type)
    if parser is None:
        raise ValueError(f"device flow cannot approve subject type {subject_type}")
    return parser(data)


@dataclass
class DeviceFlowState:
    """Ephemeral device state; an approval is claimed by exactly one poll."""

    user_code: str
    client_id: str
    device_label: str
    status: DeviceFlowStatus
    token_id: str | None = None
    created_at: str = ""
    created_ip: str = ""
    last_poll_at: str = ""
    # Approved states written before approval records carry the minted payload here.
    poll_payload: PollPayload | None = field(default=None)
    approval: DeviceApprovalRecord | None = None

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
        if data.get("approval") is not None:
            data["approval"] = _parse_approval(data["approval"])
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
        self._consume_on_poll_script = redis_client.register_script(_CONSUME_ON_POLL_LUA)
        self._transition_script = redis_client.register_script(_TRANSITION_LUA)
        self._release_guard_script = redis_client.register_script(_RELEASE_GUARD_LUA)

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

    def approve(self, device_code: str, transition_id: str, approval: DeviceApprovalRecord) -> None:
        self._transition(
            device_code=device_code,
            target=DeviceFlowStatus.APPROVED,
            transition_id=transition_id,
            approval=approval,
            ttl_floor=APPROVED_TTL_SECONDS_MIN,
        )

    def deny(self, device_code: str, transition_id: str) -> None:
        self._transition(
            device_code=device_code,
            target=DeviceFlowStatus.DENIED,
            transition_id=transition_id,
            approval=None,
            ttl_floor=1,
        )

    def confirm_approval(self, device_code: str, transition_id: str) -> ApprovalTransitionConfirmation:
        state = self._load_state(device_code)
        if state is None:
            return ApprovalTransitionConfirmation.UNKNOWN
        if state.status is DeviceFlowStatus.APPROVED and state.token_id == self._transition_marker(transition_id):
            return ApprovalTransitionConfirmation.PUBLISHED
        return ApprovalTransitionConfirmation.NOT_PUBLISHED

    def consume_on_poll(self, device_code: str) -> tuple[DeviceFlowState, int] | None:
        """Race-safe via Lua EVAL: GET + status-check + DEL execute in a
        single Redis transaction so only one of N concurrent pollers
        observes the APPROVED state. Losers get None, mapped to
        expired_token by the caller. The winner also gets the seconds the
        state had left, for ``restore``.
        """
        consumed = self._consume_on_poll_script(
            keys=[DEVICE_CODE_KEY_FMT.format(code=device_code)],
        )
        if consumed is None:
            return None
        raw, ttl = consumed
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
        ttl = int(ttl)
        if ttl in (REDIS_TTL_NO_EXPIRY, REDIS_TTL_MISSING):
            return state, 0
        return state, ttl

    def restore(self, device_code: str, state: DeviceFlowStateView, ttl_seconds: int) -> bool:
        """Put a consumed state back for the time it had left. Never overwrites a state that exists again."""
        restored = self._redis.set(
            DEVICE_CODE_KEY_FMT.format(code=device_code), state.to_json(), nx=True, ex=ttl_seconds
        )
        if not restored:
            return False
        self._redis.set(USER_CODE_KEY_FMT.format(code=state.user_code), device_code, nx=True, ex=ttl_seconds)
        return True

    def remaining_seconds(self, device_code: str) -> int | None:
        ttl = int(self._redis.ttl(DEVICE_CODE_KEY_FMT.format(code=device_code)))
        if ttl == REDIS_TTL_MISSING:
            return None
        if ttl == REDIS_TTL_NO_EXPIRY:
            logger.error("device_code %s has no expiry; treating as invalid", device_code)
            return None
        return ttl

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
        self._release_guard_script(
            keys=[self._approval_guard_key(guard_id)],
            args=[owner_id],
        )

    def _transition(
        self,
        *,
        device_code: str,
        target: DeviceFlowStatus,
        transition_id: str,
        approval: DeviceApprovalRecord | None,
        ttl_floor: int,
    ) -> None:
        result = int(
            self._transition_script(
                keys=[DEVICE_CODE_KEY_FMT.format(code=device_code)],
                args=[
                    target.value,
                    self._transition_marker(transition_id),
                    json.dumps(asdict(approval)) if approval is not None else "",
                    ttl_floor,
                ],
            )
        )
        if result in (0, -2):
            raise StateNotFoundError(device_code)
        if result == -1:
            raise InvalidTransitionError(f"cannot transition device flow to {target.value}")

    @staticmethod
    def _approval_guard_key(guard_id: str) -> str:
        return f"oauth_device:approval_guard:{guard_id}"

    @staticmethod
    def _transition_marker(transition_id: str) -> str:
        return f"{_TRANSITION_TOKEN_PREFIX}{transition_id}"
