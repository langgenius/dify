"""Test doubles and flows for knowledge-agent connections, shared by service and controller tests.

The service under test is always the real ``KnowledgeAgentAccessService`` over the SQLite schema;
only Redis and the knowledge-base permission port are replaced.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
from collections.abc import Generator, Iterable
from contextlib import contextmanager
from dataclasses import dataclass
from urllib.parse import parse_qs, urlsplit

from sqlalchemy.orm import Session, scoped_session, sessionmaker

from enums.account import TenantAccountRole
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin
from services.knowledge_agent.access_service import KnowledgeAgentAccessService
from services.knowledge_agent.contracts import KnowledgeAgentUrls

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
    """The commands the service uses, over a dict; remembers the expiry each key was given.

    Expiry bookkeeping follows Redis: a key that is deleted loses its expiry, ``INCR`` on a
    missing key creates it without one, and ``EXPIRE`` only applies to keys that exist. Time does
    not pass on its own; a test moves it by editing ``expiries`` or calling ``lapse``.
    """

    def __init__(self) -> None:
        self.values: dict[str, str | int] = {}
        self.expiries: dict[str, int] = {}

    def get(self, name: str) -> str | int | None:
        return self.values.get(name)

    def set(self, name: str, value: str, *, ex: int, nx: bool) -> bool | None:
        if nx and name in self.values:
            return None
        self.values[name] = value
        self.expiries[name] = ex
        return True

    def setex(self, name: str, time: int, value: str) -> None:
        self.values[name] = value
        self.expiries[name] = time

    def delete(self, *names: str | bytes) -> int:
        keys = [name.decode() if isinstance(name, bytes) else name for name in names]
        removed = 0
        for key in keys:
            self.expiries.pop(key, None)
            if self.values.pop(key, None) is not None:
                removed += 1
        return removed

    def incr(self, name: str) -> int:
        value = int(self.values.get(name, 0)) + 1
        self.values[name] = value
        return value

    def expire(self, name: str, time: int) -> bool:
        if name not in self.values:
            return False
        self.expiries[name] = time
        return True

    def ttl(self, name: str) -> int:
        """Seconds left; -2 for a missing key and -1 for a key without an expiry, as in Redis."""
        if name not in self.values:
            return -2
        return self.expiries.get(name, -1)

    def lapse(self, name: str) -> None:
        """The key's expiry has passed: Redis drops the key."""
        self.delete(name)


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


@dataclass
class World:
    """One workspace with a normal member and an owner, and the real service over fakes."""

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


@contextmanager
def knowledge_agent_world(session_factory: sessionmaker[Session], redis: FakeRedis | None = None) -> Generator[World]:
    """Seed the workspace and build the service; ``redis`` lets a test supply an instrumented fake."""
    with session_factory.begin() as session:
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
    redis = redis or FakeRedis()
    spaces = FakeSpaces(readable={"kb-handbook", "kb-finance", "kb-board"}, blocked={"kb-board"})
    documents: dict[str, dict[str, object]] = {}
    # Stands in for Flask-SQLAlchemy's request-scoped session, which request teardown closes.
    bearer_session = scoped_session(session_factory)
    service = KnowledgeAgentAccessService(
        session_maker=session_factory,
        bearer_session=bearer_session,
        redis_client=redis,
        spaces=spaces,
        fetch_client_metadata=lambda url: (
            (200, json.dumps(documents[url]).encode()) if url in documents else (404, b"")
        ),
        enabled=lambda: True,
    )
    try:
        yield World(
            tenant=tenant.id,
            member=member.id,
            admin=admin.id,
            member_account=member,
            admin_account=admin,
            service=service,
            sessions=session_factory,
            redis=redis,
            spaces=spaces,
            documents=documents,
        )
    finally:
        bearer_session.remove()


def pkce() -> tuple[str, str]:
    """A fresh PKCE verifier and its S256 challenge."""
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def authorize(world: World, *, client_id: str, spaces: list[str], redirect_uri: str = CALLBACK) -> dict[str, str]:
    """The member approves a client's authorization request; returns the code and its verifier."""
    verifier, challenge = pkce()
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


def register(world: World, name: str = "Claude Code") -> str:
    """Dynamically register a loopback client and return its client id."""
    registered = world.service.register_client(
        {"client_name": name, "redirect_uris": ["http://127.0.0.1/callback"]}, ip_address="10.0.0.1"
    )
    assert registered["token_endpoint_auth_method"] == "none"
    return registered["client_id"]


def code_form(flow: dict[str, str]) -> dict[str, str]:
    """The token-endpoint form that redeems an authorization code."""
    return {
        "grant_type": "authorization_code",
        "code": flow["code"],
        "client_id": flow["client_id"],
        "code_verifier": flow["verifier"],
        "resource": URLS.resource,
    }


def exchange(world: World, flow: dict[str, str]) -> dict[str, str]:
    """Redeem an authorization code at the token endpoint."""
    return world.service.exchange_token(code_form(flow), URLS)
