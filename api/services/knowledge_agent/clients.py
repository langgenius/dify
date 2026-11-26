"""The OAuth client registry: dynamic registration (RFC 7591) and client ID metadata documents."""

from __future__ import annotations

import json
import logging
import secrets
from datetime import timedelta
from typing import Any
from urllib.parse import urlsplit

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_agent import KnowledgeAgentClient, KnowledgeAgentGrant
from services.knowledge_agent.contracts import (
    ClientMetadataFetcher,
    Clock,
    KnowledgeAgentAccessError,
    KnowledgeAgentRedis,
    aware,
)
from services.knowledge_agent.oauth import (
    DCR_CLIENT_ID_PREFIX,
    KnowledgeAgentOAuthError,
    client_display_name,
    is_client_metadata_url,
    sha256_hex,
    validate_redirect_uri,
)

logger = logging.getLogger(__name__)

_CLIENT_METADATA_TTL = timedelta(hours=24)
_CLIENT_METADATA_MAX_BYTES = 64 * 1024
_DCR_IDLE_RETENTION = timedelta(days=30)
DCR_PER_IP_PER_HOUR = 20
DCR_RATE_WINDOW_SECONDS = 3600
_MAX_REDIRECT_URIS = 10
_DCR_RATE_KEY = "knowledge_agent:dcr:{ip}"


class KnowledgeAgentClientRegistry:
    """Public OAuth clients: registered dynamically (``dcr``) or known by a metadata URL (``cimd``)."""

    def __init__(
        self,
        *,
        session_maker: sessionmaker[Session],
        redis_client: KnowledgeAgentRedis,
        fetch_client_metadata: ClientMetadataFetcher | None,
        clock: Clock,
    ) -> None:
        self._sessions = session_maker
        self._redis = redis_client
        self._fetch_client_metadata = fetch_client_metadata
        self._now = clock

    def register(self, body: dict[str, Any], *, ip_address: str | None) -> dict[str, Any]:
        """RFC 7591 registration of a public client (secret-based methods are replaced, §3.2.1)."""
        rate_key = _DCR_RATE_KEY.format(ip=ip_address or "unknown")
        count = self._redis.incr(rate_key)
        if count == 1:
            self._redis.expire(rate_key, DCR_RATE_WINDOW_SECONDS)
        if count > DCR_PER_IP_PER_HOUR:
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

    def resolve(self, raw_client_id: object) -> KnowledgeAgentClient:
        """The client an authorization request names, as a detached row.

        Registered ids must exist. Metadata URLs are fetched, validated and cached for a day; a
        stale copy keeps a known client working while its metadata host is down.
        """
        if not isinstance(raw_client_id, str) or not raw_client_id:
            raise KnowledgeAgentAccessError(422, "invalid_client", "client_id is required")
        with self._sessions() as session:
            cached = self._load(session, raw_client_id)
            if cached is not None:
                session.expunge(cached)
        if not is_client_metadata_url(raw_client_id):
            if cached is None or cached.kind != "dcr":
                raise KnowledgeAgentAccessError(422, "invalid_client", "Unknown client")
            return cached
        fetched_at = aware(cached.metadata_fetched_at) if cached else None
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
            row = self._load(session, raw_client_id)
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

    def mark_used(self, session: Session, client_ref: str) -> None:
        """Record that the client just completed a sign-in, which keeps its registration alive."""
        session.execute(
            sa.update(KnowledgeAgentClient)
            .where(KnowledgeAgentClient.id == client_ref)
            .values(last_used_at=self._now())
            .execution_options(synchronize_session=False)
        )

    @staticmethod
    def _load(session: Session, client_id: str) -> KnowledgeAgentClient | None:
        return session.scalar(
            sa.select(KnowledgeAgentClient).where(KnowledgeAgentClient.client_id_hash == sha256_hex(client_id))
        )

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
