"""Test doubles and flows for knowledge-agent connections, shared by service and controller tests.

The service under test is always the real ``KnowledgeAgentAccessService`` over the SQLite schema;
only Redis and the knowledge-base permission port are replaced.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
from collections.abc import Callable, Generator, Iterable
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, NoReturn, override
from urllib.parse import parse_qs, urlsplit

from sqlalchemy.orm import Session, scoped_session, sessionmaker

from enums.account import TenantAccountRole
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin
from services.knowledge_agent.access_service import KnowledgeAgentAccessService
from services.knowledge_agent.contracts import KnowledgeAgentUrls, utcnow
from services.knowledge_fs.capability_broker import KnowledgeFSIssuedProductCapability
from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.feature_service import KnowledgeFSFeatures
from services.knowledge_fs.product_remote import UnavailableKnowledgeFSProductRemote
from services.knowledge_fs.service_api_authorization import KnowledgeFSServiceApiProfile

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
    """Sharing and per-base switches by base id; records which workspace and member each check ran for.

    ``calls`` lists every lookup in order with the ids it asked about (``None`` for the whole
    workspace), so a test can pin how many lookups an operation costs.
    """

    def __init__(self, readable: Iterable[str], blocked: Iterable[str] = ()) -> None:
        self.readable_ids = set(readable)
        self.blocked_ids = set(blocked)
        self.checks: set[tuple[str, str | None]] = set()
        self.calls: list[tuple[str, tuple[str, ...] | None]] = []

    def readable(self, *, tenant_id: str, account_id: str, control_space_ids: Iterable[str]) -> set[str]:
        ids = tuple(control_space_ids)
        self.checks.add((tenant_id, account_id))
        self.calls.append(("readable", tuple(sorted(ids))))
        return {space_id for space_id in ids if space_id in self.readable_ids}

    def blocked(self, *, tenant_id: str, control_space_ids: Iterable[str] | None = None) -> set[str]:
        self.checks.add((tenant_id, None))
        if control_space_ids is None:
            self.calls.append(("blocked", None))
            return set(self.blocked_ids)
        ids = tuple(control_space_ids)
        self.calls.append(("blocked", tuple(sorted(ids))))
        return {space_id for space_id in ids if space_id in self.blocked_ids}


class DeploymentSwitch:
    """The deployment's agent-connections setting; a test turns it off by clearing ``on``."""

    def __init__(self) -> None:
        self.on = True


class RefusingCapabilityIssuer:
    """The facade's capability issuer in tests that replace its operations: issuing one fails the test."""

    def issue_interactive(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        operation_id: str,
        resource_id: str | None = None,
        trace_id: str | None = None,
    ) -> KnowledgeFSIssuedProductCapability:
        self._refuse(operation_id)

    def issue_namespace_interactive(
        self, *, tenant_id: str, account_id: str, operation_id: str, trace_id: str | None = None
    ) -> KnowledgeFSIssuedProductCapability:
        self._refuse(operation_id)

    def issue_service(
        self,
        *,
        profile: KnowledgeFSServiceApiProfile,
        operation_id: str,
        resource_id: str | None = None,
        trace_id: str | None = None,
    ) -> KnowledgeFSIssuedProductCapability:
        self._refuse(operation_id)

    @staticmethod
    def _refuse(operation_id: str) -> NoReturn:
        raise AssertionError(f"a capability for {operation_id} was not expected")


class FakeKnowledgeFacade(KnowledgeFSDataFacade):
    """The KnowledgeFS data facade as the MCP tools and the Console Tidy routes call it.

    Each of those operations is recorded with its keyword arguments, then raises the failure
    prepared for it in ``failures`` or returns the answer prepared in ``answers``. An operation
    with neither was not expected by the test and fails it. Any other facade operation is the real
    one, over a capability issuer that fails the test and a remote that is not configured.
    """

    def __init__(self) -> None:
        super().__init__(broker=RefusingCapabilityIssuer(), remote=UnavailableKnowledgeFSProductRemote())
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.answers: dict[str, object] = {}
        self.failures: dict[str, Exception] = {}

    def _prepared(self, name: str, kwargs: dict[str, Any]) -> Any:
        self.calls.append((name, kwargs))
        if name in self.failures:
            raise self.failures[name]
        if name not in self.answers:
            raise AssertionError(f"facade.{name} was not expected")
        return self.answers[name]

    def called(self) -> list[str]:
        """The operations reached so far, in order."""
        return [name for name, _ in self.calls]

    @override
    def retrieve_evidence(self, **kwargs: Any) -> Any:
        return self._prepared("retrieve_evidence", kwargs)

    @override
    def grep_knowledge_fs(self, **kwargs: Any) -> Any:
        return self._prepared("grep_knowledge_fs", kwargs)

    @override
    def list_knowledge_fs(self, **kwargs: Any) -> Any:
        return self._prepared("list_knowledge_fs", kwargs)

    @override
    def cat_knowledge_fs(self, **kwargs: Any) -> Any:
        return self._prepared("cat_knowledge_fs", kwargs)

    @override
    def list_logical_documents(self, **kwargs: Any) -> Any:
        return self._prepared("list_logical_documents", kwargs)

    @override
    def get_logical_document(self, **kwargs: Any) -> Any:
        return self._prepared("get_logical_document", kwargs)

    @override
    def get_document_outline(self, **kwargs: Any) -> Any:
        return self._prepared("get_document_outline", kwargs)

    @override
    def list_document_chunks(self, **kwargs: Any) -> Any:
        return self._prepared("list_document_chunks", kwargs)

    @override
    def open_knowledge_fs_node(self, **kwargs: Any) -> Any:
        return self._prepared("open_knowledge_fs_node", kwargs)

    @override
    def get_tidy_settings(self, **kwargs: Any) -> Any:
        return self._prepared("get_tidy_settings", kwargs)

    @override
    def update_tidy_settings(self, **kwargs: Any) -> Any:
        return self._prepared("update_tidy_settings", kwargs)

    @override
    def get_tidy_summary(self, **kwargs: Any) -> Any:
        return self._prepared("get_tidy_summary", kwargs)

    @override
    def list_tidy_findings(self, **kwargs: Any) -> Any:
        return self._prepared("list_tidy_findings", kwargs)

    @override
    def list_tidy_scans(self, **kwargs: Any) -> Any:
        return self._prepared("list_tidy_scans", kwargs)

    @override
    def act_on_tidy_finding(self, **kwargs: Any) -> Any:
        return self._prepared("act_on_tidy_finding", kwargs)

    @override
    def retry_tidy_scans(self, **kwargs: Any) -> Any:
        return self._prepared("retry_tidy_scans", kwargs)


@dataclass(frozen=True)
class FakeKnowledgeRuntime:
    """The two parts of the KnowledgeFS runtime the agent and Tidy routes read."""

    facade: object
    application: object = None


def knowledge_fs_features(*, enabled: bool) -> KnowledgeFSFeatures:
    """The deployment's Agent Knowledge Base availability, on or off."""
    return KnowledgeFSFeatures(enabled=enabled, upload_enabled=enabled, agent_enabled=False)


@dataclass(frozen=True)
class SpaceSummary:
    name: str
    description: str | None = None


@dataclass(frozen=True)
class SpaceRow:
    """One knowledge base of the workspace listing; ``technical_summary`` is absent while it is being built."""

    control_space_id: str
    technical_summary: SpaceSummary | None = None


@dataclass(frozen=True)
class SpaceListing:
    data: list[SpaceRow] = field(default_factory=list)


def json_rows(value: object) -> list[dict[str, Any]]:
    """``value`` as the JSON array of objects a test expects it to be; anything else fails the test."""
    assert isinstance(value, list), value
    assert all(isinstance(row, dict) for row in value), value
    return value


def console_account(account_id: str, role: TenantAccountRole | None) -> Account:
    """A signed-in Console account with its role in the current workspace."""
    account = Account(name="Member", email=f"{account_id}@example.com", status=AccountStatus.ACTIVE)
    account.id = account_id
    account.role = role
    return account


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
    deployment: DeploymentSwitch


@contextmanager
def knowledge_agent_world(
    session_factory: sessionmaker[Session],
    redis: FakeRedis | None = None,
    *,
    clock: Callable[[], datetime] = utcnow,
) -> Generator[World]:
    """Seed the workspace and build the service.

    ``redis`` lets a test supply an instrumented fake and ``clock`` a time it controls.
    """
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
    deployment = DeploymentSwitch()
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
        enabled=lambda: deployment.on,
        clock=clock,
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
            deployment=deployment,
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
