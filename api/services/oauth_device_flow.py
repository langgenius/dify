"""Device-flow service layer: Redis state machine, OAuth token mint
(DB upsert + plaintext generation), and TTL policy. Specs:
docs/specs/v1.0/server/{device-flow.md, tokens.md}.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum

from libs.oauth_bearer import TOKEN_CACHE_KEY_FMT
from models.oauth import OAuthAccessToken
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# ============================================================================
# Redis state machine — device_code + user_code ephemeral state
# ============================================================================


_DEVICE_CODE_KEY_PREFIX = "device_code:"
_USER_CODE_KEY_PREFIX = "user_code:"
DEVICE_CODE_KEY_FMT = _DEVICE_CODE_KEY_PREFIX + "{code}"
USER_CODE_KEY_FMT = _USER_CODE_KEY_PREFIX + "{code}"

# Atomic GET → status-check → DEL(both keys). Two concurrent pollers must
# not both observe APPROVED — only the winner gets the plaintext token,
# the loser sees nil and the caller maps that to expired_token.
_CONSUME_ON_POLL_LUA = """
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local ok, decoded = pcall(cjson.decode, raw)
if not ok then return nil end
if decoded.status == 'pending' then return nil end
if decoded.user_code then
    redis.call('DEL', ARGV[1] .. decoded.user_code)
end
redis.call('DEL', KEYS[1])
return raw
"""

DEVICE_FLOW_TTL_SECONDS = 15 * 60  # RFC 8628 expires_in
APPROVED_TTL_SECONDS_MIN = 60      # plaintext-token lifetime floor

USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXY3456789"  # ambiguous chars dropped
USER_CODE_SEGMENT_LEN = 4
USER_CODE_MAX_CLAIM_ATTEMPTS = 5

DEFAULT_POLL_INTERVAL_SECONDS = 5  # RFC 8628 minimum


class DeviceFlowStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"


class SlowDownDecision(StrEnum):
    OK = "ok"
    SLOW_DOWN = "slow_down"


@dataclass
class DeviceFlowState:
    """``minted_token`` is plaintext between approve and the next poll;
    DEL'd after the poll reads it.
    """

    user_code: str
    client_id: str
    device_label: str
    status: DeviceFlowStatus
    subject_email: str | None = None
    account_id: str | None = None
    subject_issuer: str | None = None
    minted_token: str | None = None
    token_id: str | None = None
    created_at: str = ""
    created_ip: str = ""
    last_poll_at: str = ""
    poll_payload: dict | None = field(default=None)

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, raw: str) -> "DeviceFlowState":
        data = json.loads(raw)
        if "status" in data:
            data["status"] = DeviceFlowStatus(data["status"])
        return cls(**data)


def _random_device_code() -> str:
    return "dc_" + secrets.token_urlsafe(24)


def _random_user_code_segment() -> str:
    return "".join(secrets.choice(USER_CODE_ALPHABET) for _ in range(USER_CODE_SEGMENT_LEN))


def _random_user_code() -> str:
    return f"{_random_user_code_segment()}-{_random_user_code_segment()}"


class StateNotFound(Exception):
    pass


class InvalidTransition(Exception):
    pass


class UserCodeExhausted(Exception):
    pass


class DeviceFlowRedis:

    def __init__(self, redis_client) -> None:
        self._redis = redis_client
        self._consume_on_poll_script = redis_client.register_script(_CONSUME_ON_POLL_LUA)

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
        raise UserCodeExhausted("could not allocate a unique user_code in 5 attempts")

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
            logger.error("device_flow: corrupt state for %s", device_code)
            return None

    def approve(
        self,
        device_code: str,
        subject_email: str,
        account_id: str | None,
        minted_token: str,
        token_id: str,
        subject_issuer: str | None = None,
        poll_payload: dict | None = None,
    ) -> None:
        state = self._load_state(device_code)
        if state is None:
            raise StateNotFound(device_code)
        if state.status is not DeviceFlowStatus.PENDING:
            raise InvalidTransition(f"cannot approve {state.status}")

        state.status = DeviceFlowStatus.APPROVED
        state.subject_email = subject_email
        state.account_id = account_id
        state.subject_issuer = subject_issuer
        state.minted_token = minted_token
        state.token_id = token_id
        state.poll_payload = poll_payload

        new_ttl = self._remaining_ttl(device_code, floor=APPROVED_TTL_SECONDS_MIN)
        self._redis.setex(DEVICE_CODE_KEY_FMT.format(code=device_code), new_ttl, state.to_json())

    def deny(self, device_code: str) -> None:
        state = self._load_state(device_code)
        if state is None:
            raise StateNotFound(device_code)
        if state.status is not DeviceFlowStatus.PENDING:
            raise InvalidTransition(f"cannot deny {state.status}")
        state.status = DeviceFlowStatus.DENIED
        self._redis.setex(
            DEVICE_CODE_KEY_FMT.format(code=device_code),
            self._remaining_ttl(device_code, floor=1),
            state.to_json(),
        )

    def consume_on_poll(self, device_code: str) -> DeviceFlowState | None:
        """Race-safe via Lua EVAL: GET + status-check + DEL execute in a
        single Redis transaction so only one of N concurrent pollers
        observes the APPROVED state. Losers get None, mapped to
        expired_token by the caller.
        """
        raw = self._consume_on_poll_script(
            keys=[DEVICE_CODE_KEY_FMT.format(code=device_code)],
            args=[_USER_CODE_KEY_PREFIX],
        )
        if raw is None:
            return None
        text_ = raw.decode() if isinstance(raw, (bytes, bytearray)) else raw
        try:
            return DeviceFlowState.from_json(text_)
        except (ValueError, KeyError):
            logger.error("device_flow: corrupt state on consume %s", device_code)
            return None

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

    def _remaining_ttl(self, device_code: str, floor: int) -> int:
        """``max(remaining, floor)`` — guarantees the CLI has at least
        ``floor`` seconds to poll after a near-expiry approve.
        """
        ttl = self._redis.ttl(DEVICE_CODE_KEY_FMT.format(code=device_code))
        if ttl is None or ttl < 0:
            return floor
        return max(int(ttl), floor)


# ============================================================================
# Token mint — generate + upsert
# ============================================================================


OAUTH_BODY_BYTES = 32  # ~256 bits entropy
PREFIX_OAUTH_ACCOUNT = "dfoa_"
PREFIX_OAUTH_EXTERNAL_SSO = "dfoe_"

# Sentinel issuer for account-flow rows. Postgres' default partial unique
# index treats NULLs as distinct, which would let two live `dfoa_` rows
# share (email, client, device) and break rotate-in-place. Storing a
# non-empty literal makes the composite key collide as intended.
ACCOUNT_ISSUER_SENTINEL = "dify:account"


@dataclass(frozen=True, slots=True)
class MintResult:
    """Plaintext token surfaces to the caller once."""
    token: str
    token_id: uuid.UUID
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class UpsertOutcome:
    token_id: uuid.UUID
    rotated: bool
    old_hash: str | None


def generate_token(prefix: str) -> str:
    return prefix + secrets.token_urlsafe(OAUTH_BODY_BYTES)


def sha256_hex(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def mint_oauth_token(
    session: Session,
    redis_client,
    *,
    subject_email: str,
    subject_issuer: str | None,
    account_id: str | None,
    client_id: str,
    device_label: str,
    prefix: str,
    ttl_days: int,
) -> MintResult:
    """Live row rotates in place via partial unique index
    ``uq_oauth_active_per_device``; hard-expired rows are excluded by the
    index predicate so re-login INSERTs fresh. Pre-rotate Redis entry is
    deleted so stale AuthContext drops immediately.
    """
    if prefix == PREFIX_OAUTH_ACCOUNT:
        # Account flow always writes the sentinel — caller may pass None
        # (for clarity) or the sentinel itself; nothing else is valid.
        if subject_issuer not in (None, ACCOUNT_ISSUER_SENTINEL):
            raise ValueError(
                f"account-flow token must use ACCOUNT_ISSUER_SENTINEL, got {subject_issuer!r}"
            )
        subject_issuer = ACCOUNT_ISSUER_SENTINEL
    elif prefix == PREFIX_OAUTH_EXTERNAL_SSO:
        # Defense in depth: enterprise canonicalises + rejects empty,
        # but a regression there must not yield a NULL composite key here.
        if not subject_issuer or not subject_issuer.strip():
            raise ValueError("external-SSO token requires non-empty subject_issuer")
    else:
        raise ValueError(f"unknown oauth prefix: {prefix!r}")

    token = generate_token(prefix)
    new_hash = sha256_hex(token)
    expires_at = datetime.now(UTC) + timedelta(days=ttl_days)

    outcome = _upsert(
        session,
        subject_email=subject_email,
        subject_issuer=subject_issuer,
        account_id=account_id,
        client_id=client_id,
        device_label=device_label,
        prefix=prefix,
        new_hash=new_hash,
        expires_at=expires_at,
    )

    if outcome.rotated and outcome.old_hash:
        redis_client.delete(TOKEN_CACHE_KEY_FMT.format(hash=outcome.old_hash))

    return MintResult(token=token, token_id=outcome.token_id, expires_at=expires_at)


def _upsert(
    session: Session,
    *,
    subject_email: str,
    subject_issuer: str | None,
    account_id: str | None,
    client_id: str,
    device_label: str,
    prefix: str,
    new_hash: str,
    expires_at: datetime,
) -> UpsertOutcome:
    # Snapshot prior live row's hash for Redis invalidation post-rotate.
    # subject_issuer is always non-null here (account flow uses sentinel,
    # external-SSO is validated upstream), so equality matches the index.
    prior = session.execute(
        select(OAuthAccessToken.id, OAuthAccessToken.token_hash)
        .where(
            OAuthAccessToken.subject_email == subject_email,
            OAuthAccessToken.subject_issuer == subject_issuer,
            OAuthAccessToken.client_id == client_id,
            OAuthAccessToken.device_label == device_label,
            OAuthAccessToken.revoked_at.is_(None),
        )
        .limit(1)
    ).first()
    old_hash = prior.token_hash if prior else None

    insert_stmt = pg_insert(OAuthAccessToken).values(
        subject_email=subject_email,
        subject_issuer=subject_issuer,
        account_id=account_id,
        client_id=client_id,
        device_label=device_label,
        prefix=prefix,
        token_hash=new_hash,
        expires_at=expires_at,
    )
    upsert_stmt = insert_stmt.on_conflict_do_update(
        index_elements=["subject_email", "subject_issuer", "client_id", "device_label"],
        index_where=OAuthAccessToken.revoked_at.is_(None),
        set_={
            "token_hash": insert_stmt.excluded.token_hash,
            "prefix": insert_stmt.excluded.prefix,
            "account_id": insert_stmt.excluded.account_id,
            "expires_at": insert_stmt.excluded.expires_at,
            "created_at": func.now(),
            "last_used_at": None,
        },
    ).returning(OAuthAccessToken.id)
    row = session.execute(upsert_stmt).first()
    session.commit()

    token_id = uuid.UUID(str(row.id))
    return UpsertOutcome(
        token_id=token_id,
        rotated=prior is not None,
        old_hash=old_hash,
    )


# ============================================================================
# TTL policy — days new OAuth tokens live
# ============================================================================


DEFAULT_OAUTH_TTL_DAYS = 14
MIN_TTL_DAYS = 1
MAX_TTL_DAYS = 365

_TTL_ENV_VAR = "OAUTH_TTL_DAYS"


def oauth_ttl_days(tenant_id: str | None = None) -> int:
    """``OAUTH_TTL_DAYS`` env, else default. EE tenant-level lookup
    is deferred; when it lands it wins over the env (Redis-cached 60s).
    """
    _ = tenant_id

    raw = os.environ.get(_TTL_ENV_VAR)
    if raw is None:
        return DEFAULT_OAUTH_TTL_DAYS
    try:
        value = int(raw)
    except ValueError:
        logger.warning(
            "%s=%r is not an int; falling back to %d",
            _TTL_ENV_VAR, raw, DEFAULT_OAUTH_TTL_DAYS,
        )
        return DEFAULT_OAUTH_TTL_DAYS
    if value < MIN_TTL_DAYS:
        logger.warning("%s=%d below min %d; clamping", _TTL_ENV_VAR, value, MIN_TTL_DAYS)
        return MIN_TTL_DAYS
    if value > MAX_TTL_DAYS:
        logger.warning("%s=%d above max %d; clamping", _TTL_ENV_VAR, value, MAX_TTL_DAYS)
        return MAX_TTL_DAYS
    return value
