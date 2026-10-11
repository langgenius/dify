"""Metadata-only selection and revisions for one explicit Builder tool credential.

``BuiltinToolManageService.resolve_builder_reference`` owns this companion and
is its only caller. It reads stored rows in the caller's session and never
decrypts, validates, refreshes or invokes anything. Revisions are
domain-separated HMAC-SHA256 over the exact stored metadata, including
ciphertext, so a same-timestamp rotation still changes them; the HMAC reveals
nothing about its inputs. ``is_default`` is deliberately excluded: changing the
workspace default never switches an explicitly pinned credential.

OAuth client precedence mirrors ``BuiltinToolManageService.get_oauth_client``:
an enabled tenant client first, otherwise the system client only for a plugin
with positive server-resolved verification. Anything else needs setup.
"""

import hashlib
import hmac
from dataclasses import dataclass, field
from typing import Literal

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from core.dify_builder.execution_policy import BuilderExecutionPolicyError, canonical_json
from core.dify_builder.models import Actor
from core.dify_builder.real_call_consent import CredentialReference
from core.plugin.entities.plugin_daemon import CredentialType
from models.credential_permission import CredentialType as CredentialPermissionType
from models.provider_ids import ToolProviderID
from models.tools import BuiltinToolProvider, ToolOAuthSystemClient, ToolOAuthTenantClient
from services.credential_permission_service import CredentialPermissionService

OAuthClientSource = Literal["tenant", "system", "missing"]

_CREDENTIAL_DOMAIN = b"dify-builder/credential-reference/credential/v1\x00"
_CLIENT_DOMAIN = b"dify-builder/credential-reference/oauth-client/v1\x00"
_CLIENT_SOURCES = frozenset({"tenant", "system", "missing"})


def _keyed(domain: bytes, value: dict[str, object], key: bytes) -> str:
    if type(key) is not bytes or not key:
        raise BuilderExecutionPolicyError("invalid_revision_key")
    return hmac.new(key, domain + canonical_json(value), hashlib.sha256).hexdigest()


def credential_revision(row: BuiltinToolProvider, *, key: bytes) -> str:
    """Opaque revision of every stored field that changes what the credential is or who may use it."""
    return _keyed(
        _CREDENTIAL_DOMAIN,
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "provider": row.provider,
            "owner": row.user_id,
            # StrEnum columns render their stored value.
            "visibility": str(row.visibility),
            "alias": row.name,
            "credential_type": str(row.credential_type),
            "expires_at": row.expires_at,
            "encrypted_credentials": row.encrypted_credentials,
        },
        key,
    )


def oauth_client_revision(
    *,
    source: OAuthClientSource,
    row_id: str | None,
    encrypted_params: str | None,
    enabled: bool,
    tenant_id: str,
    plugin_id: str,
    provider: str,
    key: bytes,
) -> str:
    """Opaque revision of the selected OAuth client row, or of its absence (``missing``)."""
    if source not in _CLIENT_SOURCES:
        raise BuilderExecutionPolicyError("invalid_oauth_client_source")
    return _keyed(
        _CLIENT_DOMAIN,
        {
            "source": source,
            "row_id": row_id,
            "encrypted_params": encrypted_params,
            "enabled": enabled,
            "tenant_id": tenant_id,
            "plugin_id": plugin_id,
            "provider": provider,
        },
        key,
    )


@dataclass(frozen=True, slots=True)
class OAuthClientSnapshot:
    """Exact selected client row for later exact resolution; ciphertext never renders."""

    source: OAuthClientSource
    row_id: str | None
    encrypted_params: str | None = field(repr=False)
    enabled: bool


@dataclass(frozen=True, slots=True)
class BuilderCredentialSnapshot:
    """Private ephemeral native-owner selection. Only ``reference`` may leave the owner."""

    reference: CredentialReference
    encrypted_credentials: str | None = field(repr=False)
    client: OAuthClientSnapshot


def _select_client(
    db: Session, *, tenant_id: str, provider: ToolProviderID, verified_plugin: bool
) -> OAuthClientSnapshot:
    tenant_client = db.scalar(
        select(ToolOAuthTenantClient).where(
            ToolOAuthTenantClient.tenant_id == tenant_id,
            ToolOAuthTenantClient.plugin_id == provider.plugin_id,
            ToolOAuthTenantClient.provider == provider.provider_name,
            ToolOAuthTenantClient.enabled.is_(True),
        )
    )
    if tenant_client is not None:
        # An enabled tenant client wins even when unusable; never fall back past it.
        if not tenant_client.encrypted_oauth_params:
            raise BuilderExecutionPolicyError("needs_setup")
        return OAuthClientSnapshot("tenant", tenant_client.id, tenant_client.encrypted_oauth_params, True)
    # Only positive server-resolved verification makes the system client eligible.
    if verified_plugin is True:
        system_client = db.scalar(
            select(ToolOAuthSystemClient).where(
                ToolOAuthSystemClient.plugin_id == provider.plugin_id,
                ToolOAuthSystemClient.provider == provider.provider_name,
            )
        )
        if system_client is not None and system_client.encrypted_oauth_params:
            return OAuthClientSnapshot("system", system_client.id, system_client.encrypted_oauth_params, True)
    raise BuilderExecutionPolicyError("needs_setup")


def select_builder_credential(
    db: Session,
    *,
    actor: Actor,
    provider_id: str,
    credential_id: str,
    verified_plugin: bool,
    revision_key: bytes,
) -> BuilderCredentialSnapshot:
    """Select exactly ``credential_id`` as the acting member sees it, in the caller's session."""
    if type(revision_key) is not bytes or not revision_key:
        raise BuilderExecutionPolicyError("invalid_revision_key")
    if not isinstance(credential_id, str) or not 1 <= len(credential_id) <= 128:
        raise BuilderExecutionPolicyError("credential_reference_unavailable")
    query = select(BuiltinToolProvider).where(
        BuiltinToolProvider.id == credential_id,
        BuiltinToolProvider.tenant_id == actor.tenant_id,
    )
    query = CredentialPermissionService.apply_account_visibility_filter(
        query,
        model_id_column=BuiltinToolProvider.id,
        model_user_id_column=BuiltinToolProvider.user_id,
        model_visibility_column=BuiltinToolProvider.visibility,
        credential_type=CredentialPermissionType.BUILTIN_TOOL_PROVIDER,
        account_id=actor.account_id,
    )
    row = db.scalar(query)
    if row is None:
        raise BuilderExecutionPolicyError("credential_reference_unavailable")
    try:
        provider = ToolProviderID(row.provider)
    except (ValueError, NotFound):
        raise BuilderExecutionPolicyError("credential_reference_unavailable") from None
    # Full canonical equality; never a short-name fallback.
    if str(provider) != provider_id:
        raise BuilderExecutionPolicyError("credential_reference_unavailable")

    if str(row.credential_type) == CredentialType.OAUTH2:
        client = _select_client(db, tenant_id=actor.tenant_id, provider=provider, verified_plugin=verified_plugin)
    else:
        client = OAuthClientSnapshot("missing", None, None, False)
    try:
        reference = CredentialReference(
            credential_id=row.id,
            provider_id=provider_id,
            alias=row.name,
            credential_type=str(row.credential_type),
            visibility=str(row.visibility),
            revision=credential_revision(row, key=revision_key),
            oauth_client_revision=oauth_client_revision(
                source=client.source,
                row_id=client.row_id,
                encrypted_params=client.encrypted_params,
                enabled=client.enabled,
                tenant_id=actor.tenant_id,
                plugin_id=provider.plugin_id,
                provider=provider.provider_name,
                key=revision_key,
            ),
            expires_at=row.expires_at,
        )
    except ValidationError:
        raise BuilderExecutionPolicyError("credential_reference_unavailable") from None
    return BuilderCredentialSnapshot(
        reference=reference, encrypted_credentials=row.encrypted_credentials, client=client
    )
