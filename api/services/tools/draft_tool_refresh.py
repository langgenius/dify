"""Persist ordinary draft OAuth rotation after native external refresh has closed.

Admission remains metadata-only. This mutation receives already encrypted
native output and updates the exact checked credential in one bounded SQL
write, repeating current actor access and comparing the original native read.
A revoke, ownership change, deletion or concurrent rotation cannot be silently
overwritten or returned as a usable refreshed Tool runtime. Published and
Builder confirmed refresh retain their separate existing owners.
"""

from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

from core.plugin.entities.plugin_daemon import CredentialType as ToolCredentialType
from core.tools.errors import ToolProviderCredentialValidationError
from models.credential_permission import CredentialType
from models.tools import BuiltinToolProvider
from repositories.credentials.query_repository import apply_credential_visibility_filter_for_actor
from services.tools.draft_tool_setup import DraftToolRuntimeSelection


def persist_draft_tool_refresh(
    *,
    session_maker: sessionmaker[Session],
    selection: DraftToolRuntimeSelection,
    original_encrypted_credentials: str,
    original_expires_at: int,
    original_user_id: str | None,
    refreshed_encrypted_credentials: str,
    refreshed_expires_at: int,
) -> None:
    """Commit one authorized unchanged selection; no external I/O occurs here.

    The original opaque ciphertext/expiry/owner come from the native constrained
    read, before OAuth I/O. Conditional UPDATE repeats canonical visibility
    atomically; a failed compare-and-set rolls back and forbids runtime dispatch.
    Neither token plaintext nor a graph/client permission marker enters this owner.
    """
    credential = selection.credential
    if credential is None:
        raise ToolProviderCredentialValidationError("Tool credential changed or access was revoked during refresh.")
    statement = update(BuiltinToolProvider).where(
        BuiltinToolProvider.id == credential.id,
        BuiltinToolProvider.tenant_id == selection.tenant_id,
        BuiltinToolProvider.provider == credential.provider,
        BuiltinToolProvider.credential_type == ToolCredentialType.OAUTH2,
        BuiltinToolProvider.user_id == original_user_id,
        BuiltinToolProvider.encrypted_credentials == original_encrypted_credentials,
        BuiltinToolProvider.expires_at == original_expires_at,
    )
    statement = apply_credential_visibility_filter_for_actor(
        statement,
        tenant_id=selection.tenant_id,
        model_id_column=BuiltinToolProvider.id,
        model_user_id_column=BuiltinToolProvider.user_id,
        model_visibility_column=BuiltinToolProvider.visibility,
        credential_type=CredentialType.BUILTIN_TOOL_PROVIDER,
        actor_id=selection.actor_id,
    )
    statement = statement.values(
        encrypted_credentials=refreshed_encrypted_credentials,
        expires_at=refreshed_expires_at,
    ).returning(BuiltinToolProvider.id)
    try:
        with session_maker.begin() as session:
            updated_id = session.scalar(statement.execution_options(synchronize_session=False))
            if updated_id != credential.id:
                raise ToolProviderCredentialValidationError(
                    "Tool credential changed or access was revoked during refresh."
                )
    except ToolProviderCredentialValidationError:
        raise
    except Exception:
        raise ToolProviderCredentialValidationError("Tool credential refresh could not be persisted.") from None
