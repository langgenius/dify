"""Production composition for the Human Input v2 producer path."""

from __future__ import annotations

from sqlalchemy.orm import Session, sessionmaker

from core.db.session_factory import session_factory
from core.human_input_v2.shared import DeliveryAttemptId
from extensions.ext_database import db
from repositories.human_input_v2.form import SQLAlchemyDeliveryAttemptRepository, SQLAlchemyFormRepository

from .delivery_publisher import HumanInputV2DueAttemptPublisher
from .form_creation import HumanInputV2FormCreationService
from .node_data_migration import HumanInputNodeDataMigrationService
from .notification_producer import DifyRenderedEmailRequestProtector, HumanInputV2NotificationProducer
from .workspace_member_email_lookup import SQLAlchemyWorkspaceMemberEmailLookup


def build_human_input_node_data_migration_service() -> HumanInputNodeDataMigrationService:
    """Compose the read-only migration service for one Console request."""

    return HumanInputNodeDataMigrationService(
        member_email_lookup=SQLAlchemyWorkspaceMemberEmailLookup(session_factory.create_session),
    )


def build_human_input_v2_form_creation_service(
    *,
    session_maker: sessionmaker[Session] | None = None,
) -> HumanInputV2FormCreationService:
    """Compose atomic production plus post-commit dedicated-queue publication."""

    from tasks.human_input_v2_delivery_tasks import dispatch_human_input_v2_delivery_attempt_task

    sessions = session_maker or sessionmaker(bind=db.engine, expire_on_commit=False)

    def enqueue(attempt_id: DeliveryAttemptId) -> None:
        dispatch_human_input_v2_delivery_attempt_task.apply_async(
            args=(str(attempt_id),),
            queue="human_input_delivery",
        )

    producer = HumanInputV2NotificationProducer(
        SQLAlchemyFormRepository(sessions),
        DifyRenderedEmailRequestProtector(),
    )
    publisher = HumanInputV2DueAttemptPublisher(
        SQLAlchemyDeliveryAttemptRepository(sessions),
        enqueue,
    )
    return HumanInputV2FormCreationService(producer, publisher)


__all__ = [
    "build_human_input_node_data_migration_service",
    "build_human_input_v2_form_creation_service",
]
