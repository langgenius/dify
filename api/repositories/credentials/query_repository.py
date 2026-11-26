"""Persistence-owned credential queries and visibility filtering shared across domains."""

import json
from collections.abc import Sequence
from copy import deepcopy
from typing import override

from sqlalchemy import and_, false, func, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import InstrumentedAttribute, Session, sessionmaker
from sqlalchemy.sql.elements import ColumnElement

from libs.datetime_utils import naive_utc_now
from models.credential_permission import CredentialPermission, CredentialType
from models.enums import PermissionEnum
from models.oauth import DatasourceProvider
from models.provider import ProviderCredential, ProviderModelCredential
from models.provider_ids import ModelProviderID, ToolProviderID
from models.tools import BuiltinToolProvider
from models.trigger import TriggerSubscription, WorkflowPluginTrigger
from models.workflow import Workflow
from services.credentials.query import (
    CredentialQuery,
    DatasourceCredentialListItem,
    ModelCredentialRecord,
    ToolCredentialMetadata,
    ToolCredentialRecord,
    ToolCredentialSnapshot,
    TriggerSubscriptionRecord,
    WorkflowToolCredentialMetadata,
)
from services.credentials.tool_runtime import ToolRuntimeCredential
from services.workflow_ref_service import WorkflowRef


def _workflow_tool_binding_graph(
    session: Session,
    *,
    workflow_ref: WorkflowRef,
    node_id: str,
    provider: str,
    action: str,
    credential_id: str,
    lock: bool = False,
) -> str | None:
    """Read an exact saved node binding; optionally lock it for a local SQL operation.

    No credential values or external I/O are involved. Missing or changed node,
    provider, action, credential or workflow ownership returns None.
    """
    statement = select(Workflow.graph).where(
        Workflow.tenant_id == workflow_ref.tenant_id,
        Workflow.app_id == workflow_ref.owner_id,
        Workflow.id == workflow_ref.workflow_id,
        Workflow.version == Workflow.VERSION_DRAFT,
    )
    graph = session.scalar(statement.with_for_update() if lock else statement)
    if graph is None:
        return None
    nodes = [node for node in json.loads(graph).get("nodes", []) if node.get("id") == node_id]
    if len(nodes) != 1:
        return None
    data = nodes[0].get("data", {})
    stored_provider = data.get("provider_id") or data.get("provider_name")
    if (
        data.get("type") != "tool"
        or data.get("provider_type", "builtin") not in {"builtin", "plugin"}
        or data.get("tool_name") != action
        or data.get("credential_id") != credential_id
        or not isinstance(stored_provider, str)
        or not stored_provider
    ):
        return None
    try:
        return graph if str(ToolProviderID(stored_provider)) == provider else None
    except ValueError:
        return None


def workflow_tool_credential_binding_condition(
    session: Session, credential: WorkflowToolCredentialMetadata
) -> ColumnElement[bool]:
    """Recheck and lock only the saved binding inside the native read/write session.

    Unrelated autosaves during external OAuth I/O are accepted. The caller closes
    this short SQL transaction before decrypting or contacting a provider.
    """
    ref = credential.workflow_ref
    graph = _workflow_tool_binding_graph(
        session,
        workflow_ref=ref,
        node_id=credential.node_id,
        provider=str(ToolProviderID(credential.provider)),
        action=credential.action,
        credential_id=credential.id,
        lock=True,
    )
    if graph is None:
        return false()
    return (
        select(Workflow.id)
        .where(
            Workflow.tenant_id == ref.tenant_id,
            Workflow.app_id == ref.owner_id,
            Workflow.id == ref.workflow_id,
            Workflow.version == Workflow.VERSION_DRAFT,
            Workflow.graph == graph,
        )
        .exists()
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
    """Load stored credentials without exposing ORM objects or SQL to callers."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def model_credentials_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        provider: str,
        provider_credential_ids: Sequence[str],
        model_credential_ids: Sequence[str],
    ) -> bool:
        names = {provider}
        provider_id = ModelProviderID(provider)
        if provider_id.is_langgenius():
            names.add(provider_id.provider_name if "/" in provider else str(provider_id))
        provider_ids = set(provider_credential_ids)
        query = select(ProviderCredential.id).where(
            ProviderCredential.tenant_id == workspace_id,
            ProviderCredential.provider_name.in_(names),
            ProviderCredential.id.in_(provider_ids),
        )
        query = apply_credential_visibility_filter_for_actor(
            query,
            tenant_id=workspace_id,
            actor_id=actor_id,
            model_id_column=ProviderCredential.id,
            model_user_id_column=ProviderCredential.user_id,
            model_visibility_column=ProviderCredential.visibility,
            credential_type=CredentialType.PROVIDER_CREDENTIAL,
        )
        with self._session_factory() as session:
            if set(session.scalars(query)) != provider_ids:
                return False
            # Native custom-model credential rows are tenant shared (the native
            # schema has no actor visibility fields); still verify exact IDs.
            model_ids = set(model_credential_ids)
            visible = set(
                session.scalars(
                    select(ProviderModelCredential.id).where(
                        ProviderModelCredential.tenant_id == workspace_id,
                        ProviderModelCredential.provider_name.in_(names),
                        ProviderModelCredential.id.in_(model_ids),
                    )
                )
            )
            return visible == model_ids

    @override
    def list_visible_tool_provider_ids(self, *, workspace_id: str, actor_id: str | None) -> set[str]:
        query = select(BuiltinToolProvider.provider).where(BuiltinToolProvider.tenant_id == workspace_id)
        if actor_id is None:
            query = query.where(
                or_(
                    BuiltinToolProvider.visibility == PermissionEnum.ALL_TEAM,
                    BuiltinToolProvider.user_id.is_(None),
                )
            )
        else:
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
            return set(session.scalars(query))

    @override
    def resolve_tool_credential_metadata(
        self,
        *,
        workspace_id: str,
        provider: str,
        legacy_provider: str | None,
        actor_id: str | None,
        credential_id: str | None,
    ) -> ToolCredentialMetadata | None:
        """Read scalar native selection without borrowing a different visible row."""
        providers = (provider, legacy_provider) if legacy_provider is not None else (provider,)
        owner = (BuiltinToolProvider.tenant_id == workspace_id, BuiltinToolProvider.provider.in_(providers))
        query = select(BuiltinToolProvider.id, BuiltinToolProvider.provider).where(*owner)
        if credential_id is not None:
            query = query.where(BuiltinToolProvider.id == credential_id)
        else:
            # Native orders only by default/creation time. Refuse tied winners:
            # a visible row must never mask a hidden equally ranked native row.
            candidates = (
                select(
                    BuiltinToolProvider.id,
                    BuiltinToolProvider.is_default,
                    BuiltinToolProvider.created_at,
                )
                .where(*owner)
                .order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
                .limit(2)
            )
            with self._session_factory() as session:
                rows = session.execute(candidates).all()
            if not rows or (len(rows) > 1 and rows[0][1:] == rows[1][1:]):
                return None
            query = query.where(BuiltinToolProvider.id == rows[0][0])
        if actor_id is None:
            query = query.where(
                or_(BuiltinToolProvider.visibility == PermissionEnum.ALL_TEAM, BuiltinToolProvider.user_id.is_(None))
            )
        else:
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
            row = session.execute(query).first()
            return ToolCredentialMetadata(id=row[0], provider=row[1]) if row is not None else None

    @override
    def resolve_workflow_tool_credential_metadata(
        self,
        *,
        workflow_ref: WorkflowRef,
        node_id: str,
        provider: str,
        action: str,
        credential_id: str,
    ) -> WorkflowToolCredentialMetadata | None:
        """Keep ordinary delegation confined to the exact persisted plugin node."""
        with self._session_factory() as session:
            graph = _workflow_tool_binding_graph(
                session,
                workflow_ref=workflow_ref,
                node_id=node_id,
                provider=provider,
                action=action,
                credential_id=credential_id,
            )
            if graph is None:
                return None
            canonical = ToolProviderID(provider)
            providers = {provider}
            if str(ToolProviderID(canonical.provider_name)) == provider:
                providers.add(canonical.provider_name)
            row = session.execute(
                select(BuiltinToolProvider.id, BuiltinToolProvider.provider).where(
                    BuiltinToolProvider.tenant_id == workflow_ref.tenant_id,
                    BuiltinToolProvider.id == credential_id,
                    BuiltinToolProvider.provider.in_(providers),
                )
            ).first()
            if row is None:
                return None
            return WorkflowToolCredentialMetadata(row[0], row[1], workflow_ref, node_id, action)

    def get_tool_credential(
        self, *, workspace_id: str, providers: tuple[str, ...], credential_id: str | None
    ) -> ToolRuntimeCredential | None:
        statement = select(BuiltinToolProvider).where(
            BuiltinToolProvider.tenant_id == workspace_id,
            BuiltinToolProvider.provider.in_(providers),
        )
        if credential_id is not None:
            statement = statement.where(BuiltinToolProvider.id == credential_id)
        with self._session_factory() as session:
            record = session.scalar(
                statement.order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc()).limit(1)
            )
            if record is None:
                return None
            return ToolRuntimeCredential(
                id=record.id,
                workspace_id=workspace_id,
                owner_id=record.user_id,
                provider=record.provider,
                credential_type=record.credential_type.value,
                encrypted_credentials=record.encrypted_credentials,
                expires_at=record.expires_at,
            )

    def update_tool_credential_if_unchanged(
        self, *, record: ToolRuntimeCredential, encrypted_credentials: str, expires_at: int
    ) -> bool:
        with self._session_factory.begin() as session:
            result = session.execute(
                update(BuiltinToolProvider)
                .where(
                    BuiltinToolProvider.id == record.id,
                    BuiltinToolProvider.tenant_id == record.workspace_id,
                    BuiltinToolProvider.provider == record.provider,
                    BuiltinToolProvider.user_id == record.owner_id,
                    BuiltinToolProvider.credential_type == record.credential_type,
                    BuiltinToolProvider.encrypted_credentials == record.encrypted_credentials,
                    BuiltinToolProvider.expires_at == record.expires_at,
                )
                .values(
                    encrypted_credentials=encrypted_credentials,
                    expires_at=expires_at,
                    updated_at=naive_utc_now(),
                )
            )
            assert isinstance(result, CursorResult)
            if result.rowcount not in (0, 1):
                raise ValueError("Tool credential refresh affected-row count is uncertain.")
            return result.rowcount == 1

    def get_tool(self, *, workspace_id: str, provider: str, credential_id: str | None) -> ToolCredentialSnapshot | None:
        """Load one credential, using the configured default when its ID is absent or empty."""
        query = select(BuiltinToolProvider).where(
            BuiltinToolProvider.tenant_id == workspace_id, BuiltinToolProvider.provider == provider
        )
        if credential_id:
            query = query.where(BuiltinToolProvider.id == credential_id)
        else:
            query = query.order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
        with self._session_factory() as session:
            row = session.scalar(query.limit(1))
            if row is None:
                return None
            return ToolCredentialSnapshot(
                id=row.id,
                credential_type=row.credential_type.value,
                credentials=deepcopy(row.credentials),
            )

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
