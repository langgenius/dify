"""Persistence-owned credential queries and visibility filtering shared across domains."""

from collections.abc import Sequence
from typing import override

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import InstrumentedAttribute, Session, sessionmaker

from models.credential_permission import CredentialPermission, CredentialType
from models.enums import PermissionEnum
from models.oauth import DatasourceProvider
from models.provider import ProviderCredential
from models.provider_ids import ModelProviderID
from models.tools import BuiltinToolProvider
from models.trigger import TriggerSubscription, WorkflowPluginTrigger
from services.credentials.query import (
    CredentialQuery,
    DatasourceCredentialListItem,
    ModelCredentialRecord,
    ToolCredentialRecord,
    TriggerSubscriptionRecord,
)


def apply_credential_visibility_filter_for_actor(
    query,
    *,
    tenant_id: str,
    model_id_column: InstrumentedAttribute,
    model_user_id_column: InstrumentedAttribute,
    model_visibility_column: InstrumentedAttribute,
    credential_type: str,
    actor_id: str,
):
    """Apply the canonical tenant- and actor-scoped credential visibility policy.

    Team credentials and legacy rows without an owner are visible to all tenant
    members. Personal credentials are visible to their owner, while partially
    shared credentials additionally require an enabled permission row for the
    same tenant and credential type. Administrator roles do not bypass this
    policy.
    """
    partial_member_ids = (
        select(CredentialPermission.credential_id)
        .where(
            CredentialPermission.tenant_id == tenant_id,
            CredentialPermission.credential_type == credential_type,
            CredentialPermission.account_id == actor_id,
            CredentialPermission.has_permission.is_(True),
        )
        .correlate_except(CredentialPermission)
    )
    return query.where(
        or_(
            model_visibility_column == PermissionEnum.ALL_TEAM,
            model_user_id_column.is_(None),
            model_user_id_column == actor_id,
            and_(model_visibility_column == PermissionEnum.PARTIAL_TEAM, model_id_column.in_(partial_member_ids)),
        )
    )


class CredentialQueryRepository(CredentialQuery):
    """Load complete credential lists without exposing ORM objects or SQL to callers."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def list_models(self, *, workspace_id: str, provider: str, actor_id: str | None) -> Sequence[ModelCredentialRecord]:
        names = [provider]
        provider_id = ModelProviderID(provider)
        if provider_id.is_langgenius():
            names.append(provider_id.provider_name if "/" in provider else str(provider_id))
        query = (
            select(ProviderCredential)
            .where(ProviderCredential.tenant_id == workspace_id, ProviderCredential.provider_name.in_(names))
            .order_by(ProviderCredential.created_at.desc())
        )
        if actor_id is not None:
            query = apply_credential_visibility_filter_for_actor(
                query,
                tenant_id=workspace_id,
                model_id_column=ProviderCredential.id,
                model_user_id_column=ProviderCredential.user_id,
                model_visibility_column=ProviderCredential.visibility,
                credential_type=CredentialType.PROVIDER_CREDENTIAL,
                actor_id=actor_id,
            )
        with self._session_factory() as session:
            return [ModelCredentialRecord(row.id, row.credential_name) for row in session.scalars(query)]

    @override
    def list_datasources(
        self, *, workspace_id: str, provider: str, plugin_id: str, actor_id: str | None
    ) -> Sequence[DatasourceCredentialListItem]:
        owner = (
            DatasourceProvider.tenant_id == workspace_id,
            DatasourceProvider.provider == provider,
            DatasourceProvider.plugin_id == plugin_id,
        )
        query = select(DatasourceProvider).where(*owner)
        if actor_id is not None:
            query = apply_credential_visibility_filter_for_actor(
                query,
                tenant_id=workspace_id,
                model_id_column=DatasourceProvider.id,
                model_user_id_column=DatasourceProvider.user_id,
                model_visibility_column=DatasourceProvider.visibility,
                credential_type=CredentialType.DATASOURCE_PROVIDER,
                actor_id=actor_id,
            )
        with self._session_factory() as session:
            rows = session.scalars(query).all()
            if not rows:
                return []
            # Preserve the configured default even when that credential is hidden from this actor.
            default_id = session.scalar(
                select(DatasourceProvider.id)
                .where(*owner)
                .order_by(DatasourceProvider.is_default.desc(), DatasourceProvider.created_at.asc())
                .limit(1)
            )
            return [
                DatasourceCredentialListItem(
                    id=row.id,
                    name=row.name,
                    auth_type=row.auth_type,
                    encrypted_credentials=dict(row.encrypted_credentials),
                    avatar_url=row.avatar_url,
                    is_default=row.id == default_id,
                )
                for row in rows
            ]

    @override
    def list_tools(
        self,
        *,
        workspace_id: str,
        provider: str,
        actor_id: str | None,
        include_credential_ids: Sequence[str] = (),
    ) -> Sequence[ToolCredentialRecord]:
        owner = (BuiltinToolProvider.tenant_id == workspace_id, BuiltinToolProvider.provider == provider)
        order = (BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
        query = select(BuiltinToolProvider).where(*owner).order_by(*order)
        if actor_id is not None:
            query = apply_credential_visibility_filter_for_actor(
                query,
                tenant_id=workspace_id,
                model_id_column=BuiltinToolProvider.id,
                model_user_id_column=BuiltinToolProvider.user_id,
                model_visibility_column=BuiltinToolProvider.visibility,
                credential_type=CredentialType.BUILTIN_TOOL_PROVIDER,
                actor_id=actor_id,
            )
        with self._session_factory() as session:
            visible = list(session.scalars(query))
            wanted = set(include_credential_ids) - {row.id for row in visible} - {""}
            borrowed: list[BuiltinToolProvider] = (
                list(
                    session.scalars(
                        select(BuiltinToolProvider).where(*owner, BuiltinToolProvider.id.in_(wanted)).order_by(*order)
                    )
                )
                if wanted
                else []
            )
            rows = visible + borrowed
            partial_ids = [row.id for row in rows if row.visibility == PermissionEnum.PARTIAL_TEAM]
            members: dict[str, list[str]] = {}
            if partial_ids:
                for credential_id, account_id in session.execute(
                    select(CredentialPermission.credential_id, CredentialPermission.account_id).where(
                        CredentialPermission.tenant_id == workspace_id,
                        CredentialPermission.credential_type == CredentialType.BUILTIN_TOOL_PROVIDER,
                        CredentialPermission.credential_id.in_(partial_ids),
                        CredentialPermission.has_permission.is_(True),
                    )
                ):
                    members.setdefault(credential_id, []).append(account_id)
            borrowed_ids = {row.id for row in borrowed}
            return [
                ToolCredentialRecord(
                    id=row.id,
                    name=row.name,
                    provider=row.provider,
                    credential_type=row.credential_type,
                    credentials=dict(row.credentials),
                    is_default=(bool(visible) and row.id == visible[0].id) or row.is_default,
                    visibility=str(row.visibility),
                    created_by=row.user_id or "",
                    partial_member_ids=tuple(members.get(row.id, [])),
                    from_other_member=row.id in borrowed_ids,
                )
                for row in rows
            ]

    @override
    def list_trigger_subscriptions(
        self, *, workspace_id: str, provider: str, actor_id: str | None
    ) -> Sequence[TriggerSubscriptionRecord]:
        query = (
            select(TriggerSubscription)
            .where(TriggerSubscription.tenant_id == workspace_id, TriggerSubscription.provider_id == provider)
            .order_by(TriggerSubscription.created_at.desc())
        )
        if actor_id is not None:
            query = apply_credential_visibility_filter_for_actor(
                query,
                tenant_id=workspace_id,
                model_id_column=TriggerSubscription.id,
                model_user_id_column=TriggerSubscription.user_id,
                model_visibility_column=TriggerSubscription.visibility,
                credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
                actor_id=actor_id,
            )
        with self._session_factory() as session:
            rows = session.scalars(query).all()
            if not rows:
                return []
            counts = dict(
                session.execute(
                    select(
                        WorkflowPluginTrigger.subscription_id, func.count(func.distinct(WorkflowPluginTrigger.app_id))
                    )
                    .where(
                        WorkflowPluginTrigger.tenant_id == workspace_id,
                        WorkflowPluginTrigger.subscription_id.in_([row.id for row in rows]),
                    )
                    .group_by(WorkflowPluginTrigger.subscription_id)
                )
                .tuples()
                .all()
            )
            return [
                TriggerSubscriptionRecord(
                    id=row.id,
                    name=row.name,
                    provider=row.provider_id,
                    credential_type=row.credential_type,
                    credentials=dict(row.credentials),
                    endpoint_id=row.endpoint_id,
                    parameters=dict(row.parameters),
                    properties=dict(row.properties),
                    workflows_in_use=counts.get(row.id, 0),
                )
                for row in rows
            ]
