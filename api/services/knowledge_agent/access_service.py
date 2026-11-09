"""Personal agents reading Agent Knowledge Bases as the signed-in member.

The platform is its own OAuth 2.1 authorization server for MCP clients (PKCE S256, client ID
metadata documents and dynamic registration, resource-bound tokens) and also mints personal
tokens. Every bearer is a ``dfok_`` row in ``oauth_access_tokens`` linked to one connection
(``KnowledgeAgentGrant``): one account, one workspace, the knowledge bases chosen for it. Effective
access is re-evaluated on every request: account, membership, the workspace switch, the
knowledge bases' own switches and the member's current permissions.
"""

from __future__ import annotations

import json
import logging
import secrets
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, NamedTuple, Protocol, overload
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import TokenType
from enums.account import TenantAccountRole
from libs.oauth_bearer import (
    BearerAuthenticator,
    InvalidBearerError,
    OAuthAccessTokenResolver,
    invalidate_oauth_token_cache,
)
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin
from models.knowledge_agent import (
    KnowledgeAgentClient,
    KnowledgeAgentGrant,
    KnowledgeAgentGrantSpace,
    KnowledgeAgentRefreshToken,
    KnowledgeAgentWorkspaceSetting,
)
from models.oauth import OAuthAccessToken
from services.knowledge_agent.oauth import (
    ACCESS_TOKEN_PREFIX,
    ACCESS_TOKEN_TTL_SECONDS,
    AUTHORIZATION_CODE_TTL_SECONDS,
    DCR_CLIENT_ID_PREFIX,
    DEFAULT_KNOWLEDGE_AGENT_SCOPE,
    KNOWLEDGE_AGENT_SCOPES,
    MAX_GRANT_KNOWLEDGE_BASES,
    PERSONAL_TOKEN_DEFAULT_DAYS,
    PERSONAL_TOKEN_MAX_DAYS,
    REFRESH_TOKEN_PREFIX,
    REFRESH_TOKEN_TTL_SECONDS,
    TOKEN_ROW_CLIENT_ID,
    KnowledgeAgentOAuthError,
    client_display_name,
    is_client_metadata_url,
    is_pkce_challenge,
    parse_requested_scopes,
    redirect_uri_matches,
    same_resource,
    sha256_hex,
    validate_redirect_uri,
    verify_pkce,
)
from services.oauth_device_contracts import ACCOUNT_ISSUER_SENTINEL

logger = logging.getLogger(__name__)

AUDIT_GRANT_CREATED = "knowledge_agent.grant_created"
AUDIT_GRANT_REVOKED = "knowledge_agent.grant_revoked"

_CLIENT_METADATA_TTL = timedelta(hours=24)
_CLIENT_METADATA_MAX_BYTES = 64 * 1024
_DCR_IDLE_RETENTION = timedelta(days=30)
_DCR_PER_IP_PER_HOUR = 20
_CODE_REPLAY_MEMORY_SECONDS = 600
_TOUCH_INTERVAL = timedelta(minutes=5)
_MAX_REDIRECT_URIS = 10
_CODE_KEY = "knowledge_agent:code:{hash}"
_CODE_USED_KEY = "knowledge_agent:code_used:{hash}"
_DCR_RATE_KEY = "knowledge_agent:dcr:{ip}"


class KnowledgeAgentAccessError(Exception):
    """A client-visible failure of a Console call (consent page, connection management)."""

    def __init__(self, status: int, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details or {}


class KnowledgeAgentUrls(NamedTuple):
    """Public URLs; the MCP resource and the token endpoints live on the API host."""

    issuer: str
    resource: str
    authorize: str
    token: str
    register: str
    revocation: str


@dataclass(frozen=True, slots=True)
class KnowledgeAgentPrincipal:
    account_id: str
    tenant_id: str
    grant_id: str
    token_id: str
    kind: str
    client_name: str
    control_space_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class KnowledgeAgentAuthFailure:
    status: int
    error: str


class KnowledgeAgentSpacePort(Protocol):
    """The member's current view of the workspace's knowledge bases."""

    def readable(self, *, tenant_id: str, account_id: str, control_space_ids: Iterable[str]) -> set[str]:
        """Active knowledge bases among the ids the member may read now."""
        ...

    def blocked(self, *, tenant_id: str, control_space_ids: Iterable[str] | None = None) -> set[str]:
        """Knowledge bases whose managers turned personal agents off."""
        ...


class _Redis(Protocol):
    def get(self, name: str, /) -> Any: ...

    def setex(self, name: str, time: int, value: str, /) -> Any: ...

    def delete(self, *names: str | bytes) -> int: ...

    def incr(self, name: str, /) -> int: ...

    def expire(self, name: str, time: int, /) -> Any: ...


ClientMetadataFetcher = Callable[[str], tuple[int, bytes]]


def _utcnow() -> datetime:
    return datetime.now(UTC)


@overload
def _aware(value: datetime) -> datetime: ...


@overload
def _aware(value: datetime | None) -> datetime | None: ...


def _aware(value: datetime | None) -> datetime | None:
    """Dialects without zone-aware DATETIME (MySQL, SQLite) return naive values stored in UTC."""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


class KnowledgeAgentAccessService:
    def __init__(
        self,
        *,
        session_maker: sessionmaker[Session],
        bearer_session: Callable[[], Session],
        redis_client: _Redis,
        spaces: KnowledgeAgentSpacePort,
        fetch_client_metadata: ClientMetadataFetcher | None,
        enabled: Callable[[], bool],
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._sessions = session_maker
        self._redis = redis_client
        self._spaces = spaces
        self._fetch_client_metadata = fetch_client_metadata
        self._enabled = enabled
        self._now = clock
        # The shared bearer resolver neither closes nor scopes its session: like the OpenAPI
        # authenticator, it gets the request-scoped session, which request teardown closes.
        self._resolver = OAuthAccessTokenResolver(bearer_session, redis_client)
        # Only the knowledge MCP endpoint resolves knowledge-agent bearers.
        self._authenticator = BearerAuthenticator(
            {TokenType.OAUTH_KNOWLEDGE_AGENT: self._resolver.for_token_type(TokenType.OAUTH_KNOWLEDGE_AGENT)}
        )

    # -- Discovery ----------------------------------------------------------------------------

    @staticmethod
    def protected_resource_metadata(urls: KnowledgeAgentUrls) -> dict[str, Any]:
        """RFC 9728 metadata for the knowledge MCP endpoint."""
        return {
            "resource": urls.resource,
            "authorization_servers": [urls.issuer],
            "bearer_methods_supported": ["header"],
            "resource_name": "Dify Agent Knowledge Base",
            "scopes_supported": list(KNOWLEDGE_AGENT_SCOPES),
        }

    @staticmethod
    def authorization_server_metadata(urls: KnowledgeAgentUrls) -> dict[str, Any]:
        """RFC 8414 metadata: PKCE S256 only, public clients, metadata documents and registration."""
        return {
            "issuer": urls.issuer,
            "authorization_endpoint": urls.authorize,
            "token_endpoint": urls.token,
            "registration_endpoint": urls.register,
            "revocation_endpoint": urls.revocation,
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": ["none"],
            "revocation_endpoint_auth_methods_supported": ["none"],
            "scopes_supported": list(KNOWLEDGE_AGENT_SCOPES),
            "client_id_metadata_document_supported": True,
            "authorization_response_iss_parameter_supported": True,
        }

    def require_enabled(self) -> None:
        if not self._enabled():
            raise KnowledgeAgentAccessError(404, "agent_access_unavailable", "Agent connections are not enabled")

    # -- Clients ------------------------------------------------------------------------------

    def register_client(self, body: dict[str, Any], *, ip_address: str | None) -> dict[str, Any]:
        """RFC 7591 registration of a public client (secret-based methods are replaced, §3.2.1)."""
        rate_key = _DCR_RATE_KEY.format(ip=ip_address or "unknown")
        count = self._redis.incr(rate_key)
        if count == 1:
            self._redis.expire(rate_key, 3600)
        if count > _DCR_PER_IP_PER_HOUR:
            raise KnowledgeAgentOAuthError("slow_down", "Too many client registrations; try again later", 429)
        raw_uris = body.get("redirect_uris")
        uris = [validate_redirect_uri(uri) for uri in raw_uris] if isinstance(raw_uris, list) else []
        if not uris or len(uris) > _MAX_REDIRECT_URIS or any(uri is None for uri in uris):
            raise KnowledgeAgentOAuthError(
                "invalid_redirect_uri", "redirect_uris must list 1-10 HTTPS or loopback HTTP URLs"
            )
        grant_types = body.get("grant_types")
        if grant_types is not None and (not isinstance(grant_types, list) or "authorization_code" not in grant_types):
            raise KnowledgeAgentOAuthError("invalid_client_metadata", "grant_types must include authorization_code")
        name = client_display_name(body.get("client_name"), "MCP client")
        client_id = f"{DCR_CLIENT_ID_PREFIX}{secrets.token_urlsafe(18)}"
        now = self._now()
        with self._sessions.begin() as session:
            session.add(
                KnowledgeAgentClient(
                    client_id=client_id,
                    client_id_hash=sha256_hex(client_id),
                    kind="dcr",
                    name=name,
                    redirect_uris=[uri for uri in uris if uri],
                )
            )
            # Registrations nobody used within the retention window are garbage.
            active_grant = sa.exists().where(
                KnowledgeAgentGrant.client_ref == KnowledgeAgentClient.id,
                KnowledgeAgentGrant.revoked_at.is_(None),
            )
            session.execute(
                sa.delete(KnowledgeAgentClient)
                .where(
                    KnowledgeAgentClient.kind == "dcr",
                    sa.func.coalesce(KnowledgeAgentClient.last_used_at, KnowledgeAgentClient.created_at)
                    < now - _DCR_IDLE_RETENTION,
                    ~active_grant,
                )
                .execution_options(synchronize_session=False)
            )
        return {
            "client_id": client_id,
            "client_id_issued_at": int(now.timestamp()),
            "client_name": name,
            "redirect_uris": uris,
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        }

    def _load_client(self, session: Session, client_id: str) -> KnowledgeAgentClient | None:
        return session.scalar(
            sa.select(KnowledgeAgentClient).where(KnowledgeAgentClient.client_id_hash == sha256_hex(client_id))
        )

    def _resolve_client(self, raw_client_id: object) -> KnowledgeAgentClient:
        if not isinstance(raw_client_id, str) or not raw_client_id:
            raise KnowledgeAgentAccessError(422, "invalid_client", "client_id is required")
        with self._sessions() as session:
            cached = self._load_client(session, raw_client_id)
            if cached is not None:
                session.expunge(cached)
        if not is_client_metadata_url(raw_client_id):
            if cached is None or cached.kind != "dcr":
                raise KnowledgeAgentAccessError(422, "invalid_client", "Unknown client")
            return cached
        fetched_at = _aware(cached.metadata_fetched_at) if cached else None
        if cached is not None and fetched_at is not None and self._now() - fetched_at < _CLIENT_METADATA_TTL:
            return cached
        try:
            name, uris = self._fetch_metadata_document(raw_client_id)
        except KnowledgeAgentAccessError:
            # A stale copy keeps known clients working through a metadata host outage.
            if cached is not None:
                return cached
            raise
        with self._sessions.begin() as session:
            row = self._load_client(session, raw_client_id)
            if row is None:
                row = KnowledgeAgentClient(
                    client_id=raw_client_id,
                    client_id_hash=sha256_hex(raw_client_id),
                    kind="cimd",
                    name=name,
                    redirect_uris=uris,
                )
                session.add(row)
            row.name = name
            row.redirect_uris = uris
            row.metadata_fetched_at = self._now()
            session.flush()
            session.expunge(row)
            return row

    def _fetch_metadata_document(self, client_id: str) -> tuple[str, list[str]]:
        if self._fetch_client_metadata is None:
            raise KnowledgeAgentAccessError(422, "invalid_client", "Client metadata documents are not supported")
        try:
            status, body = self._fetch_client_metadata(client_id)
        except Exception:
            logger.info("knowledge agent client metadata fetch failed", exc_info=True)
            raise KnowledgeAgentAccessError(
                422, "invalid_client", "The client metadata document could not be fetched"
            ) from None
        if status != 200 or len(body) > _CLIENT_METADATA_MAX_BYTES:
            raise KnowledgeAgentAccessError(422, "invalid_client", "The client metadata document could not be fetched")
        try:
            document = json.loads(body)
        except ValueError:
            raise KnowledgeAgentAccessError(
                422, "invalid_client", "The client metadata document is not valid JSON"
            ) from None
        if not isinstance(document, dict) or document.get("client_id") != client_id:
            raise KnowledgeAgentAccessError(
                422, "invalid_client", "The client metadata document names a different client"
            )
        raw_uris = document.get("redirect_uris")
        uris = [validate_redirect_uri(uri) for uri in raw_uris] if isinstance(raw_uris, list) else []
        if not uris or len(uris) > _MAX_REDIRECT_URIS or any(uri is None for uri in uris):
            raise KnowledgeAgentAccessError(
                422, "invalid_client", "The client metadata document has invalid redirect URIs"
            )
        hostname = urlsplit(client_id).hostname or "MCP client"
        return client_display_name(document.get("client_name"), hostname), [uri for uri in uris if uri]

    # -- Authorization (Console consent page) ---------------------------------------------------

    def _parse_authorization_request(self, params: dict[str, Any], urls: KnowledgeAgentUrls) -> dict[str, Any]:
        if params.get("response_type") != "code":
            raise KnowledgeAgentAccessError(422, "unsupported_response_type", "response_type must be code")
        client = self._resolve_client(params.get("client_id"))
        redirect_uri = params.get("redirect_uri")
        if not isinstance(redirect_uri, str) or not redirect_uri_matches(list(client.redirect_uris), redirect_uri):
            raise KnowledgeAgentAccessError(
                422, "invalid_redirect_uri", "redirect_uri is not registered for this client"
            )
        if params.get("code_challenge_method") != "S256" or not is_pkce_challenge(params.get("code_challenge")):
            raise KnowledgeAgentAccessError(422, "invalid_request", "PKCE with code_challenge_method=S256 is required")
        resource = params.get("resource")
        if resource not in (None, "") and (not isinstance(resource, str) or not same_resource(resource, urls.resource)):
            raise KnowledgeAgentAccessError(422, "invalid_target", "resource must be this server's MCP endpoint")
        state = params.get("state") if isinstance(params.get("state"), str) and params.get("state") else None
        if state and len(state) > 1024:
            raise KnowledgeAgentAccessError(422, "invalid_request", "state is too long")
        scope = params.get("scope")
        return {
            "client": client,
            "redirect_uri": redirect_uri,
            "code_challenge": params["code_challenge"],
            "state": state,
            "scopes": parse_requested_scopes(scope if isinstance(scope, str) else None),
        }

    def describe_authorization(
        self, *, account: Account, tenant_id: str, params: dict[str, Any], urls: KnowledgeAgentUrls
    ) -> dict[str, Any]:
        self.require_enabled()
        request = self._parse_authorization_request(params, urls)
        with self._sessions() as session:
            tenant_name = session.scalar(sa.select(Tenant.name).where(Tenant.id == tenant_id)) or ""
        return {
            "agent_access_enabled": self._workspace_enabled(tenant_id),
            "blocked_knowledge_base_ids": sorted(self._spaces.blocked(tenant_id=tenant_id)),
            "client": {
                "kind": request["client"].kind,
                "name": request["client"].name,
                "redirect_host": urlsplit(request["redirect_uri"]).netloc,
            },
            "scopes": request["scopes"],
            "workspace": {"id": tenant_id, "name": tenant_name},
        }

    def decide_authorization(
        self, *, account: Account, tenant_id: str, body: dict[str, Any], urls: KnowledgeAgentUrls
    ) -> dict[str, str]:
        self.require_enabled()
        request = self._parse_authorization_request(body, urls)
        redirect = _with_query(
            request["redirect_uri"], {"iss": urls.issuer, **({"state": request["state"]} if request["state"] else {})}
        )
        if body.get("approve") is not True:
            return {"redirect_to": _with_query(redirect, {"error": "access_denied"})}
        if not self._workspace_enabled(tenant_id):
            raise KnowledgeAgentAccessError(
                403, "agent_access_disabled", "Agent access is turned off for this workspace"
            )
        space_ids = self._check_knowledge_bases(
            account_id=account.id, tenant_id=tenant_id, raw=body.get("knowledge_base_ids")
        )
        code = secrets.token_urlsafe(32)
        payload = {
            "client_ref": request["client"].id,
            "client_id": request["client"].client_id,
            "client_name": request["client"].name,
            "account_id": account.id,
            "tenant_id": tenant_id,
            "scopes": request["scopes"],
            "space_ids": space_ids,
            "redirect_uri": request["redirect_uri"],
            "code_challenge": request["code_challenge"],
            "resource": urls.resource,
        }
        self._redis.setex(_CODE_KEY.format(hash=sha256_hex(code)), AUTHORIZATION_CODE_TTL_SECONDS, json.dumps(payload))
        return {"redirect_to": _with_query(redirect, {"code": code})}

    def _check_knowledge_bases(self, *, account_id: str, tenant_id: str, raw: object) -> list[str]:
        if not isinstance(raw, list) or not raw or len(raw) > MAX_GRANT_KNOWLEDGE_BASES:
            raise KnowledgeAgentAccessError(
                422,
                "invalid_knowledge_bases",
                f"Choose between 1 and {MAX_GRANT_KNOWLEDGE_BASES} knowledge bases",
            )
        ids = list(dict.fromkeys(raw))
        if any(not isinstance(item, str) or not item for item in ids):
            raise KnowledgeAgentAccessError(422, "invalid_knowledge_bases", "Knowledge base ids must be strings")
        readable = self._spaces.readable(tenant_id=tenant_id, account_id=account_id, control_space_ids=ids)
        rejected = [item for item in ids if item not in readable]
        if rejected:
            raise KnowledgeAgentAccessError(
                422,
                "invalid_knowledge_bases",
                "Some knowledge bases are not available",
                {"knowledge_base_ids": rejected},
            )
        blocked = self._spaces.blocked(tenant_id=tenant_id, control_space_ids=ids)
        blocked_ids = [item for item in ids if item in blocked]
        if blocked_ids:
            raise KnowledgeAgentAccessError(
                422,
                "knowledge_base_agent_access_blocked",
                "Agent access is turned off for some knowledge bases",
                {"knowledge_base_ids": blocked_ids},
            )
        return ids

    # -- Token endpoint -------------------------------------------------------------------------

    def exchange_token(self, form: dict[str, Any], urls: KnowledgeAgentUrls) -> dict[str, Any]:
        if not self._enabled():
            raise KnowledgeAgentOAuthError("invalid_request", "Agent connections are not enabled", 400)
        grant_type = form.get("grant_type")
        if grant_type == "authorization_code":
            outcome = self._exchange_code(form, urls)
        elif grant_type == "refresh_token":
            outcome = self._refresh(form)
        else:
            raise KnowledgeAgentOAuthError(
                "unsupported_grant_type", "grant_type must be authorization_code or refresh_token"
            )
        if isinstance(outcome, KnowledgeAgentOAuthError):
            raise outcome
        return outcome

    def _exchange_code(
        self, form: dict[str, Any], urls: KnowledgeAgentUrls
    ) -> dict[str, Any] | KnowledgeAgentOAuthError:
        code = form.get("code") if isinstance(form.get("code"), str) else ""
        client_id = form.get("client_id")
        if not code or not isinstance(client_id, str):
            raise KnowledgeAgentOAuthError("invalid_request", "code and client_id are required")
        code_hash = sha256_hex(code)
        raw = self._redis.get(_CODE_KEY.format(hash=code_hash))
        # Single use: only the caller whose delete removes the key may redeem it.
        if raw is None or self._redis.delete(_CODE_KEY.format(hash=code_hash)) != 1:
            used = self._redis.get(_CODE_USED_KEY.format(hash=code_hash))
            if used is not None:
                # A replayed code may be stolen: end what the first exchange issued (RFC 6749 §4.1.2).
                grant_id = used.decode() if isinstance(used, bytes) else str(used)
                with self._sessions.begin() as session:
                    self._revoke_grant(session, grant_id, reason="authorization_code_replayed")
                return KnowledgeAgentOAuthError("invalid_grant", "The authorization code was already used")
            return KnowledgeAgentOAuthError("invalid_grant", "The authorization code is invalid or expired")
        payload = json.loads(raw)
        if payload["client_id"] != client_id:
            return KnowledgeAgentOAuthError("invalid_grant", "The authorization code is invalid")
        if form.get("redirect_uri") not in (None, payload["redirect_uri"]):
            return KnowledgeAgentOAuthError("invalid_grant", "redirect_uri does not match the authorization")
        resource = form.get("resource")
        if isinstance(resource, str) and resource and not same_resource(resource, payload["resource"]):
            return KnowledgeAgentOAuthError("invalid_target", "resource does not match the authorization")
        if not verify_pkce(form.get("code_verifier"), payload["code_challenge"]):
            return KnowledgeAgentOAuthError("invalid_grant", "PKCE verification failed")
        with self._sessions.begin() as session:
            # Connecting the same client again in the same workspace replaces the earlier connection.
            previous = session.scalars(
                sa.select(KnowledgeAgentGrant.id).where(
                    KnowledgeAgentGrant.account_id == payload["account_id"],
                    KnowledgeAgentGrant.tenant_id == payload["tenant_id"],
                    KnowledgeAgentGrant.client_ref == payload["client_ref"],
                    KnowledgeAgentGrant.revoked_at.is_(None),
                )
            ).all()
            for grant_id in previous:
                self._revoke_grant(session, grant_id, reason="replaced")
            grant = self._create_grant(
                session,
                account_id=payload["account_id"],
                tenant_id=payload["tenant_id"],
                kind="oauth",
                name=payload["client_name"],
                scopes=payload["scopes"],
                space_ids=payload["space_ids"],
                client_ref=payload["client_ref"],
                expires_at=None,
            )
            session.execute(
                sa.update(KnowledgeAgentClient)
                .where(KnowledgeAgentClient.id == payload["client_ref"])
                .values(last_used_at=self._now())
                .execution_options(synchronize_session=False)
            )
            tokens = self._issue_tokens(session, grant)
            grant_id = grant.id
        self._redis.setex(_CODE_USED_KEY.format(hash=code_hash), _CODE_REPLAY_MEMORY_SECONDS, grant_id)
        return tokens

    def _refresh(self, form: dict[str, Any]) -> dict[str, Any] | KnowledgeAgentOAuthError:
        refresh_token = form.get("refresh_token") if isinstance(form.get("refresh_token"), str) else ""
        if not refresh_token.startswith(REFRESH_TOKEN_PREFIX):
            return KnowledgeAgentOAuthError("invalid_grant", "The refresh token is invalid")
        with self._sessions.begin() as session:
            row = session.scalar(
                sa.select(KnowledgeAgentRefreshToken)
                .where(KnowledgeAgentRefreshToken.token_hash == sha256_hex(refresh_token))
                .with_for_update()
            )
            grant = session.get(KnowledgeAgentGrant, row.grant_id) if row else None
            if row is None or grant is None or grant.revoked_at is not None:
                return KnowledgeAgentOAuthError("invalid_grant", "The refresh token is invalid")
            client = session.get(KnowledgeAgentClient, grant.client_ref) if grant.client_ref else None
            if isinstance(form.get("client_id"), str) and (client is None or form["client_id"] != client.client_id):
                return KnowledgeAgentOAuthError("invalid_grant", "The refresh token belongs to another client")
            if row.rotated_at is not None:
                # Refresh tokens rotate: a second use means a copy leaked. End the whole connection.
                self._revoke_grant(session, grant.id, reason="refresh_token_reused")
                return KnowledgeAgentOAuthError("invalid_grant", "The refresh token was already used")
            if _aware(row.expires_at) <= self._now() or not self._member_active(session, grant):
                return KnowledgeAgentOAuthError("invalid_grant", "The refresh token is no longer valid")
            row.rotated_at = self._now()
            return self._issue_tokens(session, grant)

    def revoke_token(self, form: dict[str, Any]) -> None:
        """RFC 7009: revoking any token of a connection ends the connection; unknown tokens are fine."""
        token = form.get("token") if isinstance(form.get("token"), str) else ""
        if not token:
            raise KnowledgeAgentOAuthError("invalid_request", "token is required")
        token_hash = sha256_hex(token)
        with self._sessions.begin() as session:
            grant_id = session.scalar(
                sa.select(OAuthAccessToken.knowledge_agent_grant_id).where(OAuthAccessToken.token_hash == token_hash)
            ) or session.scalar(
                sa.select(KnowledgeAgentRefreshToken.grant_id).where(
                    KnowledgeAgentRefreshToken.token_hash == token_hash
                )
            )
            if grant_id:
                self._revoke_grant(session, grant_id, reason="client_revocation")

    # -- Grants and tokens ----------------------------------------------------------------------

    def _create_grant(
        self,
        session: Session,
        *,
        account_id: str,
        tenant_id: str,
        kind: str,
        name: str,
        scopes: list[str],
        space_ids: list[str],
        client_ref: str | None,
        expires_at: datetime | None,
    ) -> KnowledgeAgentGrant:
        grant = KnowledgeAgentGrant(
            tenant_id=tenant_id,
            account_id=account_id,
            kind=kind,
            name=name[:255],
            scope=" ".join(scopes) or DEFAULT_KNOWLEDGE_AGENT_SCOPE,
            client_ref=client_ref,
            expires_at=expires_at,
        )
        session.add(grant)
        session.flush()
        session.add_all(
            KnowledgeAgentGrantSpace(grant_id=grant.id, control_space_id=space_id, tenant_id=tenant_id)
            for space_id in space_ids
        )
        logger.info(
            "audit: %s grant_id=%s kind=%s",
            AUDIT_GRANT_CREATED,
            grant.id,
            kind,
            extra={"audit": True, "grant_id": grant.id, "account_id": account_id, "tenant_id": tenant_id},
        )
        return grant

    def _token_row_label(self, session: Session, grant: KnowledgeAgentGrant) -> str:
        tenant_name = session.scalar(sa.select(Tenant.name).where(Tenant.id == grant.tenant_id)) or ""
        # The id suffix keeps the (email, issuer, client, label) uniqueness of the token table.
        return f"{grant.name} · {tenant_name} · {grant.id[:8]}"[:255]

    def _upsert_bearer(self, session: Session, grant: KnowledgeAgentGrant, expires_at: datetime) -> str:
        """One bearer row per connection, rotated in place like the device-flow tokens."""
        token = f"{ACCESS_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"
        row = session.scalar(
            sa.select(OAuthAccessToken).where(OAuthAccessToken.knowledge_agent_grant_id == grant.id).with_for_update()
        )
        previous_hash = row.token_hash if row else None
        if row is None:
            account = session.get(Account, grant.account_id)
            row = OAuthAccessToken(
                subject_email=account.email if account else "",
                client_id=TOKEN_ROW_CLIENT_ID,
                device_label=self._token_row_label(session, grant),
                prefix=ACCESS_TOKEN_PREFIX,
                expires_at=expires_at,
                subject_issuer=ACCOUNT_ISSUER_SENTINEL,
                account_id=grant.account_id,
                token_hash=sha256_hex(token),
                knowledge_agent_grant_id=grant.id,
            )
            session.add(row)
        else:
            row.token_hash = sha256_hex(token)
            row.expires_at = expires_at
            row.revoked_at = None
        session.flush()
        if previous_hash:
            invalidate_oauth_token_cache(self._redis, previous_hash)
        return token

    def _issue_tokens(self, session: Session, grant: KnowledgeAgentGrant) -> dict[str, Any]:
        now = self._now()
        access_token = self._upsert_bearer(session, grant, now + timedelta(seconds=ACCESS_TOKEN_TTL_SECONDS))
        refresh_token = f"{REFRESH_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"
        session.add(
            KnowledgeAgentRefreshToken(
                grant_id=grant.id,
                token_hash=sha256_hex(refresh_token),
                expires_at=now + timedelta(seconds=REFRESH_TOKEN_TTL_SECONDS),
            )
        )
        session.execute(
            sa.delete(KnowledgeAgentRefreshToken)
            .where(
                KnowledgeAgentRefreshToken.grant_id == grant.id,
                KnowledgeAgentRefreshToken.expires_at < now,
            )
            .execution_options(synchronize_session=False)
        )
        return {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": ACCESS_TOKEN_TTL_SECONDS,
            "refresh_token": refresh_token,
            "scope": grant.scope,
        }

    def _revoke_grant(self, session: Session, grant_id: str, *, reason: str) -> None:
        now = self._now()
        result = session.execute(
            sa.update(KnowledgeAgentGrant)
            .where(KnowledgeAgentGrant.id == grant_id, KnowledgeAgentGrant.revoked_at.is_(None))
            .values(revoked_at=now)
            .execution_options(synchronize_session=False)
        )
        hashes = session.scalars(
            sa.select(OAuthAccessToken.token_hash).where(
                OAuthAccessToken.knowledge_agent_grant_id == grant_id,
                OAuthAccessToken.token_hash.is_not(None),
            )
        ).all()
        session.execute(
            sa.update(OAuthAccessToken)
            .where(OAuthAccessToken.knowledge_agent_grant_id == grant_id, OAuthAccessToken.revoked_at.is_(None))
            .values(revoked_at=now, token_hash=None)
            .execution_options(synchronize_session=False)
        )
        session.execute(
            sa.delete(KnowledgeAgentRefreshToken)
            .where(KnowledgeAgentRefreshToken.grant_id == grant_id)
            .execution_options(synchronize_session=False)
        )
        for token_hash in hashes:
            if token_hash:
                invalidate_oauth_token_cache(self._redis, token_hash)
        if getattr(result, "rowcount", 0) == 1:
            logger.info(
                "audit: %s grant_id=%s reason=%s",
                AUDIT_GRANT_REVOKED,
                grant_id,
                reason,
                extra={"audit": True, "grant_id": grant_id, "reason": reason},
            )

    def _member_active(self, session: Session, grant: KnowledgeAgentGrant) -> bool:
        status = session.scalar(sa.select(Account.status).where(Account.id == grant.account_id))
        member = session.scalar(
            sa.select(TenantAccountJoin.id).where(
                TenantAccountJoin.tenant_id == grant.tenant_id,
                TenantAccountJoin.account_id == grant.account_id,
            )
        )
        return status == AccountStatus.ACTIVE and member is not None

    def _workspace_enabled(self, tenant_id: str) -> bool:
        with self._sessions() as session:
            enabled = session.scalar(
                sa.select(KnowledgeAgentWorkspaceSetting.enabled).where(
                    KnowledgeAgentWorkspaceSetting.tenant_id == tenant_id
                )
            )
        return True if enabled is None else bool(enabled)

    # -- Bearer authentication (MCP) --------------------------------------------------------------

    def authenticate(self, token: str) -> KnowledgeAgentPrincipal | KnowledgeAgentAuthFailure:
        invalid = KnowledgeAgentAuthFailure(401, "invalid_token")
        try:
            context = self._authenticator.authenticate(token)
        except InvalidBearerError:
            return invalid
        now = self._now()
        with self._sessions.begin() as session:
            row = session.get(OAuthAccessToken, str(context.token_id))
            grant = (
                session.get(KnowledgeAgentGrant, row.knowledge_agent_grant_id)
                if row is not None and row.knowledge_agent_grant_id
                else None
            )
            if (
                grant is None
                or grant.revoked_at is not None
                or (grant.expires_at is not None and _aware(grant.expires_at) <= now)
                or not self._member_active(session, grant)
            ):
                return invalid
            if not self._enabled():
                return KnowledgeAgentAuthFailure(404, "agent_access_unavailable")
            enabled = session.scalar(
                sa.select(KnowledgeAgentWorkspaceSetting.enabled).where(
                    KnowledgeAgentWorkspaceSetting.tenant_id == grant.tenant_id
                )
            )
            if enabled is False:
                return KnowledgeAgentAuthFailure(403, "agent_access_disabled")
            last_used = _aware(grant.last_used_at)
            if last_used is None or now - last_used > _TOUCH_INTERVAL:
                grant.last_used_at = now
                if row is not None:
                    row.last_used_at = now
            client_name = grant.name
            if grant.client_ref:
                client_name = (
                    session.scalar(
                        sa.select(KnowledgeAgentClient.name).where(KnowledgeAgentClient.id == grant.client_ref)
                    )
                    or grant.name
                )
            space_ids = tuple(
                session.scalars(
                    sa.select(KnowledgeAgentGrantSpace.control_space_id).where(
                        KnowledgeAgentGrantSpace.grant_id == grant.id
                    )
                ).all()
            )
            return KnowledgeAgentPrincipal(
                account_id=grant.account_id,
                tenant_id=grant.tenant_id,
                grant_id=grant.id,
                token_id=str(context.token_id),
                kind=grant.kind,
                client_name=client_name,
                control_space_ids=space_ids,
            )

    def knowledge_bases_for(self, principal: KnowledgeAgentPrincipal) -> set[str]:
        """Bases this connection may use now: chosen, readable by the member, not blocked."""
        readable = self._spaces.readable(
            tenant_id=principal.tenant_id,
            account_id=principal.account_id,
            control_space_ids=principal.control_space_ids,
        )
        return readable - self._spaces.blocked(tenant_id=principal.tenant_id, control_space_ids=readable)

    # -- Connections (Console) -------------------------------------------------------------------

    def _grant_views(self, session: Session, where: Iterable[Any], *, with_account: bool) -> list[dict[str, Any]]:
        now = self._now()
        grants = session.scalars(
            sa.select(KnowledgeAgentGrant)
            .where(
                *where,
                KnowledgeAgentGrant.revoked_at.is_(None),
                sa.or_(KnowledgeAgentGrant.expires_at.is_(None), KnowledgeAgentGrant.expires_at > now),
            )
            .order_by(KnowledgeAgentGrant.created_at.desc(), KnowledgeAgentGrant.id.desc())
            .limit(500)
        ).all()
        if not grants:
            return []
        ids = [grant.id for grant in grants]
        spaces: dict[str, list[str]] = {}
        for grant_id, space_id in session.execute(
            sa.select(KnowledgeAgentGrantSpace.grant_id, KnowledgeAgentGrantSpace.control_space_id).where(
                KnowledgeAgentGrantSpace.grant_id.in_(ids)
            )
        ):
            spaces.setdefault(grant_id, []).append(space_id)
        clients = dict(
            session.execute(
                sa.select(KnowledgeAgentClient.id, KnowledgeAgentClient.name).where(
                    KnowledgeAgentClient.id.in_([grant.client_ref for grant in grants if grant.client_ref])
                )
            )
            .tuples()
            .all()
        )
        accounts: dict[str, tuple[str, str]] = {}
        if with_account:
            accounts = {
                row.id: (row.name, row.email)
                for row in session.execute(
                    sa.select(Account.id, Account.name, Account.email).where(
                        Account.id.in_({grant.account_id for grant in grants})
                    )
                )
            }
        return [
            {
                "id": grant.id,
                "kind": grant.kind,
                "name": grant.name,
                "client_name": clients.get(grant.client_ref) if grant.client_ref else None,
                "scopes": grant.scope.split(),
                "knowledge_base_ids": spaces.get(grant.id, []),
                "created_at": _aware(grant.created_at),
                "expires_at": _aware(grant.expires_at),
                "last_used_at": _aware(grant.last_used_at),
                **(
                    {
                        "account": {
                            "id": grant.account_id,
                            "name": accounts.get(grant.account_id, ("", ""))[0],
                            "email": accounts.get(grant.account_id, ("", ""))[1],
                        }
                    }
                    if with_account
                    else {}
                ),
            }
            for grant in grants
        ]

    def list_mine(self, *, account: Account, tenant_id: str, urls: KnowledgeAgentUrls) -> dict[str, Any]:
        with self._sessions() as session:
            grants = self._grant_views(
                session,
                (KnowledgeAgentGrant.account_id == account.id, KnowledgeAgentGrant.tenant_id == tenant_id),
                with_account=False,
            )
        return {
            "available": self._enabled(),
            "agent_access_enabled": self._workspace_enabled(tenant_id),
            "blocked_knowledge_base_ids": sorted(self._spaces.blocked(tenant_id=tenant_id)),
            "mcp_url": urls.resource,
            "grants": grants,
        }

    def create_personal_token(self, *, account: Account, tenant_id: str, body: dict[str, Any]) -> dict[str, Any]:
        self.require_enabled()
        if not self._workspace_enabled(tenant_id):
            raise KnowledgeAgentAccessError(
                403, "agent_access_disabled", "Agent access is turned off for this workspace"
            )
        name = body.get("name").strip() if isinstance(body.get("name"), str) else ""
        if not name or len(name) > 100:
            raise KnowledgeAgentAccessError(422, "invalid_name", "Give the token a name of at most 100 characters")
        days = body.get("expires_in_days", PERSONAL_TOKEN_DEFAULT_DAYS)
        if not isinstance(days, int) or isinstance(days, bool) or not 1 <= days <= PERSONAL_TOKEN_MAX_DAYS:
            raise KnowledgeAgentAccessError(
                422, "invalid_expiry", f"expires_in_days must be between 1 and {PERSONAL_TOKEN_MAX_DAYS}"
            )
        space_ids = self._check_knowledge_bases(
            account_id=account.id, tenant_id=tenant_id, raw=body.get("knowledge_base_ids")
        )
        expires_at = self._now() + timedelta(days=days)
        with self._sessions.begin() as session:
            grant = self._create_grant(
                session,
                account_id=account.id,
                tenant_id=tenant_id,
                kind="personal",
                name=name,
                scopes=[DEFAULT_KNOWLEDGE_AGENT_SCOPE],
                space_ids=space_ids,
                client_ref=None,
                expires_at=expires_at,
            )
            token = self._upsert_bearer(session, grant, expires_at)
            grant_id = grant.id
        with self._sessions() as session:
            [view] = self._grant_views(session, (KnowledgeAgentGrant.id == grant_id,), with_account=False)
        return {"grant": view, "token": token}

    def _find_grant(self, session: Session, *, tenant_id: str, grant_id: str) -> KnowledgeAgentGrant:
        grant = session.scalar(
            sa.select(KnowledgeAgentGrant).where(
                KnowledgeAgentGrant.id == grant_id,
                KnowledgeAgentGrant.tenant_id == tenant_id,
                KnowledgeAgentGrant.revoked_at.is_(None),
            )
        )
        if grant is None:
            raise KnowledgeAgentAccessError(404, "agent_grant_not_found", "Connection not found")
        return grant

    def update_grant(self, *, account: Account, tenant_id: str, grant_id: str, body: dict[str, Any]) -> dict[str, Any]:
        with self._sessions() as session:
            grant = self._find_grant(session, tenant_id=tenant_id, grant_id=grant_id)
            if grant.account_id != account.id:
                raise KnowledgeAgentAccessError(
                    403, "permission_denied", "Only the owner of a connection can change it"
                )
        space_ids = self._check_knowledge_bases(
            account_id=account.id, tenant_id=tenant_id, raw=body.get("knowledge_base_ids")
        )
        with self._sessions.begin() as session:
            session.execute(
                sa.delete(KnowledgeAgentGrantSpace)
                .where(KnowledgeAgentGrantSpace.grant_id == grant_id)
                .execution_options(synchronize_session=False)
            )
            session.add_all(
                KnowledgeAgentGrantSpace(grant_id=grant_id, control_space_id=space_id, tenant_id=tenant_id)
                for space_id in space_ids
            )
        with self._sessions() as session:
            [view] = self._grant_views(session, (KnowledgeAgentGrant.id == grant_id,), with_account=False)
        return view

    def revoke_grant(self, *, account: Account, tenant_id: str, role: str | None, grant_id: str) -> None:
        with self._sessions.begin() as session:
            grant = self._find_grant(session, tenant_id=tenant_id, grant_id=grant_id)
            if grant.account_id != account.id and not _is_workspace_admin(role):
                raise KnowledgeAgentAccessError(
                    403, "permission_denied", "Only the owner or a workspace admin can disconnect this"
                )
            self._revoke_grant(session, grant.id, reason="disconnected")

    def workspace_settings(self, *, tenant_id: str, role: str | None) -> dict[str, Any]:
        if not _is_workspace_admin(role):
            raise KnowledgeAgentAccessError(403, "permission_denied", "Only workspace admins can do this")
        with self._sessions() as session:
            grants = self._grant_views(session, (KnowledgeAgentGrant.tenant_id == tenant_id,), with_account=True)
        return {"agent_access_enabled": self._workspace_enabled(tenant_id), "grants": grants}

    def update_workspace_settings(
        self, *, account: Account, tenant_id: str, role: str | None, body: dict[str, Any]
    ) -> dict[str, Any]:
        if not _is_workspace_admin(role):
            raise KnowledgeAgentAccessError(403, "permission_denied", "Only workspace admins can do this")
        enabled = body.get("enabled")
        if not isinstance(enabled, bool):
            raise KnowledgeAgentAccessError(422, "invalid_agent_access", "enabled must be a boolean")
        with self._sessions.begin() as session:
            setting = session.get(KnowledgeAgentWorkspaceSetting, tenant_id)
            if setting is None:
                setting = KnowledgeAgentWorkspaceSetting(tenant_id=tenant_id)
                session.add(setting)
            setting.enabled = enabled
            setting.updated_by_account_id = account.id
        return self.workspace_settings(tenant_id=tenant_id, role=role)


def revoke_grant_of_token_row(session: Session, grant_id: str, *, now: datetime) -> None:
    """Called by the account session list when a member revokes a ``dfok_`` row there."""
    session.execute(
        sa.update(KnowledgeAgentGrant)
        .where(KnowledgeAgentGrant.id == grant_id, KnowledgeAgentGrant.revoked_at.is_(None))
        .values(revoked_at=now)
        .execution_options(synchronize_session=False)
    )
    session.execute(
        sa.delete(KnowledgeAgentRefreshToken)
        .where(KnowledgeAgentRefreshToken.grant_id == grant_id)
        .execution_options(synchronize_session=False)
    )


def _is_workspace_admin(role: str | None) -> bool:
    return role is not None and TenantAccountRole.is_privileged_role(TenantAccountRole(role))


def _with_query(url: str, params: dict[str, str]) -> str:
    parts = urlsplit(url)
    query = [*parse_qsl(parts.query, keep_blank_values=True), *params.items()]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
