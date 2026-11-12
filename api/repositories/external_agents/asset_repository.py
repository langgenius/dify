"""Tenant-scoped External asset transactions and immutable connection revisions."""

from datetime import UTC, datetime
from itertools import starmap
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from libs.helper import escape_like_pattern
from libs.uuid_utils import uuidv7
from machinery.context import RequestContext
from models.account import Tenant, TenantAccountJoin
from models.agent import Agent, AgentIconType, AgentKind, AgentScope, AgentSource, AgentStatus, WorkflowAgentNodeBinding
from models.enums import AppStatus
from models.external_agent import (
    ExternalAgentConnectionRevision,
    ExternalAgentContextSlot,
    ExternalAgentHead,
    ExternalAgentInvocation,
    ExternalAgentOperation,
    ExternalAgentVerification,
)
from models.external_agent_trace import ExternalAgentDataTombstone
from models.model import App
from models.workflow import Workflow
from services.external_agents.contracts import (
    AssetPage,
    ConnectionRevision,
    ExternalAgentConflictError,
    ExternalAgentForbiddenError,
    ExternalAgentIdempotencyConflictError,
    ExternalAgentInvalidInputError,
    ExternalAgentNotFoundError,
    ExternalAsset,
    ExternalAssetAppReference,
    ExternalAssetReferences,
    OperationResult,
    VerificationEvidence,
)


def db_time(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


def utc_time(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class ExternalAssetRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    @staticmethod
    def _statement(tenant_id: str):
        return (
            select(Agent, ExternalAgentHead)
            .join(
                ExternalAgentHead,
                (ExternalAgentHead.agent_id == Agent.id) & (ExternalAgentHead.tenant_id == Agent.tenant_id),
            )
            .where(Agent.tenant_id == tenant_id, Agent.agent_kind == AgentKind.EXTERNAL_A2A)
        )

    @classmethod
    def _rows(
        cls, session: Session, tenant_id: str, agent_id: str, *, lock: bool = False, allow_deleted: bool = False
    ) -> tuple[Agent, ExternalAgentHead]:
        stmt = cls._statement(tenant_id).where(Agent.id == agent_id)
        if not allow_deleted:
            stmt = stmt.where(Agent.status == AgentStatus.ACTIVE, ExternalAgentHead.deleted_at.is_(None))
        if lock:
            stmt = stmt.with_for_update()
        row = session.execute(stmt).one_or_none()
        if row is None:
            raise ExternalAgentNotFoundError("External Agent not found.")
        return row[0], row[1]

    @staticmethod
    def _manager(session: Session, context: RequestContext) -> None:
        ExternalAssetRepository._writer_role(session, context, allowed_roles=frozenset({"owner", "admin"}))

    @staticmethod
    def _writer_role(session: Session, context: RequestContext, *, allowed_roles: frozenset[str]) -> None:
        # Serialize tenant retirement with short control-plane writes. Deletion
        # acquires this same parent lock before its tombstone and head fences.
        if session.scalar(select(Tenant.id).where(Tenant.id == context.active_workspace_id).with_for_update()) is None:
            raise ExternalAgentForbiddenError("The workspace is unavailable.")
        # The role must remain valid atomically with the write, including after
        # slow read-only verification. Lock the membership before the head.
        role = session.scalar(
            select(TenantAccountJoin.role)
            .where(
                TenantAccountJoin.tenant_id == context.active_workspace_id,
                TenantAccountJoin.account_id == context.account_id,
            )
            .with_for_update()
        )
        if role not in allowed_roles:
            raise ExternalAgentForbiddenError("Current workspace membership does not allow this write.")
        if session.scalar(
            select(ExternalAgentDataTombstone.id).where(
                ExternalAgentDataTombstone.tenant_id == context.active_workspace_id,
                ExternalAgentDataTombstone.owner_kind == "tenant",
                ExternalAgentDataTombstone.owner_id == context.active_workspace_id,
            )
        ):
            raise ExternalAgentForbiddenError("The workspace lifecycle has revoked new External Agent writes.")

    @staticmethod
    def _asset(agent: Agent, head: ExternalAgentHead) -> ExternalAsset:
        if head.active_connection_revision_id is None:
            raise ExternalAgentNotFoundError("The External Agent has no saved connection.")
        return ExternalAsset(
            id=agent.id,
            tenant_id=agent.tenant_id,
            name=agent.name,
            description=agent.description,
            role=agent.role,
            icon_type=agent.icon_type.value if agent.icon_type else None,
            icon=agent.icon,
            icon_background=agent.icon_background,
            enabled=head.enabled,
            tracing_enabled=head.tracing_enabled,
            active_connection_revision_id=head.active_connection_revision_id,
            metadata_revision=head.metadata_revision,
            row_version=head.row_version,
            test_display_generation=head.test_display_generation,
            overrides=tuple(head.overrides),
            created_by=agent.created_by or "",
            created_at=utc_time(agent.created_at),
            updated_at=utc_time(agent.updated_at),
            deleted_at=utc_time(head.deleted_at) if head.deleted_at else None,
        )

    def list_assets(
        self,
        *,
        tenant_id: str,
        page: int,
        limit: int,
        keyword: str | None,
        enabled: bool | None,
        created_by: str | None,
        visible_ids: frozenset[str] | None,
    ) -> AssetPage:
        stmt = self._statement(tenant_id).where(
            Agent.status == AgentStatus.ACTIVE, ExternalAgentHead.deleted_at.is_(None)
        )
        if keyword:
            stmt = stmt.where(Agent.name.ilike("%" + escape_like_pattern(keyword) + "%", escape="\\"))
        if enabled is not None:
            stmt = stmt.where(ExternalAgentHead.enabled == enabled)
        if created_by is not None:
            stmt = stmt.where(Agent.created_by == created_by)
        if visible_ids is not None:
            stmt = stmt.where(Agent.id.in_(visible_ids))
        with self._sessions() as session:
            total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
            rows = session.execute(
                stmt.order_by(Agent.updated_at.desc(), Agent.id).offset((page - 1) * limit).limit(limit)
            ).all()
            return AssetPage(items=tuple(starmap(self._asset, rows)), total=total, page=page, limit=limit)

    def get_asset(self, *, tenant_id: str, agent_id: str) -> ExternalAsset:
        with self._sessions() as session:
            return self._asset(*self._rows(session, tenant_id, agent_id))

    def get_connection(self, *, tenant_id: str, agent_id: str, revision_id: str) -> ConnectionRevision:
        with self._sessions() as session:
            row = session.scalar(
                select(ExternalAgentConnectionRevision).where(
                    ExternalAgentConnectionRevision.tenant_id == tenant_id,
                    ExternalAgentConnectionRevision.agent_id == agent_id,
                    ExternalAgentConnectionRevision.id == revision_id,
                )
            )
            if row is None:
                raise ExternalAgentNotFoundError("Saved connection not found.")
            return ConnectionRevision(
                id=row.id,
                tenant_id=row.tenant_id,
                agent_id=row.agent_id,
                endpoint=row.endpoint,
                interface_url=row.interface_url,
                auth_type=row.auth_type,
                credential_ciphertext=row.credential_ciphertext,
                card=dict(row.agent_card),
                capabilities=dict(row.capabilities),
                auth_check=row.auth_check,
                verified_at=utc_time(row.verified_at),
                profile=row.profile,
                secret_cleared_at=utc_time(row.secret_cleared_at) if row.secret_cleared_at else None,
            )

    def save_verification(self, evidence: VerificationEvidence) -> None:
        with self._sessions.begin() as session:
            self._manager(session, RequestContext(evidence.id, None, evidence.actor_id, evidence.tenant_id))
            session.add(
                ExternalAgentVerification(
                    id=evidence.id,
                    tenant_id=evidence.tenant_id,
                    actor_id=evidence.actor_id,
                    agent_id=evidence.agent_id,
                    endpoint=evidence.endpoint,
                    interface_url=evidence.interface_url,
                    auth_type=evidence.auth_type,
                    credential_ciphertext=evidence.credential_ciphertext,
                    auth_check=evidence.auth_check,
                    agent_card=dict(evidence.card),
                    capabilities=dict(evidence.capabilities),
                    fingerprint=evidence.fingerprint,
                    expected_connection_revision_id=evidence.expected_connection_revision_id,
                    created_at=db_time(evidence.created_at),
                    expires_at=db_time(evidence.expires_at),
                )
            )

    def get_verification(self, *, tenant_id: str, actor_id: str, evidence_id: str) -> VerificationEvidence:
        with self._sessions() as session:
            row = self._proof(session, tenant_id, actor_id, evidence_id, lock=False)
            return VerificationEvidence(
                id=row.id,
                tenant_id=row.tenant_id,
                actor_id=row.actor_id,
                agent_id=row.agent_id,
                endpoint=row.endpoint,
                interface_url=row.interface_url,
                auth_type=row.auth_type,
                credential_ciphertext=row.credential_ciphertext,
                auth_check=row.auth_check,
                card=dict(row.agent_card),
                capabilities=dict(row.capabilities),
                fingerprint=row.fingerprint,
                expected_connection_revision_id=row.expected_connection_revision_id,
                created_at=utc_time(row.created_at),
                expires_at=utc_time(row.expires_at),
            )

    @staticmethod
    def _proof(session: Session, tenant: str, actor: str, evidence: str, *, lock: bool) -> ExternalAgentVerification:
        stmt = select(ExternalAgentVerification).where(
            ExternalAgentVerification.id == evidence,
            ExternalAgentVerification.tenant_id == tenant,
            ExternalAgentVerification.actor_id == actor,
        )
        row = session.scalar(stmt.with_for_update() if lock else stmt)
        if row is None or row.expires_at <= now() or row.consumed_at is not None:
            raise ExternalAgentInvalidInputError("Connection verification is absent, expired or already used.")
        return row

    @staticmethod
    def _operation_result(op: ExternalAgentOperation) -> OperationResult:
        return OperationResult(
            id=op.id,
            tenant_id=op.tenant_id,
            actor_id=op.actor_id,
            kind=op.kind,
            resource_id=op.resource_id,
            result=dict(op.result),
        )

    @classmethod
    def _existing_operation(
        cls, session: Session, context: RequestContext, kind: str, key: str, fingerprint: str
    ) -> OperationResult | None:
        op = session.scalar(
            select(ExternalAgentOperation).where(
                ExternalAgentOperation.tenant_id == context.active_workspace_id,
                ExternalAgentOperation.actor_id == context.account_id,
                ExternalAgentOperation.kind == kind,
                ExternalAgentOperation.idempotency_key == key,
            )
        )
        if op is None:
            return None
        if op.fingerprint != fingerprint:
            raise ExternalAgentIdempotencyConflictError("The idempotency key belongs to a different operation.")
        return cls._operation_result(op)

    @staticmethod
    def _revision(proof: ExternalAgentVerification, agent_id: str, actor: str) -> ExternalAgentConnectionRevision:
        return ExternalAgentConnectionRevision(
            id=str(uuidv7()),
            tenant_id=proof.tenant_id,
            agent_id=agent_id,
            endpoint=proof.endpoint,
            interface_url=proof.interface_url,
            auth_type=proof.auth_type,
            credential_ciphertext=proof.credential_ciphertext,
            agent_card=dict(proof.agent_card),
            capabilities={
                key: value for key, value in proof.capabilities.items() if key != "connection_change_warnings"
            },
            fingerprint=proof.fingerprint,
            auth_check=proof.auth_check,
            created_by=actor,
            verified_at=proof.created_at,
        )

    @classmethod
    def _receipt(
        cls,
        session: Session,
        context: RequestContext,
        kind: str,
        key: str,
        fingerprint: str,
        asset: ExternalAsset,
        *,
        changed: bool,
    ) -> OperationResult:
        op = ExternalAgentOperation(
            id=str(uuidv7()),
            tenant_id=context.active_workspace_id,
            actor_id=context.account_id,
            kind=kind,
            idempotency_key=key,
            fingerprint=fingerprint,
            resource_id=asset.id,
            result={
                "agent_id": asset.id,
                "connection_revision_id": asset.active_connection_revision_id,
                "metadata_revision": asset.metadata_revision,
                "test_display_generation": asset.test_display_generation,
                "changed": changed,
            },
        )
        session.add(op)
        session.flush()
        return cls._operation_result(op)

    def create_asset(
        self,
        *,
        context: RequestContext,
        evidence_id: str,
        metadata: dict[str, Any],
        operation_key: str,
        fingerprint: str,
    ) -> OperationResult:
        try:
            with self._sessions.begin() as session:
                self._manager(session, context)
                existing = self._existing_operation(session, context, "create", operation_key, fingerprint)
                if existing:
                    return existing
                proof = self._proof(session, context.active_workspace_id, context.account_id, evidence_id, lock=True)
                if proof.agent_id is not None:
                    raise ExternalAgentInvalidInputError("Existing-asset evidence cannot create another asset.")
                agent_id = str(uuidv7())
                revision = self._revision(proof, agent_id, context.account_id)
                name = metadata.get("name", proof.agent_card["name"])
                agent = Agent(
                    id=agent_id,
                    tenant_id=context.active_workspace_id,
                    name=name,
                    description=metadata.get("description", proof.agent_card.get("description", "")) or "",
                    role=metadata.get("role", "") or "",
                    agent_kind=AgentKind.EXTERNAL_A2A,
                    scope=AgentScope.ROSTER,
                    source=AgentSource.ROSTER,
                    created_by=context.account_id,
                    updated_by=context.account_id,
                    icon_type=AgentIconType(metadata["icon_type"]) if metadata.get("icon_type") else None,
                    icon=metadata.get("icon"),
                    icon_background=metadata.get("icon_background"),
                )
                head = ExternalAgentHead(
                    agent_id=agent_id,
                    tenant_id=context.active_workspace_id,
                    active_connection_revision_id=revision.id,
                    overrides=sorted(metadata),
                )
                session.add_all([agent, head, revision])
                proof.consumed_at = now()
                proof.credential_ciphertext = None
                session.flush()
                return self._receipt(
                    session, context, "create", operation_key, fingerprint, self._asset(agent, head), changed=True
                )
        except IntegrityError as error:
            with self._sessions() as session:
                existing = self._existing_operation(session, context, "create", operation_key, fingerprint)
                if existing:
                    return existing
            raise ExternalAgentConflictError("The asset name or operation changed concurrently.") from error

    def update_connection(
        self,
        *,
        context: RequestContext,
        agent_id: str,
        evidence_id: str,
        expected_revision_id: str,
        operation_key: str,
        fingerprint: str,
    ) -> OperationResult:
        try:
            with self._sessions.begin() as session:
                self._manager(session, context)
                existing = self._existing_operation(session, context, "connection", operation_key, fingerprint)
                if existing:
                    return existing
                agent, head = self._rows(session, context.active_workspace_id, agent_id, lock=True)
                if head.active_connection_revision_id != expected_revision_id:
                    raise ExternalAgentConflictError("The connection changed; verify against the latest version.")
                proof = self._proof(session, context.active_workspace_id, context.account_id, evidence_id, lock=True)
                if proof.agent_id != agent_id or proof.expected_connection_revision_id != expected_revision_id:
                    raise ExternalAgentInvalidInputError("Verification does not belong to this connection edit.")
                old = session.scalar(
                    select(ExternalAgentConnectionRevision).where(
                        ExternalAgentConnectionRevision.tenant_id == context.active_workspace_id,
                        ExternalAgentConnectionRevision.agent_id == agent_id,
                        ExternalAgentConnectionRevision.id == expected_revision_id,
                    )
                )
                if old is None:
                    raise ExternalAgentNotFoundError("Saved connection not found.")
                changed = old.fingerprint != proof.fingerprint
                if changed:
                    revision = self._revision(proof, agent_id, context.account_id)
                    session.add(revision)
                    head.active_connection_revision_id = revision.id
                    head.row_version += 1
                    head.test_display_generation += 1
                    head.updated_at = now()
                    agent.updated_at = now()
                    agent.updated_by = context.account_id
                    if not revision.capabilities.get("traceability_supported"):
                        head.tracing_enabled = False
                    if "description" not in head.overrides:
                        description = proof.agent_card.get("description", "")
                        if agent.description != description:
                            agent.description = description
                            head.metadata_revision += 1
                proof.consumed_at = now()
                proof.credential_ciphertext = None
                session.flush()
                return self._receipt(
                    session,
                    context,
                    "connection",
                    operation_key,
                    fingerprint,
                    self._asset(agent, head),
                    changed=changed,
                )
        except IntegrityError as error:
            with self._sessions() as session:
                existing = self._existing_operation(session, context, "connection", operation_key, fingerprint)
                if existing:
                    return existing
            raise ExternalAgentConflictError("The connection changed concurrently.") from error

    def update_info(
        self, *, context: RequestContext, agent_id: str, expected_revision: int, changes: dict[str, Any]
    ) -> ExternalAsset:
        """Save admitted display changes under the current metadata revision.

        Preconditions: the caller owns management access and changes use the
        presentation allowlist validated by the application service. Success
        updates only changed fields and invalidates stale test generations;
        denied or stale requests commit no metadata or context changes.
        """
        try:
            with self._sessions.begin() as session:
                self._manager(session, context)
                agent, head = self._rows(session, context.active_workspace_id, agent_id, lock=True)
                if head.metadata_revision != expected_revision:
                    raise ExternalAgentConflictError("Agent information changed concurrently.")
                changed = False
                changed_fields: set[str] = set()
                current_info = {
                    "name": agent.name,
                    "description": agent.description,
                    "role": agent.role,
                    "icon_type": agent.icon_type,
                    "icon": agent.icon,
                    "icon_background": agent.icon_background,
                }
                for key, value in changes.items():
                    if key in {"description", "role"} and value is None:
                        value = ""
                    if key == "icon_type" and value is not None:
                        value = AgentIconType(value)
                    if current_info[key] != value:
                        setattr(agent, key, value)
                        changed = True
                        changed_fields.add(key)
                if changed:
                    head.overrides = sorted(set(head.overrides) | changed_fields)
                    head.metadata_revision += 1
                    head.row_version += 1
                    head.test_display_generation += 1
                    head.updated_at = now()
                    agent.updated_at = now()
                    agent.updated_by = context.account_id
                session.flush()
                return self._asset(agent, head)
        except IntegrityError as error:
            raise ExternalAgentConflictError("An active Agent already uses this name.") from error

    def set_enabled(self, *, context: RequestContext, agent_id: str, enabled: bool) -> ExternalAsset:
        with self._sessions.begin() as session:
            self._manager(session, context)
            agent, head = self._rows(session, context.active_workspace_id, agent_id, lock=True)
            if head.enabled != enabled:
                head.enabled = enabled
                head.row_version += 1
                head.updated_at = now()
                agent.updated_at = now()
                agent.updated_by = context.account_id
            return self._asset(agent, head)

    def set_tracing(self, *, context: RequestContext, agent_id: str, enabled: bool) -> ExternalAsset:
        with self._sessions.begin() as session:
            self._manager(session, context)
            agent, head = self._rows(session, context.active_workspace_id, agent_id, lock=True)
            revision = session.scalar(
                select(ExternalAgentConnectionRevision).where(
                    ExternalAgentConnectionRevision.tenant_id == context.active_workspace_id,
                    ExternalAgentConnectionRevision.agent_id == agent_id,
                    ExternalAgentConnectionRevision.id == head.active_connection_revision_id,
                )
            )
            if enabled and (revision is None or not revision.capabilities.get("traceability_supported")):
                raise ExternalAgentInvalidInputError("Tracing is not supported by the saved connection.")
            if head.tracing_enabled != enabled:
                head.tracing_enabled = enabled
                head.row_version += 1
                head.updated_at = now()
                agent.updated_at = now()
                agent.updated_by = context.account_id
            return self._asset(agent, head)

    def archive(self, *, context: RequestContext, agent_id: str) -> None:
        with self._sessions.begin() as session:
            self._manager(session, context)
            agent, head = self._rows(session, context.active_workspace_id, agent_id, lock=True, allow_deleted=True)
            if head.deleted_at is not None:
                return
            head.deleted_at = now()
            head.enabled = False
            head.row_version += 1
            agent.status = AgentStatus.ARCHIVED
            agent.archived_by = context.account_id
            agent.archived_at = now()

    def operation(self, *, context: RequestContext, operation_id: str) -> OperationResult:
        with self._sessions() as session:
            op = session.scalar(
                select(ExternalAgentOperation).where(
                    ExternalAgentOperation.id == operation_id,
                    ExternalAgentOperation.tenant_id == context.active_workspace_id,
                    ExternalAgentOperation.actor_id == context.account_id,
                )
            )
            if op is None:
                raise ExternalAgentNotFoundError("Operation not found.")
            return self._operation_result(op)

    def references(self, *, tenant_id: str, agent_id: str, app_ids: frozenset[str] | None) -> ExternalAssetReferences:
        """Read active graph references and a conservative, identity-free warning.

        All statements use the validated tenant/asset. App rows additionally
        use the admitted readable-App set and only draft/current published
        graphs. Retained unknown submissions and occupied ContextSlots still
        warn after local waiting or parent retention ends; time alone does not
        prove that remote work stopped. This snapshot cannot serialize a later
        dispatch against deletion and deliberately supplies no such guarantee.
        """
        with self._sessions() as session:
            self._rows(session, tenant_id, agent_id)
            stmt = (
                select(App.id, App.name, App.mode, WorkflowAgentNodeBinding.node_id)
                .join(
                    WorkflowAgentNodeBinding,
                    (WorkflowAgentNodeBinding.app_id == App.id) & (WorkflowAgentNodeBinding.tenant_id == App.tenant_id),
                )
                .join(
                    Workflow,
                    (Workflow.id == WorkflowAgentNodeBinding.workflow_id)
                    & (Workflow.tenant_id == App.tenant_id)
                    & (Workflow.app_id == App.id),
                )
                .where(
                    App.tenant_id == tenant_id,
                    App.status == AppStatus.NORMAL,
                    WorkflowAgentNodeBinding.agent_id == agent_id,
                    WorkflowAgentNodeBinding.tenant_id == tenant_id,
                    (
                        (WorkflowAgentNodeBinding.workflow_version == Workflow.VERSION_DRAFT)
                        & (Workflow.version == Workflow.VERSION_DRAFT)
                    )
                    | (App.workflow_id == WorkflowAgentNodeBinding.workflow_id),
                )
            )
            if app_ids is not None:
                stmt = stmt.where(App.id.in_(app_ids))
            grouped: dict[str, dict[str, Any]] = {}
            for id, name, mode, node in session.execute(stmt):
                item = grouped.setdefault(id, {"app_id": id, "name": name, "mode": str(mode), "node_ids": []})
                if node not in item["node_ids"]:
                    item["node_ids"].append(node)
            active = session.scalar(
                select(ExternalAgentInvocation.id)
                .where(
                    ExternalAgentInvocation.tenant_id == tenant_id,
                    ExternalAgentInvocation.agent_id == agent_id,
                    or_(
                        ExternalAgentInvocation.local_state.in_(("queued", "waiting", "retry_pending")),
                        ExternalAgentInvocation.submission_state.in_(("send_started", "submission_unknown")),
                        (
                            ExternalAgentInvocation.remote_task_id.is_not(None)
                            & or_(
                                ExternalAgentInvocation.remote_state.is_(None),
                                ExternalAgentInvocation.remote_state.not_in(
                                    ("completed", "canceled", "failed", "rejected")
                                ),
                            )
                        ),
                    ),
                )
                .limit(1)
            )
            occupied = session.scalar(
                select(ExternalAgentContextSlot.key)
                .where(
                    ExternalAgentContextSlot.tenant_id == tenant_id,
                    ExternalAgentContextSlot.agent_id == agent_id,
                    or_(
                        ExternalAgentContextSlot.reserved_invocation_id.is_not(None),
                        ExternalAgentContextSlot.unresolved.is_(True),
                    ),
                )
                .limit(1)
            )
            return ExternalAssetReferences(
                apps=tuple(
                    ExternalAssetAppReference(
                        app_id=item["app_id"],
                        name=item["name"],
                        mode=item["mode"],
                        node_ids=tuple(sorted(item["node_ids"])),
                    )
                    for key in sorted(grouped)
                    for item in (grouped[key],)
                ),
                may_have_in_flight=active is not None or occupied is not None,
            )
