"""Knowledge-agent connections at the edges: rate limits, code replay, ownership, expiry."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from typing import override

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant
from models.knowledge_agent import KnowledgeAgentGrant, KnowledgeAgentGrantSpace, KnowledgeAgentRefreshToken
from models.oauth import OAuthAccessToken
from services.knowledge_agent.access_service import (
    KnowledgeAgentAccessError,
    KnowledgeAgentAuthFailure,
    KnowledgeAgentPrincipal,
)
from services.knowledge_agent.authorization import CODE_REPLAY_MEMORY_SECONDS
from services.knowledge_agent.clients import DCR_PER_IP_PER_HOUR, DCR_RATE_WINDOW_SECONDS
from services.knowledge_agent.oauth import KnowledgeAgentOAuthError
from tests.helpers.unit.knowledge_agent import (
    URLS,
    FakeRedis,
    World,
    authorize,
    code_form,
    exchange,
    knowledge_agent_world,
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
