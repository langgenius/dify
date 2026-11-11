"""Load tool providers and persist refreshed credentials in short transactions."""

import json
import logging
from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from core.tools.entities.tool_entities import ToolProviderType
from core.tools.utils.uuid_utils import is_valid_uuid
from models.account import Account
from models.tools import (
    ApiToolProvider,
    BuiltinToolProvider,
    MCPToolProvider,
    ToolLabelBinding,
    ToolOAuthSystemClient,
    ToolOAuthTenantClient,
    WorkflowToolProvider,
)
from services.tools.api.contracts import ApiToolProviderRecord
from services.tools.provider_queries import BuiltinCredential, MCPProviderRecord, ToolOAuthClient

logger = logging.getLogger(__name__)


def select_builtin_credentials(*, tenant_id: str, provider_names: Sequence[str]):
    return (
        select(BuiltinToolProvider)
        .where(BuiltinToolProvider.tenant_id == tenant_id, BuiltinToolProvider.provider.in_(provider_names))
        .order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
    )


class ToolProviderRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def mcp(self, *, tenant_id: str, provider_id: str) -> MCPToolProvider | None:
        record = self.mcp_record(tenant_id=tenant_id, provider_id=provider_id)
        return record.provider if record else None

    @staticmethod
    def _mcp_query(tenant_id: str):
        return (
            select(MCPToolProvider, Account.name)
            .outerjoin(Account, Account.id == MCPToolProvider.user_id)
            .where(MCPToolProvider.tenant_id == tenant_id)
        )

    def mcp_record(self, *, tenant_id: str, provider_id: str) -> MCPProviderRecord | None:
        with self._sessions() as session:
            query = self._mcp_query(tenant_id)
            row = None
            if is_valid_uuid(provider_id):
                row = session.execute(query.where(MCPToolProvider.id == provider_id)).one_or_none()
            if row is None:
                row = session.execute(query.where(MCPToolProvider.server_identifier == provider_id)).one_or_none()
            return MCPProviderRecord(provider=row[0], author=row[1] or "Anonymous") if row else None

    def mcp_providers(self, *, tenant_id: str) -> list[MCPProviderRecord]:
        with self._sessions() as session:
            return [
                MCPProviderRecord(provider=provider, author=author or "Anonymous")
                for provider, author in session.execute(self._mcp_query(tenant_id).order_by(MCPToolProvider.name))
            ]

    def default_builtin(self, *, tenant_id: str) -> list[BuiltinToolProvider]:
        ranked = (
            select(
                BuiltinToolProvider.id,
                func.row_number()
                .over(
                    partition_by=BuiltinToolProvider.provider,
                    order_by=(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.desc()),
                )
                .label("rank"),
            )
            .where(BuiltinToolProvider.tenant_id == tenant_id)
            .subquery()
        )
        with self._sessions() as session:
            return list(
                session.scalars(
                    select(BuiltinToolProvider)
                    .join(ranked, ranked.c.id == BuiltinToolProvider.id)
                    .where(ranked.c.rank == 1)
                )
            )

    def builtin_credential(
        self,
        *,
        tenant_id: str,
        provider_names: Sequence[str],
        credential_id: str | None,
    ) -> BuiltinCredential | None:
        query = select_builtin_credentials(tenant_id=tenant_id, provider_names=provider_names)
        if credential_id is not None:
            query = query.where(BuiltinToolProvider.id == credential_id)
        query = query.limit(1)
        with self._sessions() as session:
            row = session.scalar(query)
            if row is None:
                return None
            return BuiltinCredential(
                id=row.id,
                tenant_id=tenant_id,
                provider=row.provider,
                user_id=row.user_id,
                credential_type=row.credential_type,
                encrypted_credentials=row.encrypted_credentials,
                credentials=row.credentials,
                expires_at=row.expires_at,
                updated_at=row.updated_at,
            )

    def oauth_client(self, *, tenant_id: str, plugin_id: str, provider: str) -> ToolOAuthClient:
        with self._sessions() as session:
            tenant = session.scalar(
                select(ToolOAuthTenantClient).where(
                    ToolOAuthTenantClient.tenant_id == tenant_id,
                    ToolOAuthTenantClient.plugin_id == plugin_id,
                    ToolOAuthTenantClient.provider == provider,
                    ToolOAuthTenantClient.enabled.is_(True),
                )
            )
            if tenant is not None:
                return ToolOAuthClient(tenant_params=tenant.oauth_params, system_params=None)
            system = session.scalar(
                select(ToolOAuthSystemClient.encrypted_oauth_params).where(
                    ToolOAuthSystemClient.plugin_id == plugin_id,
                    ToolOAuthSystemClient.provider == provider,
                )
            )
            return ToolOAuthClient(tenant_params=None, system_params=system)

    def refresh_builtin_credential(
        self,
        *,
        record: BuiltinCredential,
        credentials: Mapping[str, Any],
        expires_at: int,
    ) -> bool:
        # Lock only for comparison and persistence; all provider I/O has already finished.
        with self._sessions.begin() as session:
            row = session.scalar(
                select(BuiltinToolProvider)
                .where(
                    BuiltinToolProvider.tenant_id == record.tenant_id,
                    BuiltinToolProvider.provider == record.provider,
                    BuiltinToolProvider.id == record.id,
                )
                .with_for_update()
            )
            if row is None or (
                row.updated_at,
                row.encrypted_credentials,
                row.expires_at,
                row.credential_type,
                row.user_id,
            ) != (
                record.updated_at,
                record.encrypted_credentials,
                record.expires_at,
                record.credential_type,
                record.user_id,
            ):
                return False
            row.encrypted_credentials = json.dumps(dict(credentials))
            row.expires_at = expires_at
            return True

    @staticmethod
    def _api_query(tenant_id: str):
        return (
            select(ApiToolProvider, Account.name)
            .outerjoin(Account, Account.id == ApiToolProvider.user_id)
            .where(ApiToolProvider.tenant_id == tenant_id)
        )

    @staticmethod
    def _api_record(provider: ApiToolProvider, author: str | None) -> ApiToolProviderRecord:
        return ApiToolProviderRecord(
            id=provider.id,
            tenant_id=provider.tenant_id,
            name=provider.name,
            description=provider.description,
            icon=provider.icon,
            author=author or "",
            tools=provider.tools,
            credentials=provider.credentials,
            schema_type=provider.schema_type,
            schema=provider.schema,
            privacy_policy=provider.privacy_policy,
            custom_disclaimer=provider.custom_disclaimer,
        )

    def get(self, *, tenant_id: str, provider_id: str) -> ApiToolProviderRecord | None:
        with self._sessions() as session:
            row = session.execute(self._api_query(tenant_id).where(ApiToolProvider.id == provider_id)).one_or_none()
            return self._api_record(*row) if row else None

    def api_by_name(self, *, tenant_id: str, name: str) -> ApiToolProviderRecord | None:
        with self._sessions() as session:
            row = session.execute(self._api_query(tenant_id).where(ApiToolProvider.name == name).limit(1)).first()
            return self._api_record(*row) if row else None

    def api_providers(self, *, tenant_id: str) -> list[ApiToolProviderRecord]:
        with self._sessions() as session:
            records = []
            for provider, author in session.execute(self._api_query(tenant_id)):
                try:
                    records.append(self._api_record(provider, author))
                except (ValueError, TypeError):
                    logger.warning("Invalid stored API provider %s", provider.id, exc_info=True)
            return records

    def api_labels(self, *, tenant_id: str, provider_ids: Sequence[str]) -> dict[str, list[str]]:
        if not provider_ids:
            return {}
        with self._sessions() as session:
            rows = session.execute(
                select(ToolLabelBinding.tool_id, ToolLabelBinding.label_name)
                .join(ApiToolProvider, ApiToolProvider.id == ToolLabelBinding.tool_id)
                .where(
                    ApiToolProvider.tenant_id == tenant_id,
                    ApiToolProvider.id.in_(provider_ids),
                    ToolLabelBinding.tool_type == "api",
                )
            )
            result: dict[str, list[str]] = {}
            for provider_id, label in rows:
                result.setdefault(provider_id, []).append(label)
            return result

    def icon(self, *, tenant_id: str, provider_type: ToolProviderType, provider_id: str) -> str | None:
        if provider_type == ToolProviderType.MCP:
            provider = self.mcp(tenant_id=tenant_id, provider_id=provider_id)
            return provider.icon if provider else None
        if provider_type == ToolProviderType.API:
            query = (
                self._api_query(tenant_id)
                .where(ApiToolProvider.id == provider_id)
                .with_only_columns(ApiToolProvider.icon)
            )
        elif provider_type == ToolProviderType.WORKFLOW:
            from repositories.tools.workflow_repository import select_workflow_providers

            query = (
                select_workflow_providers(tenant_id)
                .where(WorkflowToolProvider.id == provider_id)
                .with_only_columns(WorkflowToolProvider.icon)
            )
        else:
            return None
        with self._sessions() as session:
            return session.scalar(query)
