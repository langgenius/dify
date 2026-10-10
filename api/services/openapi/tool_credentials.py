"""Saving a builtin tool provider's API-key credential for openapi, which answers with the new credential."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from core.db.session_factory import session_factory
from core.plugin.entities.plugin_daemon import CredentialType
from models.tools import BuiltinToolProvider
from services.tools.builtin_tools_manage_service import BuiltinToolManageService


def add_api_key_credential(
    *, user_id: str, workspace_id: str, provider: str, credentials: dict[str, Any], name: str | None
) -> str:
    """Save the credential through BuiltinToolManageService and return its id.

    The name is settled first so the saved row can be found by it; names are unique per provider.
    Raises ValueError with the service's message when the credential is refused.
    """
    if not name:
        with session_factory.create_session() as session:
            name = BuiltinToolManageService.generate_builtin_tool_provider_name(
                workspace_id, provider, CredentialType.API_KEY, session=session
            )
    BuiltinToolManageService.add_builtin_tool_provider(
        user_id=user_id,
        api_type=CredentialType.API_KEY,
        tenant_id=workspace_id,
        provider=provider,
        credentials=credentials,
        name=name,
    )
    with session_factory.create_session() as session:
        return session.scalars(
            select(BuiltinToolProvider.id).where(
                BuiltinToolProvider.tenant_id == workspace_id,
                BuiltinToolProvider.provider == provider,
                BuiltinToolProvider.name == name,
            )
        ).one()
