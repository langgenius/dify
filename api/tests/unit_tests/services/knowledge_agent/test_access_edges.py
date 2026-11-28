"""Knowledge-agent connections at the edges: rate limits, code replay, ownership, expiry."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator
from datetime import UTC, datetime, timedelta
from typing import override

import httpx
import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.helper.ssrf_proxy import ResponseTooLargeError
from models.account import Tenant
from models.knowledge_agent import KnowledgeAgentGrant, KnowledgeAgentGrantSpace, KnowledgeAgentRefreshToken
from models.oauth import OAuthAccessToken
from services import knowledge_agent
from services.knowledge_agent.access_service import (
    KnowledgeAgentAccessError,
    KnowledgeAgentAuthFailure,
    KnowledgeAgentPrincipal,
)
from services.knowledge_agent.authorization import CODE_REPLAY_MEMORY_SECONDS
from services.knowledge_agent.clients import (
    CLIENT_METADATA_MAX_BYTES,
    DCR_GLOBAL_PER_HOUR,
    DCR_PER_IP_PER_HOUR,
    DCR_RATE_WINDOW_SECONDS,
    KnowledgeAgentClientRegistry,
)
from services.knowledge_agent.oauth import KnowledgeAgentOAuthError, sha256_hex
from tests.helpers.unit.knowledge_agent import (
    CALLBACK,
    URLS,
    FakeRedis,
    World,
    authorize,
    code_form,
    exchange,
    knowledge_agent_world,
    pkce,
    register,
)

INVALID = KnowledgeAgentAuthFailure(401, "invalid_token")


class InterleavingRedis(FakeRedis):
    """Runs a callback once, right after the first deletion of an authorization code."""

    def __init__(self) -> None:
        super().__init__()
        self.after_code_delete: Callable[[], None] | None = None

    @override
    def delete(self, *names: str | bytes) -> int:
        removed = super().delete(*names)
        callback = self.after_code_delete
        if callback is not None and any(str(name).startswith("knowledge_agent:code:") for name in names):
            self.after_code_delete = None
            callback()
        return removed


@pytest.fixture(autouse=True)
def _no_bearer_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("libs.oauth_bearer.enforce_bearer_rate_limit", lambda _hash: None)


@pytest.fixture
def redis() -> InterleavingRedis:
    return InterleavingRedis()


@pytest.fixture
def world(sqlite_session_factory: sessionmaker[Session], redis: InterleavingRedis) -> Iterator[World]:
    with knowledge_agent_world(sqlite_session_factory, redis) as built:
        yield built


def _live_grants(world: World) -> list[str]:
    with world.sessions() as session:
        return list(session.scalars(select(KnowledgeAgentGrant.id).where(KnowledgeAgentGrant.revoked_at.is_(None))))


def _personal_token(world: World, name: str = "CI") -> tuple[str, str]:
    """A personal token of the member for the handbook: its grant id and the token."""
    created = world.service.create_personal_token(
        account=world.member_account, tenant_id=world.tenant, body={"name": name, "knowledge_base_ids": ["kb-handbook"]}
    )
    return created["grant"]["id"], created["token"]


# -- Dynamic client registration ---------------------------------------------------------------


def test_client_registration_is_rate_limited_per_address_for_an_hour(world: World) -> None:
    body = {"client_name": "Agent", "redirect_uris": ["http://127.0.0.1/callback"]}
    for _ in range(DCR_PER_IP_PER_HOUR):
        world.service.register_client(body, ip_address="10.0.0.7")
    with pytest.raises(KnowledgeAgentOAuthError) as refused:
        world.service.register_client(body, ip_address="10.0.0.7")
    assert refused.value.error == "slow_down"
    assert refused.value.status == 429
    # The window is opened by the first registration and is one hour long.
    assert DCR_RATE_WINDOW_SECONDS == 3600
    assert world.redis.expiries["knowledge_agent:dcr:10.0.0.7"] == DCR_RATE_WINDOW_SECONDS
    # Another address, and callers without one, have their own counters.
    world.service.register_client(body, ip_address="10.0.0.8")
    world.service.register_client(body, ip_address=None)
    assert world.redis.values["knowledge_agent:dcr:unknown"] == 1
    assert world.redis.expiries["knowledge_agent:dcr:unknown"] == DCR_RATE_WINDOW_SECONDS


def test_the_rate_window_is_not_extended_by_later_registrations(world: World) -> None:
    body = {"redirect_uris": ["http://127.0.0.1/callback"]}
    world.service.register_client(body, ip_address="10.0.0.7")
    world.redis.expiries["knowledge_agent:dcr:10.0.0.7"] = 12  # time has passed
    world.service.register_client(body, ip_address="10.0.0.7")
    assert world.redis.expiries["knowledge_agent:dcr:10.0.0.7"] == 12


def test_refused_registrations_still_count_against_the_limit(world: World) -> None:
    for _ in range(DCR_PER_IP_PER_HOUR):
        with pytest.raises(KnowledgeAgentOAuthError, match="redirect_uris"):
            world.service.register_client({"redirect_uris": []}, ip_address="10.0.0.7")
    with pytest.raises(KnowledgeAgentOAuthError) as refused:
        world.service.register_client({"redirect_uris": ["http://127.0.0.1/callback"]}, ip_address="10.0.0.7")
    assert refused.value.error == "slow_down"


class CountingKeysRedis(InterleavingRedis):
    """Fails the test the moment a rate counter exists without an expiry after a command."""

    @override
    def incr(self, name: str) -> int:
        value = super().incr(name)
        assert self.ttl(name) > 0, f"{name} was counted without an expiry"
        return value


def test_a_rate_counter_never_exists_without_an_expiry(sqlite_session_factory: sessionmaker[Session]) -> None:
    redis = CountingKeysRedis()
    body = {"redirect_uris": ["http://127.0.0.1/callback"]}
    with knowledge_agent_world(sqlite_session_factory, redis) as world:
        # The limit is reached within the very first window, and refusals keep counting.
        for _ in range(DCR_PER_IP_PER_HOUR):
            world.service.register_client(body, ip_address="10.0.0.7")
        for _ in range(3):
            with pytest.raises(KnowledgeAgentOAuthError) as refused:
                world.service.register_client(body, ip_address="10.0.0.7")
            assert refused.value.retry_after == DCR_RATE_WINDOW_SECONDS
        assert redis.ttl("knowledge_agent:dcr:10.0.0.7") == DCR_RATE_WINDOW_SECONDS
        assert redis.ttl("knowledge_agent:dcr-global") == DCR_RATE_WINDOW_SECONDS
        # Refused attempts did not reach the deployment-wide counter.
        assert redis.values["knowledge_agent:dcr-global"] == DCR_PER_IP_PER_HOUR
        # Once the window lapses the address registers again, in a new window.
        redis.lapse("knowledge_agent:dcr:10.0.0.7")
        world.service.register_client(body, ip_address="10.0.0.7")
        assert redis.values["knowledge_agent:dcr:10.0.0.7"] == 1
        assert redis.ttl("knowledge_agent:dcr:10.0.0.7") == DCR_RATE_WINDOW_SECONDS


def test_a_counter_left_without_an_expiry_is_given_one_and_reports_the_time_left(world: World) -> None:
    body = {"redirect_uris": ["http://127.0.0.1/callback"]}
    # What the former INCR-then-EXPIRE pair left behind when it was interrupted: blocked forever.
    world.redis.values["knowledge_agent:dcr:10.0.0.7"] = DCR_PER_IP_PER_HOUR
    assert world.redis.ttl("knowledge_agent:dcr:10.0.0.7") == -1
    with pytest.raises(KnowledgeAgentOAuthError) as refused:
        world.service.register_client(body, ip_address="10.0.0.7")
    assert refused.value.retry_after == DCR_RATE_WINDOW_SECONDS
    assert world.redis.ttl("knowledge_agent:dcr:10.0.0.7") == DCR_RATE_WINDOW_SECONDS
    # Later refusals report what is left of the window rather than a full hour.
    world.redis.expiries["knowledge_agent:dcr:10.0.0.7"] = 90
    with pytest.raises(KnowledgeAgentOAuthError) as refused:
        world.service.register_client(body, ip_address="10.0.0.7")
    assert refused.value.retry_after == 90
    assert world.redis.ttl("knowledge_agent:dcr:10.0.0.7") == 90


def test_registration_stops_deployment_wide_at_the_hourly_ceiling_whatever_the_address(world: World) -> None:
    assert DCR_GLOBAL_PER_HOUR == 20 * DCR_PER_IP_PER_HOUR
    body = {"redirect_uris": ["http://127.0.0.1/callback"]}
    # Every address stays far below its own limit.
    for index in range(DCR_GLOBAL_PER_HOUR):
        world.service.register_client(body, ip_address=f"10.{index // 250}.{index % 250}.1")
    world.redis.expiries["knowledge_agent:dcr-global"] = 1200  # twenty minutes of the window remain
    with pytest.raises(KnowledgeAgentOAuthError) as refused:
        world.service.register_client(body, ip_address="192.0.2.1")
    assert refused.value.error == "temporarily_unavailable"
    assert refused.value.status == 429
    assert refused.value.retry_after == 1200
    assert "try again later" in refused.value.description
    # The ceiling lifts with its window; per-address counters are untouched by it.
    world.redis.lapse("knowledge_agent:dcr-global")
    world.service.register_client(body, ip_address="192.0.2.1")
    assert world.redis.values["knowledge_agent:dcr-global"] == 1


def test_the_fake_redis_keeps_nx_and_expiry_semantics() -> None:
    redis = FakeRedis()
    assert redis.ttl("k") == -2
    assert redis.expire("k", 5) is False
    assert redis.expiries == {}
    assert redis.set("k", "0", ex=60, nx=True) is True
    assert redis.set("k", "9", ex=600, nx=True) is None
    assert (redis.get("k"), redis.ttl("k")) == ("0", 60)
    assert redis.incr("k") == 1
    assert redis.ttl("k") == 60
    assert redis.delete("k") == 1
    assert redis.incr("k") == 1
    assert redis.ttl("k") == -1
    assert redis.expire("k", 5) is True
    assert redis.ttl("k") == 5


# -- Authorization code replay -----------------------------------------------------------------


def test_a_second_redemption_is_refused_and_revokes_the_grant_and_its_tokens(world: World) -> None:
    client_id = register(world)
    flow = authorize(world, client_id=client_id, spaces=["kb-handbook"])
    tokens = exchange(world, flow)
    assert len(_live_grants(world)) == 1
    with pytest.raises(KnowledgeAgentOAuthError) as replay:
        exchange(world, flow)
    assert replay.value.error == "invalid_grant"
    assert replay.value.description == "The authorization code was already used"
    assert _live_grants(world) == []
    assert world.service.authenticate(tokens["access_token"]) == INVALID
    with world.sessions() as session:
        assert session.scalars(select(KnowledgeAgentRefreshToken)).all() == []
        row = session.scalar(select(OAuthAccessToken).where(OAuthAccessToken.prefix == "dfok_"))
        assert row is not None
        assert row.token_hash is None
        assert row.revoked_at is not None
    with pytest.raises(KnowledgeAgentOAuthError, match="refresh token is invalid"):
        world.service.exchange_token(
            {"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": client_id}, URLS
        )


def test_the_used_marker_is_reserved_before_the_code_is_deleted(world: World, redis: InterleavingRedis) -> None:
    flow = authorize(world, client_id=register(world), spaces=["kb-handbook"])
    seen: list[dict[str, str | int]] = []
    redis.after_code_delete = lambda: seen.append(dict(redis.values))
    exchange(world, flow)
    [snapshot] = seen
    used = [key for key in snapshot if key.startswith("knowledge_agent:code_used:")]
    assert len(used) == 1
    # It names the connection the redemption then created, and outlives the code itself.
    assert _live_grants(world) == [snapshot[used[0]]]
    assert redis.expiries[used[0]] == CODE_REPLAY_MEMORY_SECONDS


def test_a_concurrent_second_redemption_cannot_slip_between_the_code_and_its_marker(
    world: World, redis: InterleavingRedis
) -> None:
    """Regression: the marker used to be written after commit, so a racing replay revoked nothing."""
    flow = authorize(world, client_id=register(world), spaces=["kb-handbook"])
    second: list[KnowledgeAgentOAuthError] = []

    def replay_now() -> None:
        with pytest.raises(KnowledgeAgentOAuthError) as error:
            exchange(world, flow)
        second.append(error.value)

    redis.after_code_delete = replay_now
    with pytest.raises(KnowledgeAgentOAuthError) as first:
        exchange(world, flow)
    # The racing presentation is recognised as a replay, not as an unknown code...
    assert [error.description for error in second] == ["The authorization code was already used"]
    # ...and the redemption that was in flight ends the connection it had just created.
    assert first.value.description == "The authorization code was already used"
    assert _live_grants(world) == []
    with world.sessions() as session:
        assert session.scalars(select(KnowledgeAgentRefreshToken)).all() == []
        assert session.scalars(select(OAuthAccessToken.token_hash)).all() == [None]


def test_a_failed_redemption_burns_the_code_without_leaving_a_replay_marker(world: World) -> None:
    client_id = register(world)
    flow = authorize(world, client_id=client_id, spaces=["kb-handbook"])
    with pytest.raises(KnowledgeAgentOAuthError, match="PKCE"):
        world.service.exchange_token({**code_form(flow), "code_verifier": "x" * 43}, URLS)
    with pytest.raises(KnowledgeAgentOAuthError) as retry:
        exchange(world, flow)
    assert retry.value.description == "The authorization code is invalid or expired"
    assert [key for key in world.redis.values if key.startswith("knowledge_agent:code")] == []
    assert _live_grants(world) == []


# -- Ownership ---------------------------------------------------------------------------------


def test_only_the_owner_changes_a_connection_and_only_owner_or_admin_disconnects_it(world: World) -> None:
    service = world.service
    grant_id, token = _personal_token(world)

    # Another member, even a workspace owner, cannot change which bases it reads.
    with pytest.raises(KnowledgeAgentAccessError) as update:
        service.update_grant(
            account=world.admin_account,
            tenant_id=world.tenant,
            grant_id=grant_id,
            body={"knowledge_base_ids": ["kb-finance"]},
        )
    assert (update.value.status, update.value.code) == (403, "permission_denied")
    # Another member without an admin role cannot disconnect it.
    for role in ("normal", "editor", None):
        with pytest.raises(KnowledgeAgentAccessError) as revoke:
            service.revoke_grant(account=world.admin_account, tenant_id=world.tenant, role=role, grant_id=grant_id)
        assert (revoke.value.status, revoke.value.code) == (403, "permission_denied")
    principal = service.authenticate(token)
    assert isinstance(principal, KnowledgeAgentPrincipal)
    assert principal.control_space_ids == ("kb-handbook",)

    # A workspace admin can.
    service.revoke_grant(account=world.admin_account, tenant_id=world.tenant, role="admin", grant_id=grant_id)
    assert service.authenticate(token) == INVALID
    # Gone means not found, for the owner as well.
    with pytest.raises(KnowledgeAgentAccessError) as gone:
        service.revoke_grant(account=world.member_account, tenant_id=world.tenant, role="normal", grant_id=grant_id)
    assert (gone.value.status, gone.value.code) == (404, "agent_grant_not_found")


def test_connections_of_another_workspace_are_not_found(world: World) -> None:
    grant_id, token = _personal_token(world)
    with world.sessions.begin() as session:
        other = Tenant(name="Other")
        session.add(other)
        session.flush()
        other_tenant = other.id
    with pytest.raises(KnowledgeAgentAccessError) as update:
        world.service.update_grant(
            account=world.member_account,
            tenant_id=other_tenant,
            grant_id=grant_id,
            body={"knowledge_base_ids": ["kb-handbook"]},
        )
    assert (update.value.status, update.value.code) == (404, "agent_grant_not_found")
    with pytest.raises(KnowledgeAgentAccessError) as revoke:
        world.service.revoke_grant(account=world.admin_account, tenant_id=other_tenant, role="owner", grant_id=grant_id)
    assert (revoke.value.status, revoke.value.code) == (404, "agent_grant_not_found")
    assert isinstance(world.service.authenticate(token), KnowledgeAgentPrincipal)


# -- Expiry ------------------------------------------------------------------------------------


def test_updating_an_expired_connection_is_a_clean_not_found(world: World) -> None:
    """Regression: this unpacked an empty list of views and surfaced as an unhandled error."""
    grant_id, _ = _personal_token(world, "Old")
    with world.sessions.begin() as session:
        grant = session.get(KnowledgeAgentGrant, grant_id)
        assert grant is not None
        grant.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    with pytest.raises(KnowledgeAgentAccessError) as error:
        world.service.update_grant(
            account=world.member_account,
            tenant_id=world.tenant,
            grant_id=grant_id,
            body={"knowledge_base_ids": ["kb-handbook", "kb-finance"]},
        )
    assert (error.value.status, error.value.code) == (404, "agent_grant_not_found")
    assert error.value.message == "Connection not found"
    # Its bases were left alone, and its owner can still clear it away.
    with world.sessions() as session:
        assert session.scalars(
            select(KnowledgeAgentGrantSpace.control_space_id).where(KnowledgeAgentGrantSpace.grant_id == grant_id)
        ).all() == ["kb-handbook"]
    world.service.revoke_grant(account=world.member_account, tenant_id=world.tenant, role="normal", grant_id=grant_id)
    assert _live_grants(world) == []


# -- Review fixes ------------------------------------------------------------------------------


def test_blocked_knowledge_bases_are_only_those_the_member_can_read(world: World) -> None:
    """Regression: the consent page and the connection view listed every blocked base of the workspace."""
    world.spaces.blocked_ids.add("kb-secret")  # blocked, and not shared with the member
    mine = world.service.list_mine(account=world.member_account, tenant_id=world.tenant, urls=URLS)
    assert mine["blocked_knowledge_base_ids"] == ["kb-board"]
    _, challenge = pkce()
    described = world.service.describe_authorization(
        account=world.member_account,
        tenant_id=world.tenant,
        params={
            "response_type": "code",
            "client_id": register(world),
            "redirect_uri": CALLBACK,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
        urls=URLS,
    )
    assert described["blocked_knowledge_base_ids"] == ["kb-board"]
    assert (world.tenant, world.member) in world.spaces.checks


def test_a_connection_revoked_while_its_bases_are_being_checked_is_not_written_to(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression: the ownership check and the write ran in separate transactions, unlocked."""
    grant_id, _ = _personal_token(world)
    check = world.spaces.readable

    def revoke_then_check(*, tenant_id: str, account_id: str, control_space_ids: Iterable[str]) -> set[str]:
        # Lands between the first look at the connection and the transaction that writes.
        world.service.revoke_grant(account=world.admin_account, tenant_id=world.tenant, role="owner", grant_id=grant_id)
        return check(tenant_id=tenant_id, account_id=account_id, control_space_ids=control_space_ids)

    monkeypatch.setattr(world.spaces, "readable", revoke_then_check)
    with pytest.raises(KnowledgeAgentAccessError) as error:
        world.service.update_grant(
            account=world.member_account,
            tenant_id=world.tenant,
            grant_id=grant_id,
            body={"knowledge_base_ids": ["kb-finance"]},
        )
    assert (error.value.status, error.value.code) == (404, "agent_grant_not_found")
    with world.sessions() as session:
        assert session.scalars(
            select(KnowledgeAgentGrantSpace.control_space_id).where(KnowledgeAgentGrantSpace.grant_id == grant_id)
        ).all() == ["kb-handbook"]


def _refresh(world: World, tokens: dict[str, str], client_id: str) -> dict[str, str]:
    return world.service.exchange_token(
        {"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": client_id}, URLS
    )


def test_a_rotated_access_token_is_refused_even_if_its_cache_entry_comes_back(
    world: World, redis: InterleavingRedis
) -> None:
    """Regression: a request racing the rotation could re-cache the old bearer for a minute."""
    client_id = register(world)
    tokens = exchange(world, authorize(world, client_id=client_id, spaces=["kb-handbook"]))
    assert isinstance(world.service.authenticate(tokens["access_token"]), KnowledgeAgentPrincipal)
    cached = {key: value for key, value in redis.values.items() if key.startswith("auth:token:")}
    assert len(cached) == 1
    rotated = _refresh(world, tokens, client_id)
    # What a concurrent request that read the row just before the rotation committed leaves behind.
    for key, value in cached.items():
        redis.setex(key, 60, str(value))
    assert world.service.authenticate(tokens["access_token"]) == INVALID
    assert isinstance(world.service.authenticate(rotated["access_token"]), KnowledgeAgentPrincipal)
    # Revocation still applies at once, cached bearer or not.
    world.service.revoke_token({"token": rotated["refresh_token"]})
    assert world.service.authenticate(rotated["access_token"]) == INVALID


class CommitAwareRedis(FakeRedis):
    """Notes, for every cache entry it drops, the bearer hash that was committed at that moment."""

    def __init__(self, sessions: sessionmaker[Session]) -> None:
        super().__init__()
        self._sessions = sessions
        self.committed_when_dropped: dict[str, list[str | None]] = {}

    @override
    def delete(self, *names: str | bytes) -> int:
        for name in names:
            key = name.decode() if isinstance(name, bytes) else name
            if key.startswith("auth:token:"):
                # A session of its own: it sees committed rows only.
                with self._sessions() as session:
                    self.committed_when_dropped[key] = list(session.scalars(select(OAuthAccessToken.token_hash)))
        return super().delete(*names)


def test_the_old_bearer_leaves_the_cache_only_after_the_rotation_is_committed(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Regression: the entry was dropped before the commit, leaving a window to cache it again."""
    redis = CommitAwareRedis(sqlite_session_factory)
    with knowledge_agent_world(sqlite_session_factory, redis) as built:
        client_id = register(built)
        tokens = exchange(built, authorize(built, client_id=client_id, spaces=["kb-handbook"]))
        old_hash = sha256_hex(tokens["access_token"])
        assert isinstance(built.service.authenticate(tokens["access_token"]), KnowledgeAgentPrincipal)
        rotated = _refresh(built, tokens, client_id)
        new_hash = sha256_hex(rotated["access_token"])
        old_key = next(key for key in redis.committed_when_dropped if key.endswith(old_hash))
        assert redis.committed_when_dropped[old_key] == [new_hash]
        assert not any(key.endswith(old_hash) for key in redis.values)


def test_refreshing_requires_the_client_to_name_itself(world: World) -> None:
    """Regression: a refresh without `client_id` skipped the client binding altogether."""
    client_id = register(world)
    tokens = exchange(world, authorize(world, client_id=client_id, spaces=["kb-handbook"]))
    absent: list[dict[str, object]] = [
        {"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"]},
        {"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": ""},
        {"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": ["x"]},
    ]
    for form in absent:
        with pytest.raises(KnowledgeAgentOAuthError) as missing:
            world.service.exchange_token(form, URLS)
        assert (missing.value.error, missing.value.status) == ("invalid_request", 400)
    with pytest.raises(KnowledgeAgentOAuthError) as other:
        _refresh(world, tokens, register(world, "Another client"))
    assert other.value.error == "invalid_grant"
    # None of the refusals spent the refresh token or ended the connection.
    assert isinstance(world.service.authenticate(tokens["access_token"]), KnowledgeAgentPrincipal)
    assert _refresh(world, tokens, client_id)["access_token"].startswith("dfok_")


class _ChunkedBody(httpx.SyncByteStream):
    """A response body served in chunks, counting how many were actually read."""

    def __init__(self, chunks: int, size: int) -> None:
        self.total = chunks
        self.size = size
        self.served = 0

    @override
    def __iter__(self) -> Iterator[bytes]:
        for _ in range(self.total):
            self.served += 1
            yield b"x" * self.size


def test_an_oversized_client_metadata_document_is_refused_without_being_read_to_the_end(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression: the document was loaded whole and only then cut to the cap."""
    body = _ChunkedBody(chunks=1024, size=16 * 1024)  # 16 MiB against a 64 KiB cap
    requests: list[dict[str, object]] = []

    def make_request(method: str, url: str, **kwargs: object) -> httpx.Response:
        requests.append({"method": method, "url": url, **kwargs})
        return httpx.Response(200, stream=body)

    monkeypatch.setattr(knowledge_agent.ssrf_proxy, "make_request", make_request)
    with pytest.raises(ResponseTooLargeError):
        knowledge_agent._fetch_client_metadata("https://agent.example/client.json")
    assert body.served <= CLIENT_METADATA_MAX_BYTES // body.size + 1
    assert requests[0]["stream_response"] is True
    assert requests[0]["follow_redirects"] is False

    small = httpx.Response(200, content=b'{"client_id": "x"}')
    monkeypatch.setattr(knowledge_agent.ssrf_proxy, "make_request", lambda *_args, **_kwargs: small)
    assert knowledge_agent._fetch_client_metadata("https://agent.example/client.json") == (200, b'{"client_id": "x"}')


def test_a_metadata_document_that_cannot_be_bounded_is_an_invalid_client(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    def too_large(_url: str) -> tuple[int, bytes]:
        raise ResponseTooLargeError("response exceeded the limit")

    with knowledge_agent_world(sqlite_session_factory) as built:
        registry = KnowledgeAgentClientRegistry(
            session_maker=sqlite_session_factory,
            redis_client=built.redis,
            fetch_client_metadata=too_large,
            clock=lambda: datetime.now(UTC),
        )
        with pytest.raises(KnowledgeAgentAccessError) as error:
            registry.resolve("https://agent.example/oauth/client.json")
    assert (error.value.status, error.value.code) == (422, "invalid_client")


class CacheOutageRedis(FakeRedis):
    """Redis going away exactly when a rotated bearer's cache entry is dropped."""

    def __init__(self) -> None:
        super().__init__()
        self.down = False

    @override
    def delete(self, *names: str | bytes) -> int:
        if self.down and any(str(name).startswith("auth:token:") for name in names):
            raise RedisConnectionError("cache is down")
        return super().delete(*names)


def test_a_cache_outage_after_the_rotation_committed_neither_loses_the_new_tokens_nor_keeps_the_old_one(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    redis = CacheOutageRedis()
    with knowledge_agent_world(sqlite_session_factory, redis) as built:
        client_id = register(built)
        tokens = exchange(built, authorize(built, client_id=client_id, spaces=["kb-handbook"]))
        assert isinstance(built.service.authenticate(tokens["access_token"]), KnowledgeAgentPrincipal)
        redis.down = True
        rotated = _refresh(built, tokens, client_id)
        redis.down = False
        # The old bearer is still in the cache, and still refused: the row no longer holds it.
        assert any(key.endswith(sha256_hex(tokens["access_token"])) for key in redis.values)
        assert built.service.authenticate(tokens["access_token"]) == INVALID
        assert isinstance(built.service.authenticate(rotated["access_token"]), KnowledgeAgentPrincipal)
