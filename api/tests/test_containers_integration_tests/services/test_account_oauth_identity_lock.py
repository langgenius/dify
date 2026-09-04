"""Redis-backed integration coverage for Console OAuth account-claim leases."""

import time
from hashlib import sha256
from uuid import uuid4

import pytest

from extensions.ext_redis import redis_client
from services import account_oauth_adapters
from services.account_errors import OAuthIdentityLockUnavailableError
from services.account_oauth_adapters import RedisOAuthAccountClaimLock


@pytest.mark.usefixtures("flask_app_with_containers")
def test_account_claim_locks_remain_exclusive_beyond_their_initial_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(account_oauth_adapters, "_OAUTH_ACCOUNT_CLAIM_LOCK_TIMEOUT_SECONDS", 0.5)
    monkeypatch.setattr(account_oauth_adapters, "_OAUTH_ACCOUNT_CLAIM_LOCK_RENEW_INTERVAL_SECONDS", 0.1)
    monkeypatch.setattr(account_oauth_adapters, "_OAUTH_ACCOUNT_CLAIM_LOCK_BLOCKING_TIMEOUT_SECONDS", 0.2)
    provider = "github"
    open_id = f"identity-{uuid4().hex}"
    email = f"account-{uuid4().hex}@example.com"
    identity_digest = sha256("\0".join(("identity", provider, open_id)).encode()).hexdigest()
    email_digest = sha256("\0".join(("email", email)).encode()).hexdigest()
    lock_names = [
        f"oauth:account-claim:{identity_digest}",
        f"oauth:account-claim:{email_digest}",
    ]
    account_claims = RedisOAuthAccountClaimLock(client=redis_client)
    contenders = [
        redis_client.lock(lock_name, timeout=1, blocking=False, thread_local=False) for lock_name in lock_names
    ]

    with account_claims.acquire(provider=provider, open_id=open_id, email=email):
        time.sleep(1.2)
        assert all(contender.acquire(blocking=False) is False for contender in contenders)

    for contender in contenders:
        assert contender.acquire(blocking=False) is True
        contender.release()


@pytest.mark.usefixtures("flask_app_with_containers")
def test_different_providers_with_the_same_email_contend_for_one_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(account_oauth_adapters, "_OAUTH_ACCOUNT_CLAIM_LOCK_BLOCKING_TIMEOUT_SECONDS", 0.1)
    email = f"account-{uuid4().hex}@example.com"
    account_claims = RedisOAuthAccountClaimLock(client=redis_client)

    with account_claims.acquire(provider="github", open_id=f"github-{uuid4().hex}", email=email):
        with pytest.raises(OAuthIdentityLockUnavailableError):
            with account_claims.acquire(provider="google", open_id=f"google-{uuid4().hex}", email=email):
                raise AssertionError("same-email claim body must not run concurrently")


@pytest.mark.usefixtures("flask_app_with_containers")
def test_final_account_claim_serializes_different_provider_identities(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(account_oauth_adapters, "_OAUTH_ACCOUNT_CLAIM_LOCK_BLOCKING_TIMEOUT_SECONDS", 0.1)
    account_claims = RedisOAuthAccountClaimLock(client=redis_client)
    account_id = f"account-{uuid4().hex}"

    with account_claims.acquire_account(account_id):
        with pytest.raises(OAuthIdentityLockUnavailableError):
            with account_claims.acquire_account(account_id):
                raise AssertionError("same-account claim body must not run concurrently")
