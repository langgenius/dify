"""Cross-client singleflight against real Redis scripts; CI only."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from flask import Flask

from clients.plugin.auth_entities import CredentialCheckResult
from constants.end_user_connections import ConnectionCredentialStatus, OAuthClientSource
from extensions.ext_redis import RedisClientWrapper
from services.end_user_connection_oauth_adapters import RedisOAuthRefreshSingleFlight
from services.end_user_connections.contracts import ConnectionCheckView
from services.end_user_connections.entities import ConnectionMutationGuard, ConnectionOAuthClient, ConnectionOwner
from services.end_user_connections.errors import ConnectionConflictError
from services.end_user_connections.oauth import OAuthClientSnapshot
from services.end_user_connections.oauth_lifecycle import OAuthRefreshLease, OAuthRefreshResult


@pytest.mark.parametrize("failure", [False, True])
def test_redis_singleflight_shares_only_inflight_outcomes(
    flask_app_with_containers: Flask, monkeypatch: pytest.MonkeyPatch, failure: bool
) -> None:
    redis: RedisClientWrapper = flask_app_with_containers.extensions["redis"]
    leader = RedisOAuthRefreshSingleFlight(redis=redis)
    follower = RedisOAuthRefreshSingleFlight(redis=redis)
    guard = ConnectionMutationGuard(
        connection_id="connection",
        tenant_id="tenant",
        owner=ConnectionOwner(account_id="account", end_user_id=None),
        revision=1,
    )
    result = OAuthRefreshResult(
        view=ConnectionCheckView(
            connection_id="connection",
            credential_status=ConnectionCredentialStatus.CONNECTED,
            check=CredentialCheckResult(status="valid", reason_code=None, retryable=False, checked_at=1),
        ),
        revision=2,
        client=OAuthClientSnapshot(
            reference=ConnectionOAuthClient(
                source=OAuthClientSource.WORKSPACE, configuration_id="client", client_id=None
            ),
            fingerprint="fingerprint",
        ),
    )
    entered, joined, release = Event(), Event(), Event()
    operations: list[int] = []
    original_wait = follower._wait

    def wait(key: str, result_key: str, token: str) -> OAuthRefreshResult:
        joined.set()
        return original_wait(key, result_key, token)

    monkeypatch.setattr(follower, "_wait", wait)

    def operation(lease: OAuthRefreshLease) -> OAuthRefreshResult:
        operations.append(1)
        entered.set()
        assert release.wait(5)
        lease.ensure_owned()
        if failure:
            raise ConnectionConflictError()
        return result

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(leader.run, guard, operation)
        assert entered.wait(5)
        second = pool.submit(follower.run, guard, operation)
        try:
            assert joined.wait(5)
        finally:
            release.set()
        for future in (first, second):
            if failure:
                with pytest.raises(ConnectionConflictError):
                    future.result(timeout=5)
            else:
                assert future.result(timeout=5) == result
    assert len(operations) == 1
    if failure:
        with pytest.raises(ConnectionConflictError):
            leader.run(guard, operation)
    else:
        assert leader.run(guard, operation) == result
    assert len(operations) == 2
