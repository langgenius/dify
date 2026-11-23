from collections.abc import Callable
from urllib.parse import parse_qs, urlsplit

import pytest

from libs.account_avatar import sign_avatar_preview_uri, verify_avatar_preview_signature


@pytest.mark.parametrize(("access_timeout", "window"), [(300, 60), (7, 3)])
def test_avatar_signature_is_stable_within_a_window_and_expires_normally(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    access_timeout: int,
    window: int,
) -> None:
    config_overrides(SECRET_KEY="unit-secret", FILES_ACCESS_TIMEOUT=access_timeout)
    timestamp = 120
    now = timestamp
    monkeypatch.setattr("libs.account_avatar.time.time", lambda: now)
    account_id = "11111111-1111-1111-1111-111111111111"
    file_id = "22222222-2222-2222-2222-222222222222"

    def sign_uri() -> str:
        return sign_avatar_preview_uri(upload_file_id=file_id, account_id=account_id)

    first = sign_uri()
    now = timestamp + window - 1
    assert sign_uri() == first
    now = timestamp + window
    next_uri = sign_uri()
    assert next_uri != first

    parsed = urlsplit(first)
    query = parse_qs(parsed.query)
    next_query = parse_qs(urlsplit(next_uri).query)
    assert parsed.path == f"/files/{file_id}/file-preview"
    assert query["timestamp"] == [str(timestamp)]
    assert query["nonce"] == [f"account-avatar-v2:{account_id}"]
    assert query["issued_before"] == [str(timestamp + window)]
    assert query["expires_at"] == [str(timestamp + access_timeout)]
    assert next_query["timestamp"] == query["issued_before"]
    assert next_query["nonce"] == query["nonce"]
    assert next_query["issued_before"] == [str(timestamp + 2 * window)]
    assert next_query["expires_at"] == [str(timestamp + window + access_timeout)]

    def verify_first(nonce: str) -> bool:
        return verify_avatar_preview_signature(
            upload_file_id=file_id, timestamp=query["timestamp"][0], nonce=nonce, sign=query["sign"][0]
        )

    nonce = query["nonce"][0]
    assert verify_first(nonce)
    assert not verify_first("account-avatar-v2:33333333-3333-3333-3333-333333333333")
    assert not verify_first("generic-file-nonce")
    now = timestamp - 5
    assert verify_first(nonce)
    now = timestamp - 6
    assert not verify_first(nonce)
    now = timestamp + access_timeout
    assert verify_first(nonce)
    now += 1
    assert not verify_first(nonce)
