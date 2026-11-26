"""The OAuth 2.1 authorization server for MCP clients: consent, codes, the token endpoint.

PKCE S256 only, public clients, resource-bound tokens. The consent page lives in the Console; the
token and revocation endpoints are called by the agent itself.
"""

from __future__ import annotations

import json
import secrets
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from libs.uuid_utils import uuidv7
from models.account import Account, Tenant
from models.knowledge_agent import KnowledgeAgentClient, KnowledgeAgentGrant, KnowledgeAgentRefreshToken
from models.oauth import OAuthAccessToken
from services.knowledge_agent.clients import KnowledgeAgentClientRegistry
from services.knowledge_agent.contracts import (
    Clock,
    KnowledgeAgentAccessError,
    KnowledgeAgentRedis,
    KnowledgeAgentUrls,
    aware,
)
from services.knowledge_agent.oauth import (
    AUTHORIZATION_CODE_TTL_SECONDS,
    KNOWLEDGE_AGENT_SCOPES,
    REFRESH_TOKEN_PREFIX,
    KnowledgeAgentOAuthError,
    is_pkce_challenge,
    parse_requested_scopes,
    redirect_uri_matches,
    same_resource,
    sha256_hex,
    verify_pkce,
)
from services.knowledge_agent.policy import KnowledgeAgentAccessPolicy
from services.knowledge_agent.tokens import KnowledgeAgentTokenStore, member_active

CODE_REPLAY_MEMORY_SECONDS = 600
_CODE_KEY = "knowledge_agent:code:{hash}"
_CODE_USED_KEY = "knowledge_agent:code_used:{hash}"
_CODE_REPLAYED_KEY = "knowledge_agent:code_replayed:{hash}"


def protected_resource_metadata(urls: KnowledgeAgentUrls) -> dict[str, Any]:
    """RFC 9728 metadata for the knowledge MCP endpoint."""
    return {
        "resource": urls.resource,
        "authorization_servers": [urls.issuer],
        "bearer_methods_supported": ["header"],
        "resource_name": "Dify Agent Knowledge Base",
        "scopes_supported": list(KNOWLEDGE_AGENT_SCOPES),
    }


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


class KnowledgeAgentAuthorizationServer:
    """Validates authorization requests, mints single-use codes and redeems codes and refresh tokens."""

    def __init__(
        self,
        *,
        session_maker: sessionmaker[Session],
        redis_client: KnowledgeAgentRedis,
        clients: KnowledgeAgentClientRegistry,
        tokens: KnowledgeAgentTokenStore,
        policy: KnowledgeAgentAccessPolicy,
        clock: Clock,
    ) -> None:
        self._sessions = session_maker
        self._redis = redis_client
        self._clients = clients
        self._tokens = tokens
        self._policy = policy
        self._now = clock

    # -- Consent page ---------------------------------------------------------------------------

    def describe(
        self, *, account: Account, tenant_id: str, params: dict[str, Any], urls: KnowledgeAgentUrls
    ) -> dict[str, Any]:
        """What the consent page shows for a valid authorization request: client, scopes, workspace.

        The blocked knowledge bases are the member's own view: only bases the member can read.
        """
        self._policy.require_enabled()
        request = self._parse_request(params, urls)
        with self._sessions() as session:
            tenant_name = session.scalar(sa.select(Tenant.name).where(Tenant.id == tenant_id)) or ""
        return {
            "agent_access_enabled": self._policy.workspace_enabled(tenant_id),
            "blocked_knowledge_base_ids": self._policy.blocked_knowledge_bases(
                tenant_id=tenant_id, account_id=account.id
            ),
            "client": {
                "kind": request["client"].kind,
                "name": request["client"].name,
                "redirect_host": urlsplit(request["redirect_uri"]).netloc,
            },
            "scopes": request["scopes"],
            "workspace": {"id": tenant_id, "name": tenant_name},
        }

    def decide(
        self, *, account: Account, tenant_id: str, body: dict[str, Any], urls: KnowledgeAgentUrls
    ) -> dict[str, str]:
        """The member's answer: where the browser goes next, with a code on approval or `access_denied`."""
        self._policy.require_enabled()
        request = self._parse_request(body, urls)
        redirect = _with_query(
            request["redirect_uri"], {"iss": urls.issuer, **({"state": request["state"]} if request["state"] else {})}
        )
        if body.get("approve") is not True:
            return {"redirect_to": _with_query(redirect, {"error": "access_denied"})}
        self._policy.require_workspace_enabled(tenant_id)
        space_ids = self._policy.check_knowledge_bases(
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

    def _parse_request(self, params: dict[str, Any], urls: KnowledgeAgentUrls) -> dict[str, Any]:
        if params.get("response_type") != "code":
            raise KnowledgeAgentAccessError(422, "unsupported_response_type", "response_type must be code")
        client = self._clients.resolve(params.get("client_id"))
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

    # -- Token endpoint -------------------------------------------------------------------------

    def exchange_token(self, form: dict[str, Any], urls: KnowledgeAgentUrls) -> dict[str, Any]:
        """RFC 6749 token endpoint: redeem an authorization code or rotate a refresh token."""
        if not self._policy.deployment_enabled():
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
        # Refusals are returned, not raised, inside the transactions above so revocations commit.
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
        used_key = _CODE_USED_KEY.format(hash=code_hash)
        raw = self._redis.get(_CODE_KEY.format(hash=code_hash))
        # Single use. The id of the connection this redemption will create is reserved under the
        # "used" marker atomically, and before the code itself goes away: any other presentation
        # of the code, however it interleaves with this one, finds the marker and so the grant.
        grant_id = str(uuidv7())
        if raw is None or not self._redis.set(used_key, grant_id, ex=CODE_REPLAY_MEMORY_SECONDS, nx=True):
            return self._refuse_spent_code(code_hash)
        self._redis.delete(_CODE_KEY.format(hash=code_hash))
        payload = json.loads(raw)
        rejection = _check_redemption(form, payload, client_id)
        if rejection is not None:
            # The code is burnt but nothing was issued for it: it is simply invalid from now on.
            self._redis.delete(used_key)
            return rejection
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
            for previous_id in previous:
                self._tokens.revoke_grant(session, previous_id, reason="replaced")
            grant = self._tokens.create_grant(
                session,
                account_id=payload["account_id"],
                tenant_id=payload["tenant_id"],
                kind="oauth",
                name=payload["client_name"],
                scopes=payload["scopes"],
                space_ids=payload["space_ids"],
                client_ref=payload["client_ref"],
                expires_at=None,
                grant_id=grant_id,
            )
            self._clients.mark_used(session, payload["client_ref"])
            tokens = self._tokens.issue_tokens(session, grant)
        if self._redis.get(_CODE_REPLAYED_KEY.format(hash=code_hash)) is not None:
            # The code was presented again while this redemption was in flight, before there was a
            # committed connection for that caller to revoke. End it here instead.
            return self._revoke_replayed(grant_id)
        return tokens

    def _refuse_spent_code(self, code_hash: str) -> KnowledgeAgentOAuthError:
        """Answer for a code that is gone; if it was redeemed, also end what that redemption issued."""
        used = self._redis.get(_CODE_USED_KEY.format(hash=code_hash))
        if used is None:
            return KnowledgeAgentOAuthError("invalid_grant", "The authorization code is invalid or expired")
        # Tell a redemption that has not committed yet (its grant cannot be revoked here) to undo itself.
        self._redis.setex(_CODE_REPLAYED_KEY.format(hash=code_hash), CODE_REPLAY_MEMORY_SECONDS, "1")
        return self._revoke_replayed(used.decode() if isinstance(used, bytes) else str(used))

    def _revoke_replayed(self, grant_id: str) -> KnowledgeAgentOAuthError:
        # A replayed code may be stolen: end what the first exchange issued (RFC 6749 §4.1.2).
        with self._sessions.begin() as session:
            self._tokens.revoke_grant(session, grant_id, reason="authorization_code_replayed")
        return KnowledgeAgentOAuthError("invalid_grant", "The authorization code was already used")

    def _refresh(self, form: dict[str, Any]) -> dict[str, Any] | KnowledgeAgentOAuthError:
        refresh_token = form.get("refresh_token") if isinstance(form.get("refresh_token"), str) else ""
        # Clients are public (no client authentication), so RFC 6749 §6 binds the refresh token to
        # the client it was issued to: the client must name itself, as it does when redeeming a code.
        client_id = form.get("client_id")
        if not isinstance(client_id, str) or not client_id:
            raise KnowledgeAgentOAuthError("invalid_request", "refresh_token and client_id are required")
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
            if client is None or client_id != client.client_id:
                return KnowledgeAgentOAuthError("invalid_grant", "The refresh token belongs to another client")
            if row.rotated_at is not None:
                # Refresh tokens rotate: a second use means a copy leaked. End the whole connection.
                self._tokens.revoke_grant(session, grant.id, reason="refresh_token_reused")
                return KnowledgeAgentOAuthError("invalid_grant", "The refresh token was already used")
            if aware(row.expires_at) <= self._now() or not member_active(session, grant):
                return KnowledgeAgentOAuthError("invalid_grant", "The refresh token is no longer valid")
            row.rotated_at = self._now()
            return self._tokens.issue_tokens(session, grant)

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
                self._tokens.revoke_grant(session, grant_id, reason="client_revocation")


def _check_redemption(form: dict[str, Any], payload: dict[str, Any], client_id: str) -> KnowledgeAgentOAuthError | None:
    """Why this token request may not redeem the code it presented, if it may not."""
    if payload["client_id"] != client_id:
        return KnowledgeAgentOAuthError("invalid_grant", "The authorization code is invalid")
    if form.get("redirect_uri") not in (None, payload["redirect_uri"]):
        return KnowledgeAgentOAuthError("invalid_grant", "redirect_uri does not match the authorization")
    resource = form.get("resource")
    if isinstance(resource, str) and resource and not same_resource(resource, payload["resource"]):
        return KnowledgeAgentOAuthError("invalid_target", "resource does not match the authorization")
    if not verify_pkce(form.get("code_verifier"), payload["code_challenge"]):
        return KnowledgeAgentOAuthError("invalid_grant", "PKCE verification failed")
    return None


def _with_query(url: str, params: dict[str, str]) -> str:
    parts = urlsplit(url)
    query = [*parse_qsl(parts.query, keep_blank_values=True), *params.items()]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
