"""Sign and verify account-scoped avatar preview URLs."""

import base64
import hmac
import time
from urllib.parse import urlencode
from uuid import UUID

from configs import dify_config

ACCOUNT_AVATAR_NONCE_PREFIX = "account-avatar-v2:"
_PREVIEW_PURPOSE = "account-avatar-preview"
_SIGNING_WINDOW_SECONDS = 60
_CLOCK_SKEW_SECONDS = 5


def account_avatar_owner(nonce: str) -> str:
    """Return the canonical account ID carried by an avatar nonce or raise ValueError."""
    return str(UUID(nonce.removeprefix(ACCOUNT_AVATAR_NONCE_PREFIX)))


def sign_avatar_preview_uri(*, upload_file_id: str, account_id: str) -> str:
    """Sign canonical file and account IDs. Delivery must verify ownership before serving the file."""
    lifetime = dify_config.FILES_ACCESS_TIMEOUT
    window = min(_SIGNING_WINDOW_SECONDS, max(1, lifetime // 2))
    timestamp = int(time.time())
    timestamp -= timestamp % window
    nonce = f"{ACCOUNT_AVATAR_NONCE_PREFIX}{account_id}"
    query = urlencode(
        {
            "timestamp": str(timestamp),
            "nonce": nonce,
            "sign": _signature(upload_file_id, str(timestamp), nonce).decode(),
            # Keep these client hints stable for every URL signed within the same window.
            "issued_before": str(timestamp + window),
            "expires_at": str(timestamp + lifetime),
        }
    )
    return f"/files/{upload_file_id}/file-preview?{query}"


def verify_avatar_preview_signature(*, upload_file_id: str, timestamp: str, nonce: str, sign: str) -> bool:
    """Verify the avatar signature and time bounds for a preview request with a numeric timestamp."""
    if not nonce.startswith(ACCOUNT_AVATAR_NONCE_PREFIX) or not hmac.compare_digest(
        sign.encode(), _signature(upload_file_id, timestamp, nonce)
    ):
        return False
    age = int(time.time()) - int(timestamp)
    return -_CLOCK_SKEW_SECONDS <= age <= dify_config.FILES_ACCESS_TIMEOUT


def avatar_preview_cache_max_age(*, timestamp: str, nonce: str) -> int | None:
    """Return remaining private-cache seconds for an already verified avatar signature, else None."""
    if not nonce.startswith(ACCOUNT_AVATAR_NONCE_PREFIX):
        return None
    age = max(0, int(time.time()) - int(timestamp))
    return max(0, dify_config.FILES_ACCESS_TIMEOUT - age)


def _signature(upload_file_id: str, timestamp: str, nonce: str) -> bytes:
    payload = f"{_PREVIEW_PURPOSE}|{upload_file_id}|{timestamp}|{nonce}"
    digest = hmac.digest(dify_config.SECRET_KEY.encode(), payload.encode(), "sha256")
    return base64.urlsafe_b64encode(digest)
