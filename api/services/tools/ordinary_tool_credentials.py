"""Existing ordinary Tool credential selection, decryption and refresh owner.

BUILT_IN and PLUGIN keep their distinct controller lookup paths. Only their
ordinary credentials share this service; confirmed calls and draft admission
retain their existing guards and persistence owners. Runtime user IDs may be
end users, so ordinary workspace delegation is not recast as creator access.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Mapping
from typing import Any, cast

import sqlalchemy as sa
from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from core.entities import PluginCredentialType
from core.helper.provider_cache import ToolProviderCredentialsCache
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.entities.tool_entities import ToolInvokeFrom
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.utils.encryption import create_provider_encrypter
from core.tools.utils.uuid_utils import is_valid_uuid
from extensions.ext_database import db
from models.provider_ids import ToolProviderID
from models.tools import BuiltinToolProvider
from services.tools.draft_tool_setup import DraftToolRuntimeSelection

logger = logging.getLogger(__name__)


def resolve_ordinary_tool_credentials(
    *,
    provider_controller: BuiltinToolProviderController,
    provider_id: str,
    tenant_id: str,
    user_id: str | None,
    invoke_from: InvokeFrom,
    tool_invoke_from: ToolInvokeFrom,
    credential_id: str | None,
    draft_selection: DraftToolRuntimeSelection | None,
) -> ToolRuntime:
    """Resolve only after the caller's confirmed/native/draft guard admission.

    An absent plugin credential selects its native default/oldest row; an
    explicit reference cannot silently select a replacement. No-auth tools do
    not read credential storage. Stored values stay in the private runtime.
    """
    if not provider_controller.need_credentials:
        return ToolRuntime(
            tenant_id=tenant_id,
            user_id=user_id,
            credentials={},
            invoke_from=invoke_from,
            tool_invoke_from=tool_invoke_from,
        )
    builtin_provider = None
    if draft_selection is not None:
        from services.tools.draft_tool_setup import constrain_draft_tool_credential_read

        with Session(db.engine) as session:
            builtin_provider = session.scalar(
                constrain_draft_tool_credential_read(select(BuiltinToolProvider), draft_selection)
            )
        if builtin_provider is None:
            raise ToolProviderCredentialValidationError(
                "Configure or select an authorized Tool credential before testing."
            )
    elif isinstance(provider_controller, PluginToolProviderController):
        provider_id_entity = ToolProviderID(provider_id)
        provider_names = [str(provider_id_entity)]
        # A short legacy name belongs only to its canonical native plugin.
        if str(ToolProviderID(provider_id_entity.provider_name)) == str(provider_id_entity):
            provider_names.append(provider_id_entity.provider_name)
        if credential_id:
            if not is_valid_uuid(credential_id):
                raise ToolProviderCredentialValidationError("Select a valid stored Tool credential reference.")
            try:
                builtin_provider_stmt = select(BuiltinToolProvider).where(
                    BuiltinToolProvider.tenant_id == tenant_id,
                    BuiltinToolProvider.id == credential_id,
                    BuiltinToolProvider.provider.in_(provider_names),
                )
                with Session(db.engine) as session:
                    builtin_provider = session.scalar(builtin_provider_stmt)
            except Exception as e:
                builtin_provider = None
                logger.info("Error getting builtin provider %s:%s", credential_id, e, exc_info=True)
            if builtin_provider is None:
                raise ToolProviderCredentialValidationError(
                    f"Tool credential {credential_id} has been deleted. Select or authorize another credential."
                )

        if builtin_provider is None:
            with Session(db.engine) as session:
                builtin_provider = session.scalar(
                    sa.select(BuiltinToolProvider)
                    .where(
                        BuiltinToolProvider.tenant_id == tenant_id,
                        BuiltinToolProvider.provider.in_(provider_names),
                    )
                    .order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
                )
            if builtin_provider is None:
                raise ToolProviderCredentialValidationError(
                    f"No workspace credential is configured for tool provider {provider_id}. "
                    "Authorize the provider or select a credential."
                )
    else:
        # Keep the original encrypted state detached across policy/OAuth calls,
        # just like plugin and draft reads. A scoped-session expiration must not
        # silently replace the state later compared by the refresh writer.
        with Session(db.engine) as session:
            builtin_provider = session.scalar(
                select(BuiltinToolProvider)
                .where(BuiltinToolProvider.tenant_id == tenant_id, (BuiltinToolProvider.provider == provider_id))
                .order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
                .limit(1)
            )

        if builtin_provider is None:
            raise ToolProviderCredentialValidationError(
                f"No credential is configured for built-in tool provider {provider_id}. "
                "Authorize the provider or select a credential."
            )

    # Verify the complete selected owner before any policy, decryption or refresh.
    if isinstance(provider_controller, PluginToolProviderController) and (
        builtin_provider.tenant_id != tenant_id
        or str(ToolProviderID(builtin_provider.provider)) != str(ToolProviderID(provider_id))
        or (credential_id and builtin_provider.id != credential_id)
    ):
        raise ToolProviderCredentialValidationError("Tool credential does not belong to this provider and workspace.")

    from core.helper.credential_utils import runtime_check_credential_policy_compliance

    runtime_check_credential_policy_compliance(
        credential_id=builtin_provider.id,
        provider=provider_id,
        credential_type=PluginCredentialType.TOOL,
        check_existence=False,
    )

    encrypter, cache = create_provider_encrypter(
        tenant_id=tenant_id,
        config=[
            x.to_basic_provider_config()
            for x in provider_controller.get_credentials_schema_by_type(builtin_provider.credential_type)
        ],
        cache=ToolProviderCredentialsCache(
            tenant_id=tenant_id, provider=provider_id, credential_id=builtin_provider.id
        ),
    )

    decrypted_credentials: Mapping[str, Any] = encrypter.decrypt(builtin_provider.credentials)

    if builtin_provider.expires_at != -1 and (builtin_provider.expires_at - 60) < int(time.time()):
        # TODO: circular import
        from core.plugin.impl.oauth import OAuthHandler
        from services.tools.builtin_tools_manage_service import BuiltinToolManageService

        tool_provider = ToolProviderID(provider_id)
        provider_name = tool_provider.provider_name
        redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider_id}/tool/callback"
        system_credentials = BuiltinToolManageService.get_oauth_client(tenant_id, provider_id)

        oauth_handler = OAuthHandler()
        try:
            refreshed_credentials = oauth_handler.refresh_credentials(
                tenant_id=tenant_id,
                user_id=builtin_provider.user_id,
                plugin_id=tool_provider.plugin_id,
                provider=provider_name,
                redirect_uri=redirect_uri,
                system_credentials=system_credentials or {},
                credentials=decrypted_credentials,
            )
        except Exception as exc:
            logger.warning("Failed to refresh OAuth credentials for tool provider %s", provider_id, exc_info=True)
            raise ToolProviderCredentialValidationError(
                f"OAuth credential for tool provider {provider_id} could not be refreshed. "
                "Reauthorize or select another credential."
            ) from exc
        # Encryption stays outside SQL. Draft selection was detached
        # by its short native read, so persist through a bounded owner
        # that rechecks access and refuses concurrent rotation.
        refreshed_encrypted = json.dumps(encrypter.encrypt(refreshed_credentials.credentials))
        if draft_selection is not None:
            from services.tools.draft_tool_refresh import persist_draft_tool_refresh

            persist_draft_tool_refresh(
                session_maker=sessionmaker(bind=db.engine),
                selection=draft_selection,
                original_encrypted_credentials=builtin_provider.encrypted_credentials,
                original_expires_at=builtin_provider.expires_at,
                original_user_id=builtin_provider.user_id,
                refreshed_encrypted_credentials=refreshed_encrypted,
                refreshed_expires_at=refreshed_credentials.expires_at,
            )
        else:
            _persist_ordinary_refresh(
                tenant_id=tenant_id,
                selected=builtin_provider,
                refreshed_encrypted_credentials=refreshed_encrypted,
                refreshed_expires_at=refreshed_credentials.expires_at,
            )
        decrypted_credentials = refreshed_credentials.credentials
        cache.delete()

    return ToolRuntime(
        tenant_id=tenant_id,
        user_id=user_id,
        credentials=dict(decrypted_credentials),
        credential_type=builtin_provider.credential_type,
        runtime_parameters={},
        invoke_from=invoke_from,
        tool_invoke_from=tool_invoke_from,
    )


def _persist_ordinary_refresh(
    *,
    tenant_id: str,
    selected: BuiltinToolProvider,
    refreshed_encrypted_credentials: str,
    refreshed_expires_at: int,
) -> None:
    """Persist a detached ordinary selection without overwriting a newer token.

    The ordinary default plugin read already closes its SQL session before
    OAuth. Committing a different session cannot persist that detached row.
    This bounded writer compares the exact owner and original encrypted state;
    OAuth/encryption and cache invalidation occur outside this transaction.
    Exactly one affected row proves the conditional update without requiring
    UPDATE RETURNING, which the supported MySQL dialect does not implement.
    Unknown counts or uncertain persistence refuse without a refresh retry.
    """
    statement = (
        update(BuiltinToolProvider)
        .where(
            BuiltinToolProvider.tenant_id == tenant_id,
            BuiltinToolProvider.id == selected.id,
            BuiltinToolProvider.provider == selected.provider,
            BuiltinToolProvider.user_id == selected.user_id,
            BuiltinToolProvider.credential_type == selected.credential_type,
            BuiltinToolProvider.encrypted_credentials == selected.encrypted_credentials,
            BuiltinToolProvider.expires_at == selected.expires_at,
        )
        .values(encrypted_credentials=refreshed_encrypted_credentials, expires_at=refreshed_expires_at)
    )
    try:
        with Session(db.engine) as session, session.begin():
            result = session.execute(statement.execution_options(synchronize_session=False))
            if cast(CursorResult[object], result).rowcount != 1:
                raise ToolProviderCredentialValidationError("Tool credential changed during refresh.")
    except ToolProviderCredentialValidationError:
        raise
    except Exception:
        raise ToolProviderCredentialValidationError("Tool credential refresh could not be persisted.") from None
