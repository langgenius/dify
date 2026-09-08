"""Short SQL transactions own staging uploads and export leases."""

from collections.abc import Callable
from datetime import datetime, timedelta
from hashlib import sha256
from typing import cast
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from core.ops.trace_data import CompletedTrace, QueuedTrace, TraceProviderSettings
from models.account import Tenant
from models.dataset import Pipeline
from models.model import App, Conversation, Message
from models.ops_trace import OpsTraceDelivery
from models.workflow import Workflow, WorkflowRun


class OpsTraceDeliveryRepository:
    def __init__(self, session_factory: Callable[[], Session]):
        self.session_factory = session_factory

    @staticmethod
    def database_time(session: Session) -> datetime:
        return session.execute(sa.select(sa.func.current_timestamp())).scalar_one()

    def reserve_delivery(self, queued_trace: QueuedTrace) -> tuple[OpsTraceDelivery, bool]:
        completed_trace = CompletedTrace.model_validate_json(queued_trace.trace_json)
        provider_settings = queued_trace.provider_settings
        if completed_trace.source.tenant_id != provider_settings.tenant_id:
            raise ValueError("tenant_mismatch")
        if (
            provider_settings.destination_type == "app_provider"
            and completed_trace.source.app_id != provider_settings.app_id
        ):
            raise ValueError("app_mismatch")
        with self.session_factory() as session:
            now = self.database_time(session)
            delivery = OpsTraceDelivery(
                id=str(uuid4()),
                tenant_id=str(provider_settings.tenant_id),
                app_id=str(completed_trace.source.app_id) if completed_trace.source.app_id else None,
                pipeline_id=str(completed_trace.source.pipeline_id) if completed_trace.source.pipeline_id else None,
                source_type="app"
                if completed_trace.source.app_id
                else "pipeline"
                if completed_trace.source.pipeline_id
                else "workspace",
                export_id=str(queued_trace.export_id),
                trace_id=str(completed_trace.trace_id),
                operation_id=str(completed_trace.source.operation_id),
                root_span_id=str(completed_trace.root_span_id),
                conversation_id=str(completed_trace.source.conversation_id)
                if completed_trace.source.conversation_id
                else None,
                message_id=str(completed_trace.source.message_id) if completed_trace.source.message_id else None,
                workflow_run_id=str(completed_trace.source.workflow_run_id)
                if completed_trace.source.workflow_run_id
                else None,
                destination_type=provider_settings.destination_type,
                provider_name=provider_settings.provider_name,
                config_id=str(provider_settings.config_id) if provider_settings.config_id else None,
                config_revision=provider_settings.config_revision,
                destination_settings_hash=provider_settings.destination_settings_hash,
                trace_sha256=sha256(queued_trace.trace_json).hexdigest(),
                trace_size_bytes=len(queued_trace.trace_json),
                schema_version=completed_trace.schema_version,
                status="staging",
                attempt_count=0,
                parent_export_id=completed_trace.parent.export_id if completed_trace.parent else None,
                parent_span_id=completed_trace.parent.span_id if completed_trace.parent else None,
                next_attempt_at=now,
                attempt_token=str(uuid4()),
                lease_expires_at=now + timedelta(minutes=5),
            )
            try:
                session.add(delivery)
                session.commit()
                session.refresh(delivery)
                session.expunge(delivery)
                return delivery, True
            except IntegrityError:
                session.rollback()
                existing = session.scalar(
                    sa.select(OpsTraceDelivery).where(
                        OpsTraceDelivery.tenant_id == delivery.tenant_id,
                        OpsTraceDelivery.export_id == delivery.export_id,
                    )
                )
                if existing is None:
                    raise
                if any(
                    getattr(existing, field) != getattr(delivery, field)
                    for field in (
                        "trace_sha256",
                        "trace_size_bytes",
                        "app_id",
                        "pipeline_id",
                        "source_type",
                        "trace_id",
                        "destination_type",
                        "provider_name",
                        "config_id",
                        "config_revision",
                        "destination_settings_hash",
                    )
                ):
                    raise ValueError("conflicting_export") from None
                session.expunge(existing)
                return existing, False

    def accept_upload(self, delivery: OpsTraceDelivery) -> bool:
        with self.session_factory() as session:
            result = session.execute(
                sa.update(OpsTraceDelivery)
                .where(
                    OpsTraceDelivery.tenant_id == delivery.tenant_id,
                    OpsTraceDelivery.id == delivery.id,
                    OpsTraceDelivery.status == "staging",
                    OpsTraceDelivery.attempt_token == delivery.attempt_token,
                    OpsTraceDelivery.lease_expires_at > sa.func.current_timestamp(),
                )
                .values(
                    status="pending", attempt_token=None, lease_expires_at=None, updated_at=sa.func.current_timestamp()
                )
            )
            session.commit()
            return cast(CursorResult, result).rowcount == 1

    def get_delivery(self, tenant_id: str, delivery_id: str) -> OpsTraceDelivery | None:
        with self.session_factory() as session:
            delivery = session.scalar(
                sa.select(OpsTraceDelivery).where(
                    OpsTraceDelivery.tenant_id == str(UUID(tenant_id)),
                    OpsTraceDelivery.id == str(UUID(delivery_id)),
                )
            )
            if delivery:
                session.expunge(delivery)
            return delivery

    def claim_delivery(self, tenant_id: str, delivery_id: str, lease_seconds: int = 300) -> OpsTraceDelivery | None:
        attempt_token = str(uuid4())
        with self.session_factory() as session:
            now = self.database_time(session)
            result = session.execute(
                sa.update(OpsTraceDelivery)
                .where(
                    OpsTraceDelivery.tenant_id == str(UUID(tenant_id)),
                    OpsTraceDelivery.id == str(UUID(delivery_id)),
                    sa.or_(
                        sa.and_(OpsTraceDelivery.status == "pending", OpsTraceDelivery.next_attempt_at <= now),
                        sa.and_(OpsTraceDelivery.status == "sending", OpsTraceDelivery.lease_expires_at <= now),
                    ),
                )
                .values(
                    status="sending",
                    attempt_token=attempt_token,
                    lease_expires_at=now + timedelta(seconds=lease_seconds),
                    attempt_count=OpsTraceDelivery.attempt_count + 1,
                    updated_at=now,
                )
            )
            if cast(CursorResult, result).rowcount != 1:
                session.rollback()
                return None
            delivery = session.scalar(
                sa.select(OpsTraceDelivery).where(
                    OpsTraceDelivery.tenant_id == tenant_id,
                    OpsTraceDelivery.id == delivery_id,
                    OpsTraceDelivery.attempt_token == attempt_token,
                )
            )
            session.commit()
            session.refresh(delivery)
            session.expunge(delivery)
            return delivery

    def finish_attempt(
        self,
        delivery: OpsTraceDelivery,
        status: str,
        error_code: str | None = None,
        retry_delay_seconds: int = 0,
        parent_references: dict | None = None,
    ) -> bool:
        if status not in ("pending", "succeeded", "failed", "cancelled"):
            raise ValueError("invalid_delivery_status")
        with self.session_factory() as session:
            now = self.database_time(session)
            result = session.execute(
                sa.update(OpsTraceDelivery)
                .where(
                    OpsTraceDelivery.tenant_id == delivery.tenant_id,
                    OpsTraceDelivery.id == delivery.id,
                    OpsTraceDelivery.status == "sending",
                    OpsTraceDelivery.attempt_token == delivery.attempt_token,
                )
                .values(
                    status=status,
                    error_code=error_code,
                    attempt_token=None,
                    lease_expires_at=None,
                    next_attempt_at=now + timedelta(seconds=retry_delay_seconds),
                    updated_at=now,
                    finished_at=None if status == "pending" else now,
                    parent_references=parent_references,
                )
            )
            session.commit()
            return cast(CursorResult, result).rowcount == 1

    def extend_attempt_lease(self, delivery: OpsTraceDelivery, lease_seconds: int = 300) -> bool:
        """A slow read cannot start an export after another worker acquired its row."""
        with self.session_factory() as session:
            now = self.database_time(session)
            result = session.execute(
                sa.update(OpsTraceDelivery)
                .where(
                    OpsTraceDelivery.tenant_id == delivery.tenant_id,
                    OpsTraceDelivery.id == delivery.id,
                    OpsTraceDelivery.status == "sending",
                    OpsTraceDelivery.attempt_token == delivery.attempt_token,
                    OpsTraceDelivery.lease_expires_at > sa.func.current_timestamp(),
                )
                .values(lease_expires_at=now + timedelta(seconds=lease_seconds), updated_at=now)
            )
            session.commit()
            return cast(CursorResult, result).rowcount == 1

    def due_deliveries(self, limit: int = 100) -> list[tuple[str, str]]:
        with self.session_factory() as session:
            now = self.database_time(session)
            rows = session.execute(
                sa.select(OpsTraceDelivery.tenant_id, OpsTraceDelivery.id)
                .where(
                    sa.or_(
                        sa.and_(
                            OpsTraceDelivery.status == "pending",
                            OpsTraceDelivery.next_attempt_at <= now,
                        ),
                        sa.and_(
                            OpsTraceDelivery.status == "sending",
                            OpsTraceDelivery.lease_expires_at <= now,
                        ),
                    )
                )
                .order_by(OpsTraceDelivery.next_attempt_at)
                .limit(limit)
            ).all()
            return [(row.tenant_id, row.id) for row in rows]

    def validate_trace_owner(self, delivery: OpsTraceDelivery, completed_trace: CompletedTrace) -> None:
        source = completed_trace.source
        if (
            any(
                str(getattr(source, field) or "") != str(getattr(delivery, field) or "")
                for field in (
                    "tenant_id",
                    "app_id",
                    "pipeline_id",
                    "operation_id",
                    "message_id",
                    "conversation_id",
                    "workflow_run_id",
                )
            )
            or str(completed_trace.trace_id) != delivery.trace_id
            or str(completed_trace.root_span_id) != delivery.root_span_id
        ):
            raise ValueError("trace_owner_mismatch")
        with self.session_factory() as session:
            if session.scalar(sa.select(Tenant.id).where(Tenant.id == delivery.tenant_id)) is None:
                raise ValueError("tenant_deleted")
            app_ids = {str(span.source_app_id) for span in completed_trace.spans if span.source_app_id}
            pipeline_ids = {str(span.source_pipeline_id) for span in completed_trace.spans if span.source_pipeline_id}
            if delivery.app_id:
                app_ids.add(delivery.app_id)
            if delivery.pipeline_id:
                pipeline_ids.add(delivery.pipeline_id)
            for owner_model, owner_ids in ((App, app_ids), (Pipeline, pipeline_ids)):
                if (
                    owner_ids
                    and set(
                        session.scalars(
                            sa.select(owner_model.id).where(
                                owner_model.tenant_id == delivery.tenant_id,
                                owner_model.id.in_(owner_ids),
                            )
                        )
                    )
                    != owner_ids
                ):
                    raise ValueError("source_owner_mismatch")
            for workflow_id, app_id, pipeline_id, version in {
                (
                    str(span.source_workflow_id),
                    str(span.source_app_id or ""),
                    str(span.source_pipeline_id or ""),
                    span.source_workflow_version,
                )
                for span in completed_trace.spans
                if span.source_workflow_id
            }:
                workflow = session.scalar(
                    sa.select(Workflow).where(
                        Workflow.id == workflow_id,
                        Workflow.tenant_id == delivery.tenant_id,
                        Workflow.app_id == (app_id or pipeline_id),
                    )
                )
                if workflow is None or (version is not None and workflow.version != version):
                    raise ValueError("workflow_owner_mismatch")
            if (
                delivery.workflow_run_id
                and session.scalar(
                    sa.select(WorkflowRun.id).where(
                        WorkflowRun.id == delivery.workflow_run_id,
                        WorkflowRun.tenant_id == delivery.tenant_id,
                        WorkflowRun.app_id == (delivery.app_id or delivery.pipeline_id),
                    )
                )
                is None
            ):
                raise ValueError("workflow_run_owner_mismatch")
            if (
                delivery.conversation_id
                and session.scalar(
                    sa.select(Conversation.id).where(
                        Conversation.id == delivery.conversation_id,
                        Conversation.app_id == delivery.app_id,
                    )
                )
                is None
            ):
                raise ValueError("conversation_owner_mismatch")
            if delivery.message_id:
                message = session.scalar(
                    sa.select(Message).where(Message.id == delivery.message_id, Message.app_id == delivery.app_id)
                )
                if message is None or (
                    delivery.conversation_id and message.conversation_id != delivery.conversation_id
                ):
                    raise ValueError("message_owner_mismatch")

    @staticmethod
    def provider_settings(delivery: OpsTraceDelivery) -> TraceProviderSettings:
        return TraceProviderSettings(
            tenant_id=delivery.tenant_id,
            app_id=delivery.app_id,
            destination_type=delivery.destination_type,
            provider_name=delivery.provider_name,
            config_id=delivery.config_id,
            config_revision=delivery.config_revision,
            destination_settings_hash=delivery.destination_settings_hash,
        )

    def cancel_expired_uploads(self, limit: int = 100) -> None:
        with self.session_factory() as session:
            rows = session.execute(
                sa.select(OpsTraceDelivery.tenant_id, OpsTraceDelivery.id)
                .where(
                    OpsTraceDelivery.status == "staging",
                    OpsTraceDelivery.lease_expires_at <= sa.func.current_timestamp(),
                )
                .limit(limit)
            ).all()
            for tenant_id, delivery_id in rows:
                session.execute(
                    sa.update(OpsTraceDelivery)
                    .where(
                        OpsTraceDelivery.tenant_id == tenant_id,
                        OpsTraceDelivery.id == delivery_id,
                        OpsTraceDelivery.status == "staging",
                        OpsTraceDelivery.lease_expires_at <= sa.func.current_timestamp(),
                    )
                    .values(
                        status="cancelled",
                        error_code="upload_expired",
                        finished_at=sa.func.current_timestamp(),
                        updated_at=sa.func.current_timestamp(),
                        attempt_token=None,
                        lease_expires_at=None,
                    )
                )
            session.commit()

    def expired_traces(self, limit: int = 100) -> list[OpsTraceDelivery]:
        with self.session_factory() as session:
            now = self.database_time(session)
            rows = list(
                session.scalars(
                    sa.select(OpsTraceDelivery)
                    .where(
                        OpsTraceDelivery.status.in_(("succeeded", "failed", "cancelled")),
                        sa.or_(
                            sa.and_(
                                OpsTraceDelivery.status == "succeeded",
                                OpsTraceDelivery.finished_at <= now - timedelta(days=1),
                            ),
                            sa.and_(
                                OpsTraceDelivery.status.in_(("failed", "cancelled")),
                                OpsTraceDelivery.finished_at <= now - timedelta(days=7),
                            ),
                        ),
                        # Cancelled staging uploads can finish after cancellation: revisit their immutable key.
                        sa.or_(
                            OpsTraceDelivery.trace_deleted_at.is_(None), OpsTraceDelivery.error_code == "upload_expired"
                        ),
                    )
                    .order_by(
                        sa.case((OpsTraceDelivery.trace_deleted_at.is_(None), 0), else_=1),
                        OpsTraceDelivery.trace_deleted_at,
                        OpsTraceDelivery.finished_at,
                    )
                    .limit(limit)
                )
            )
            for row in rows:
                session.expunge(row)
            return rows

    def record_trace_deleted(self, delivery: OpsTraceDelivery) -> None:
        with self.session_factory() as session:
            session.execute(
                sa.update(OpsTraceDelivery)
                .where(
                    OpsTraceDelivery.tenant_id == delivery.tenant_id,
                    OpsTraceDelivery.id == delivery.id,
                    OpsTraceDelivery.status.in_(("succeeded", "failed", "cancelled")),
                )
                .values(trace_deleted_at=sa.func.current_timestamp())
            )
            session.commit()

    def delete_expired_deliveries(self, limit: int = 100) -> None:
        """Keep parent receipts while their original message/run or a child still exists."""
        with self.session_factory() as session:
            now = self.database_time(session)
            child_delivery = aliased(OpsTraceDelivery)
            message_exists = sa.exists(
                sa.select(Message.id).where(
                    Message.id == OpsTraceDelivery.message_id,
                    Message.app_id == OpsTraceDelivery.app_id,
                )
            )
            run_exists = sa.exists(
                sa.select(WorkflowRun.id).where(
                    WorkflowRun.id == OpsTraceDelivery.workflow_run_id,
                    WorkflowRun.tenant_id == OpsTraceDelivery.tenant_id,
                    WorkflowRun.app_id == sa.func.coalesce(OpsTraceDelivery.app_id, OpsTraceDelivery.pipeline_id),
                )
            )
            child_exists = sa.exists(
                sa.select(child_delivery.id).where(
                    child_delivery.tenant_id == OpsTraceDelivery.tenant_id,
                    child_delivery.parent_delivery_id == OpsTraceDelivery.id,
                )
            )
            candidates = session.execute(
                sa.select(OpsTraceDelivery.tenant_id, OpsTraceDelivery.id)
                .where(
                    OpsTraceDelivery.status.in_(("succeeded", "failed", "cancelled")),
                    OpsTraceDelivery.trace_deleted_at.is_not(None),
                    OpsTraceDelivery.finished_at <= now - timedelta(days=30),
                    # ponytail: retain expired-upload tombstones until storage supports bounded orphan listing.
                    sa.or_(OpsTraceDelivery.error_code.is_(None), OpsTraceDelivery.error_code != "upload_expired"),
                    ~message_exists,
                    ~run_exists,
                    ~child_exists,
                )
                .order_by(OpsTraceDelivery.finished_at)
                .limit(limit)
            ).all()
            for tenant_id, delivery_id in candidates:
                session.execute(
                    sa.delete(OpsTraceDelivery).where(
                        OpsTraceDelivery.tenant_id == tenant_id,
                        OpsTraceDelivery.id == delivery_id,
                        OpsTraceDelivery.status.in_(("succeeded", "failed", "cancelled")),
                    )
                )
            session.commit()

    def read_parent_reference(self, delivery: OpsTraceDelivery) -> tuple[bool, dict | None]:
        if delivery.parent_export_id is None:
            return True, None
        with self.session_factory() as session:
            now = self.database_time(session)
            parent_delivery = session.scalar(
                sa.select(OpsTraceDelivery).where(
                    OpsTraceDelivery.tenant_id == delivery.tenant_id,
                    OpsTraceDelivery.export_id == delivery.parent_export_id,
                )
            )
            ready = False
            error_code = None
            receipt = None
            if parent_delivery:
                if any(
                    getattr(parent_delivery, field) != getattr(delivery, field)
                    for field in (
                        "app_id",
                        "pipeline_id",
                        "source_type",
                        "destination_type",
                        "provider_name",
                        "config_id",
                        "config_revision",
                        "destination_settings_hash",
                    )
                ):
                    error_code = "parent_owner_mismatch"
                elif parent_delivery.status == "succeeded":
                    receipt = (parent_delivery.parent_references or {}).get(delivery.parent_span_id)
                    ready = receipt is not None
                    if not ready:
                        error_code = "parent_span_unavailable"
                elif parent_delivery.status in ("failed", "cancelled"):
                    error_code = "parent_unavailable"
            if error_code != "parent_owner_mismatch" and now - delivery.created_at > timedelta(hours=1):
                error_code = "parent_wait_expired"
            if ready:
                return True, receipt
            parent_unavailable = error_code in ("parent_unavailable", "parent_span_unavailable", "parent_wait_expired")
            # A dependency wait never consumes attempts or resets an active sender.
            session.execute(
                sa.update(OpsTraceDelivery)
                .where(
                    OpsTraceDelivery.tenant_id == delivery.tenant_id,
                    OpsTraceDelivery.id == delivery.id,
                    OpsTraceDelivery.status == "pending",
                    OpsTraceDelivery.next_attempt_at <= now,
                )
                .values(
                    status="cancelled" if error_code == "parent_owner_mismatch" else "pending",
                    error_code=error_code,
                    next_attempt_at=now if parent_unavailable else now + timedelta(seconds=5),
                    finished_at=now if error_code == "parent_owner_mismatch" else None,
                    parent_delivery_id=parent_delivery.id if parent_delivery else None,
                    updated_at=now,
                )
            )
            session.commit()
            return parent_unavailable, None
