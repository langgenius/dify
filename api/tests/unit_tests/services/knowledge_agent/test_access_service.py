"""Knowledge-agent connections: OAuth 2.1 (PKCE, codes, rotation), personal tokens, permissions."""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from constants.oauth_bearer import TokenType
from enums.account import TenantAccountRole
from libs.oauth_bearer import InvalidBearerError, build_authenticator, sha256_hex
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin
from models.knowledge_agent import KnowledgeAgentGrant, KnowledgeAgentWorkspaceSetting
from models.oauth import OAuthAccessToken
from repositories.oauth_access_token_repository import SQLAlchemyOAuthAccessTokenRepository
from services.knowledge_agent.access_service import (
    KnowledgeAgentAccessError,
    KnowledgeAgentAccessService,
    KnowledgeAgentAuthFailure,
    KnowledgeAgentPrincipal,
    KnowledgeAgentUrls,
)
from services.knowledge_agent.oauth import KnowledgeAgentOAuthError

URLS = KnowledgeAgentUrls(
    issuer="https://dify.test",
    resource="https://dify.test/mcp/knowledge",
    authorize="https://cloud.dify.test/account/knowledge-agent/authorize",
    token="https://dify.test/mcp/knowledge/oauth/token",
    register="https://dify.test/mcp/knowledge/oauth/register",
    revocation="https://dify.test/mcp/knowledge/oauth/revoke",
)
CALLBACK = "http://127.0.0.1:33418/callback"


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str | int] = {}

    def get(self, name: str) -> str | int | None:
        return self.values.get(name)

    def setex(self, name: str, _time: int, value: str) -> None:
        self.values[name] = value

    def delete(self, *names: str | bytes) -> int:
        keys = [name.decode() if isinstance(name, bytes) else name for name in names]
        return sum(1 for key in keys if self.values.pop(key, None) is not None)

    def incr(self, name: str) -> int:
        value = int(self.values.get(name, 0)) + 1
        self.values[name] = value
        return value

    def expire(self, _name: str, _time: int) -> None:
        return None


class FakeSpaces:
    """Sharing and per-base switches by base id; records which workspace and member each check ran for."""

    def __init__(self, readable: Iterable[str], blocked: Iterable[str] = ()) -> None:
        self.readable_ids = set(readable)
        self.blocked_ids = set(blocked)
        self.checks: set[tuple[str, str | None]] = set()

    def readable(self, *, tenant_id: str, account_id: str, control_space_ids: Iterable[str]) -> set[str]:
        self.checks.add((tenant_id, account_id))
        return {space_id for space_id in control_space_ids if space_id in self.readable_ids}

    def blocked(self, *, tenant_id: str, control_space_ids: Iterable[str] | None = None) -> set[str]:
        self.checks.add((tenant_id, None))
        if control_space_ids is None:
            return set(self.blocked_ids)
        return {space_id for space_id in control_space_ids if space_id in self.blocked_ids}


@pytest.fixture(autouse=True)
def _no_bearer_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("libs.oauth_bearer.enforce_bearer_rate_limit", lambda _hash: None)


@dataclass
class World:
    tenant: str
    member: str
    admin: str
    member_account: Account
    admin_account: Account
    service: KnowledgeAgentAccessService
    sessions: sessionmaker[Session]
    redis: FakeRedis
    spaces: FakeSpaces
    documents: dict[str, dict[str, object]]


@pytest.fixture
def world(sqlite_session_factory: sessionmaker[Session]) -> Iterator[World]:
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="Acme")
        member = Account(name="Mia", email="mia@example.com", status=AccountStatus.ACTIVE)
        admin = Account(name="Olivia", email="olivia@example.com", status=AccountStatus.ACTIVE)
        session.add_all([tenant, member, admin])
        session.flush()
        session.add_all(
            [
                TenantAccountJoin(tenant_id=tenant.id, account_id=member.id, role=TenantAccountRole.NORMAL),
                TenantAccountJoin(tenant_id=tenant.id, account_id=admin.id, role=TenantAccountRole.OWNER),
            ]
        )
        session.flush()
        session.expunge_all()
    redis = FakeRedis()
    spaces = FakeSpaces(readable={"kb-handbook", "kb-finance", "kb-board"}, blocked={"kb-board"})
    documents: dict[str, dict[str, object]] = {}
    # Stands in for Flask-SQLAlchemy's request-scoped session, which request teardown closes.
    bearer_session = scoped_session(sqlite_session_factory)
    service = KnowledgeAgentAccessService(
        session_maker=sqlite_session_factory,
        bearer_session=bearer_session,
        redis_client=redis,
        spaces=spaces,
        fetch_client_metadata=lambda url: (
            (200, json.dumps(documents[url]).encode()) if url in documents else (404, b"")
        ),
        enabled=lambda: True,
    )
    yield World(
        tenant=tenant.id,
        member=member.id,
        admin=admin.id,
        member_account=member,
        admin_account=admin,
        service=service,
        sessions=sqlite_session_factory,
        redis=redis,
        spaces=spaces,
        documents=documents,
    )
    bearer_session.remove()


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def _authorize(world: World, *, client_id: str, spaces: list[str], redirect_uri: str = CALLBACK) -> dict[str, str]:
    verifier, challenge = _pkce()
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": "s-1",
        "resource": URLS.resource,
    }
    decided = world.service.decide_authorization(
        account=world.member_account,
        tenant_id=world.tenant,
        body={**params, "approve": True, "knowledge_base_ids": spaces},
        urls=URLS,
    )
    query = parse_qs(urlsplit(decided["redirect_to"]).query)
    assert query["state"] == ["s-1"]
    assert query["iss"] == [URLS.issuer]
    return {"code": query["code"][0], "verifier": verifier, "client_id": client_id}


def _register(world: World, name: str = "Claude Code") -> str:
    registered = world.service.register_client(
        {"client_name": name, "redirect_uris": ["http://127.0.0.1/callback"]}, ip_address="10.0.0.1"
    )
    assert registered["token_endpoint_auth_method"] == "none"
    return registered["client_id"]


def _exchange(world: World, flow: dict[str, str]) -> dict[str, str]:
    return world.service.exchange_token(
        {
            "grant_type": "authorization_code",
            "code": flow["code"],
            "client_id": flow["client_id"],
            "code_verifier": flow["verifier"],
            "resource": URLS.resource,
        },
        URLS,
    )


def test_discovery_documents_advertise_pkce_metadata_documents_and_the_resource() -> None:
    resource = KnowledgeAgentAccessService.protected_resource_metadata(URLS)
    assert resource["resource"] == URLS.resource
    assert resource["authorization_servers"] == [URLS.issuer]
    server = KnowledgeAgentAccessService.authorization_server_metadata(URLS)
    assert server["code_challenge_methods_supported"] == ["S256"]
    assert server["client_id_metadata_document_supported"] is True
    assert server["token_endpoint_auth_methods_supported"] == ["none"]
    assert server["authorization_endpoint"] == URLS.authorize


def test_registered_client_signs_in_with_pkce_and_reads_only_its_chosen_bases(world: World) -> None:
    flow = _authorize(world, client_id=_register(world), spaces=["kb-handbook"])
    tokens = _exchange(world, flow)
    assert tokens["access_token"].startswith("dfok_")
    assert tokens["refresh_token"].startswith("dfokr_")
    assert tokens["scope"] == "knowledge:read"

    principal = world.service.authenticate(tokens["access_token"])
    assert isinstance(principal, KnowledgeAgentPrincipal)
    assert principal.control_space_ids == ("kb-handbook",)
    assert principal.client_name == "Claude Code"
    assert world.service.knowledge_bases_for(principal) == {"kb-handbook"}
    # Every permission check runs for the member in the connection's workspace, never wider.
    assert {tenant for tenant, _ in world.spaces.checks} == {world.tenant}
    assert (world.tenant, world.member) in world.spaces.checks

    # Only SHA-256 digests are stored; the row sits in the account's token table.
    with world.sessions() as session:
        row = session.scalar(select(OAuthAccessToken).where(OAuthAccessToken.prefix == "dfok_"))
        assert row is not None
        assert row.token_hash == sha256_hex(tokens["access_token"])
        assert row.account_id == world.member
        assert row.knowledge_agent_grant_id == principal.grant_id


def test_knowledge_agent_bearers_and_account_bearers_never_cross(
    world: World, sqlite_session_factory: sessionmaker[Session]
) -> None:
    tokens = _exchange(world, _authorize(world, client_id=_register(world), spaces=["kb-handbook"]))
    # The openapi authenticator (difyctl, dfoa_) does not resolve knowledge-agent bearers at all.
    general = build_authenticator(sqlite_session_factory, world.redis)
    with pytest.raises(InvalidBearerError):
        general.authenticate(tokens["access_token"])
    # And the knowledge MCP endpoint does not accept device-flow account tokens.
    assert world.service.authenticate("dfoa_" + secrets.token_urlsafe(32)) == KnowledgeAgentAuthFailure(
        401, "invalid_token"
    )
    assert TokenType.for_token(tokens["access_token"]) is TokenType.OAUTH_KNOWLEDGE_AGENT
    assert TokenType.for_token("dfoa_x") is TokenType.OAUTH_ACCOUNT


def test_pkce_resource_and_redirect_are_enforced(world: World) -> None:
    client_id = _register(world)
    flow = _authorize(world, client_id=client_id, spaces=["kb-handbook"])
    with pytest.raises(KnowledgeAgentOAuthError, match="PKCE"):
        world.service.exchange_token(
            {
                **{"grant_type": "authorization_code", "client_id": client_id, "code": flow["code"]},
                "code_verifier": "x" * 43,
            },
            URLS,
        )
    # Loopback redirects may change port (RFC 8252); other hosts may not.
    _authorize(world, client_id=client_id, spaces=["kb-handbook"], redirect_uri="http://127.0.0.1:55555/callback")
    with pytest.raises(KnowledgeAgentAccessError) as foreign:
        _authorize(world, client_id=client_id, spaces=["kb-handbook"], redirect_uri="https://evil.example/cb")
    assert foreign.value.code == "invalid_redirect_uri"
    _, challenge = _pkce()
    with pytest.raises(KnowledgeAgentAccessError) as plain:
        world.service.describe_authorization(
            account=world.member_account,
            tenant_id=world.tenant,
            params={
                "response_type": "code",
                "client_id": client_id,
                "redirect_uri": CALLBACK,
                "code_challenge": challenge,
                "code_challenge_method": "plain",
            },
            urls=URLS,
        )
    assert plain.value.code == "invalid_request"
    with pytest.raises(KnowledgeAgentAccessError) as target:
        world.service.describe_authorization(
            account=world.member_account,
            tenant_id=world.tenant,
            params={
                "response_type": "code",
                "client_id": client_id,
                "redirect_uri": CALLBACK,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "resource": "https://other.example/mcp",
            },
            urls=URLS,
        )
    assert target.value.code == "invalid_target"


def test_a_replayed_code_revokes_what_the_first_exchange_issued(world: World) -> None:
    flow = _authorize(world, client_id=_register(world), spaces=["kb-handbook"])
    tokens = _exchange(world, flow)
    with pytest.raises(KnowledgeAgentOAuthError, match="already used"):
        _exchange(world, flow)
    assert world.service.authenticate(tokens["access_token"]) == KnowledgeAgentAuthFailure(401, "invalid_token")


def test_refresh_tokens_rotate_and_reuse_ends_the_connection(world: World) -> None:
    client_id = _register(world)
    tokens = _exchange(world, _authorize(world, client_id=client_id, spaces=["kb-handbook"]))
    rotated = world.service.exchange_token(
        {"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": client_id}, URLS
    )
    assert rotated["refresh_token"] != tokens["refresh_token"]
    # The bearer row rotates in place: the previous access token stops working.
    assert world.service.authenticate(tokens["access_token"]) == KnowledgeAgentAuthFailure(401, "invalid_token")
    assert isinstance(world.service.authenticate(rotated["access_token"]), KnowledgeAgentPrincipal)
    with pytest.raises(KnowledgeAgentOAuthError, match="already used"):
        world.service.exchange_token(
            {"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": client_id}, URLS
        )
    assert world.service.authenticate(rotated["access_token"]) == KnowledgeAgentAuthFailure(401, "invalid_token")


def test_revocation_endpoint_ends_the_connection(world: World) -> None:
    tokens = _exchange(world, _authorize(world, client_id=_register(world), spaces=["kb-handbook"]))
    world.service.revoke_token({"token": tokens["refresh_token"]})
    assert world.service.authenticate(tokens["access_token"]) == KnowledgeAgentAuthFailure(401, "invalid_token")
    world.service.revoke_token({"token": "unknown"})  # unknown tokens are fine (RFC 7009)


def test_revoking_the_row_from_the_account_session_list_ends_the_connection(
    world: World, sqlite_session_factory: sessionmaker[Session]
) -> None:
    client_id = _register(world)
    tokens = _exchange(world, _authorize(world, client_id=client_id, spaces=["kb-handbook"]))
    repository = SQLAlchemyOAuthAccessTokenRepository(session_factory=sqlite_session_factory)
    total, sessions = repository.list_active(account_id=world.member, active_at=datetime.now(UTC), offset=0, limit=20)
    assert total == 1
    assert sessions[0].prefix == "dfok_"
    revoked = repository.revoke(account_id=world.member, token_id=sessions[0].id, revoked_at=datetime.now(UTC))
    assert revoked.owned
    with pytest.raises(KnowledgeAgentOAuthError):
        world.service.exchange_token(
            {"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": client_id}, URLS
        )


def test_client_metadata_documents_are_fetched_and_validated(world: World) -> None:
    client_id = "https://agent.example/oauth/client.json"
    world.documents[client_id] = {
        "client_id": client_id,
        "client_name": "Example Agent",
        "redirect_uris": ["http://localhost/callback"],
    }
    _, challenge = _pkce()
    base = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": "http://localhost:61000/callback",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    described = world.service.describe_authorization(
        account=world.member_account, tenant_id=world.tenant, params=base, urls=URLS
    )
    assert described["client"] == {"kind": "cimd", "name": "Example Agent", "redirect_host": "localhost:61000"}
    assert described["blocked_knowledge_base_ids"] == ["kb-board"]
    liar = "https://agent.example/liar.json"
    world.documents[liar] = {"client_id": "https://agent.example/other.json", "redirect_uris": [CALLBACK]}
    with pytest.raises(KnowledgeAgentAccessError) as error:
        world.service.describe_authorization(
            account=world.member_account, tenant_id=world.tenant, params={**base, "client_id": liar}, urls=URLS
        )
    assert error.value.code == "invalid_client"
    with pytest.raises(KnowledgeAgentOAuthError) as bad:
        world.service.register_client({"redirect_uris": ["http://evil.example/cb"]}, ip_address="10.0.0.9")
    assert bad.value.error == "invalid_redirect_uri"


def test_personal_tokens_follow_sharing_both_switches_and_membership(world: World) -> None:
    service = world.service
    member = world.member_account
    with pytest.raises(KnowledgeAgentAccessError) as unshared:
        service.create_personal_token(
            account=member,
            tenant_id=world.tenant,
            body={"name": "CI", "knowledge_base_ids": ["kb-handbook", "kb-secret"]},
        )
    assert unshared.value.code == "invalid_knowledge_bases"
    assert unshared.value.details == {"knowledge_base_ids": ["kb-secret"]}
    with pytest.raises(KnowledgeAgentAccessError) as blocked:
        service.create_personal_token(
            account=member, tenant_id=world.tenant, body={"name": "CI", "knowledge_base_ids": ["kb-board"]}
        )
    assert blocked.value.code == "knowledge_base_agent_access_blocked"

    created = service.create_personal_token(
        account=member,
        tenant_id=world.tenant,
        body={"name": "CI", "knowledge_base_ids": ["kb-handbook", "kb-finance"], "expires_in_days": 7},
    )
    token = created["token"]
    assert token.startswith("dfok_")
    assert created["grant"]["kind"] == "personal"
    principal = service.authenticate(token)
    assert isinstance(principal, KnowledgeAgentPrincipal)

    # A manager blocks a base later: the connection loses it at once.
    world.spaces.blocked_ids.add("kb-finance")
    assert service.knowledge_bases_for(principal) == {"kb-handbook"}
    # Sharing revoked later: same.
    world.spaces.readable_ids.discard("kb-handbook")
    assert service.knowledge_bases_for(principal) == set()
    world.spaces.readable_ids.add("kb-handbook")

    # Only admins switch the workspace; then every connection gets 403.
    with pytest.raises(KnowledgeAgentAccessError):
        service.update_workspace_settings(
            account=member, tenant_id=world.tenant, role="normal", body={"enabled": False}
        )
    service.update_workspace_settings(
        account=world.admin_account, tenant_id=world.tenant, role="owner", body={"enabled": False}
    )
    assert service.authenticate(token) == KnowledgeAgentAuthFailure(403, "agent_access_disabled")
    with world.sessions.begin() as session:
        setting = session.get(KnowledgeAgentWorkspaceSetting, world.tenant)
        assert setting is not None
        setting.enabled = True
    assert isinstance(service.authenticate(token), KnowledgeAgentPrincipal)

    # Admins see members' connections and can disconnect them.
    listing = service.workspace_settings(tenant_id=world.tenant, role="owner")
    assert [grant["account"]["email"] for grant in listing["grants"]] == ["mia@example.com"]
    service.revoke_grant(account=world.admin_account, tenant_id=world.tenant, role="owner", grant_id=principal.grant_id)
    assert service.authenticate(token) == KnowledgeAgentAuthFailure(401, "invalid_token")


def test_leaving_the_workspace_ends_connections_on_the_next_request(world: World) -> None:
    service = world.service
    created = service.create_personal_token(
        account=world.member_account,
        tenant_id=world.tenant,
        body={"name": "Laptop", "knowledge_base_ids": ["kb-handbook"]},
    )
    with world.sessions.begin() as session:
        session.query(TenantAccountJoin).filter_by(account_id=world.member).delete()
    assert service.authenticate(created["token"]) == KnowledgeAgentAuthFailure(401, "invalid_token")


def test_connections_can_change_their_bases_and_reconnecting_replaces_the_old_one(world: World) -> None:
    service = world.service
    client_id = _register(world)
    first = _exchange(world, _authorize(world, client_id=client_id, spaces=["kb-handbook"]))
    second = _exchange(world, _authorize(world, client_id=client_id, spaces=["kb-finance"]))
    assert service.authenticate(first["access_token"]) == KnowledgeAgentAuthFailure(401, "invalid_token")
    principal = service.authenticate(second["access_token"])
    assert isinstance(principal, KnowledgeAgentPrincipal)
    updated = service.update_grant(
        account=world.member_account,
        tenant_id=world.tenant,
        grant_id=principal.grant_id,
        body={"knowledge_base_ids": ["kb-handbook", "kb-finance"]},
    )
    assert sorted(updated["knowledge_base_ids"]) == ["kb-finance", "kb-handbook"]
    mine = service.list_mine(account=world.member_account, tenant_id=world.tenant, urls=URLS)
    assert mine["mcp_url"] == URLS.resource
    assert [grant["client_name"] for grant in mine["grants"]] == ["Claude Code"]
    with world.sessions() as session:
        assert session.scalar(select(KnowledgeAgentGrant).where(KnowledgeAgentGrant.revoked_at.is_(None))) is not None


def test_deny_redirects_with_access_denied_and_no_code(world: World) -> None:
    _, challenge = _pkce()
    decided = world.service.decide_authorization(
        account=world.member_account,
        tenant_id=world.tenant,
        body={
            "response_type": "code",
            "client_id": _register(world),
            "redirect_uri": CALLBACK,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "approve": False,
        },
        urls=URLS,
    )
    query = parse_qs(urlsplit(decided["redirect_to"]).query)
    assert query["error"] == ["access_denied"]
    assert "code" not in query


def test_expired_personal_tokens_stop_working(world: World) -> None:
    service = world.service
    created = service.create_personal_token(
        account=world.member_account,
        tenant_id=world.tenant,
        body={"name": "Old", "knowledge_base_ids": ["kb-handbook"]},
    )
    with world.sessions.begin() as session:
        grant = session.scalar(select(KnowledgeAgentGrant).where(KnowledgeAgentGrant.id == created["grant"]["id"]))
        assert grant is not None
        grant.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    assert service.authenticate(created["token"]) == KnowledgeAgentAuthFailure(401, "invalid_token")
