"""Persist ordinary draft OAuth rotation after native external refresh has closed.

Admission remains metadata-only. This mutation receives already encrypted
native output and updates the exact checked credential in one bounded SQL
write, repeating actor access or the exact saved ordinary workflow binding and
comparing the original native read. A changed binding, revoked actor access,
ownership change, deletion or concurrent rotation cannot be overwritten.
Published and Builder confirmed refresh retain their separate existing owners.
"""

from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from core.plugin.entities.plugin_daemon import CredentialType as ToolCredentialType
from core.tools.errors import ToolProviderCredentialValidationError
from models.credential_permission import CredentialType
from models.tools import BuiltinToolProvider
from repositories.credentials.query_repository import (
    apply_credential_visibility_filter_for_actor,
    workflow_tool_credential_binding_condition,
)
from services.credentials.query import WorkflowToolCredentialMetadata
from services.tools.draft_tool_setup import DraftToolRuntimeSelection, tool_credential_fingerprint


def persist_draft_tool_refresh(
    *,
    session_maker: sessionmaker[Session],
    selection: DraftToolRuntimeSelection,
    original_encrypted_credentials: str | None,
    original_expires_at: int,
    original_user_id: str | None,
    refreshed_encrypted_credentials: str,
    refreshed_expires_at: int,
) -> str:
    """Commit one authorized unchanged selection and return its opaque version; no external I/O occurs here.

    The original opaque ciphertext/expiry/owner come from the native constrained
    read, before OAuth I/O. ``None`` represents the actual stored SQL NULL;
    its comparison retains SQLAlchemy's IS NULL semantics rather than a blank
    ciphertext fallback. The short transaction rechecks actor visibility or the
    saved node binding. Exactly one updated row is required; the fingerprint
    is read in the same transaction, without unsupported UPDATE RETURNING.
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
    if not isinstance(credential, WorkflowToolCredentialMetadata):
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
    )
    try:
        with session_maker.begin() as session:
            if isinstance(credential, WorkflowToolCredentialMetadata):
                statement = statement.where(workflow_tool_credential_binding_condition(session, credential))
            result = session.execute(statement.execution_options(synchronize_session=False))
            assert isinstance(result, CursorResult)
            if result.rowcount != 1:
                raise ToolProviderCredentialValidationError(
                    "Tool credential changed or access was revoked during refresh."
                )
            updated = session.scalar(
                select(BuiltinToolProvider).where(
                    BuiltinToolProvider.id == credential.id,
                    BuiltinToolProvider.tenant_id == selection.tenant_id,
                    BuiltinToolProvider.provider == credential.provider,
                )
            )
            if updated is None:
                raise ToolProviderCredentialValidationError("Tool credential refresh could not be persisted.")
            fingerprint = tool_credential_fingerprint(updated)
        return fingerprint
    except ToolProviderCredentialValidationError:
        raise
    except Exception:
        raise ToolProviderCredentialValidationError("Tool credential refresh could not be persisted.") from None
