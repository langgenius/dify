import datetime
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor

import click
from flask import Flask, current_app
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.model_runtime.utils.encoders import jsonable_encoder
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.account import Tenant
from models.model import (
    App,
    AppAnnotationHitHistory,
    Conversation,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageChain,
    MessageFeedback,
    MessageFile,
)
from models.web import SavedMessage
from models.workflow import WorkflowAppLog
from repositories.factory import DifyAPIRepositoryFactory
from services.billing_service import BillingService

logger = logging.getLogger(__name__)


class ClearFreePlanTenantExpiredLogs:
    @classmethod
    def _clear_message_related_tables(cls, session: Session, tenant_id: str, batch_message_ids: list[str]):
        """
        Clean up message-related tables to avoid data redundancy.
        This method cleans up tables that have foreign key relationships with Message.

        Args:
            session: Database session, the same with the one in process_tenant method
            tenant_id: Tenant ID for logging purposes
            batch_message_ids: List of message IDs to clean up
        """
        if not batch_message_ids:
            return

        # Clean up each related table
        related_tables = [
            (MessageFeedback, "message_feedbacks"),
            (MessageFile, "message_files"),
            (MessageAnnotation, "message_annotations"),
            (MessageChain, "message_chains"),
            (MessageAgentThought, "message_agent_thoughts"),
            (AppAnnotationHitHistory, "app_annotation_hit_histories"),
            (SavedMessage, "saved_messages"),
        ]

        for model, table_name in related_tables:
            # Query records related to expired messages
            records = (
                session.query(model)
                .where(
                    model.message_id.in_(batch_message_ids),  # type: ignore
                )
                .all()
            )

            if len(records) == 0:
                continue

            # Save records before deletion
            record_ids = [record.id for record in records]
            try:
                record_data = []
                for record in records:
                    try:
                        if hasattr(record, "to_dict"):
                            record_data.append(record.to_dict())
                        else:
                            # if record doesn't have to_dict method, we need to transform it to dict manually
                            record_dict = {}
                            for column in record.__table__.columns:
                                record_dict[column.name] = getattr(record, column.name)
                            record_data.append(record_dict)
                    except Exception:
                        logger.exception("Failed to transform %s record: %s", table_name, record.id)
                        continue

                if record_data:
                    storage.save(
                        f"free_plan_tenant_expired_logs/"
                        f"{tenant_id}/{table_name}/{datetime.datetime.now().strftime('%Y-%m-%d')}"
                        f"-{time.time()}.json",
                        json.dumps(
                            jsonable_encoder(record_data),
                        ).encode("utf-8"),
                    )
            except Exception:
                logger.exception("Failed to save %s records", table_name)

            session.query(model).where(
                model.id.in_(record_ids),  # type: ignore
            ).delete(synchronize_session=False)

            click.echo(
                click.style(
                    f"[{datetime.datetime.now()}] Processed {len(record_ids)} "
                    f"{table_name} records for tenant {tenant_id}"
                )
            )

    @classmethod
    def process_tenant(cls, flask_app: Flask, tenant_id: str, days: int, batch: int):
        with flask_app.app_context():
            apps = db.session.scalars(select(App).where(App.tenant_id == tenant_id)).all()
            app_ids = [app.id for app in apps]
            while True:
                with Session(db.engine).no_autoflush as session:
                    messages = (
                        session.query(Message)
                        .where(
                            Message.app_id.in_(app_ids),
                            Message.created_at < datetime.datetime.now() - datetime.timedelta(days=days),
                        )
                        .limit(batch)
                        .all()
                    )
                    if len(messages) == 0:
                        break

                    storage.save(
                        f"free_plan_tenant_expired_logs/"
                        f"{tenant_id}/messages/{datetime.datetime.now().strftime('%Y-%m-%d')}"
                        f"-{time.time()}.json",
                        json.dumps(
                            jsonable_encoder(
                                [message.to_dict() for message in messages],
                            ),
                        ).encode("utf-8"),
                    )

                    message_ids = [message.id for message in messages]

                    # delete messages
                    session.query(Message).where(
                        Message.id.in_(message_ids),
                    ).delete(synchronize_session=False)

                    cls._clear_message_related_tables(session, tenant_id, message_ids)
                    session.commit()

                    click.echo(
                        click.style(
                            f"[{datetime.datetime.now()}] Processed {len(message_ids)} messages for tenant {tenant_id} "
                        )
                    )

            while True:
                with Session(db.engine).no_autoflush as session:
                    conversations = (
                        session.query(Conversation)
                        .where(
                            Conversation.app_id.in_(app_ids),
                            Conversation.updated_at < datetime.datetime.now() - datetime.timedelta(days=days),
                        )
                        .limit(batch)
                        .all()
                    )

                    if len(conversations) == 0:
                        break

                    storage.save(
                        f"free_plan_tenant_expired_logs/"
                        f"{tenant_id}/conversations/{datetime.datetime.now().strftime('%Y-%m-%d')}"
                        f"-{time.time()}.json",
                        json.dumps(
                            jsonable_encoder(
                                [conversation.to_dict() for conversation in conversations],
                            ),
                        ).encode("utf-8"),
                    )

                    conversation_ids = [conversation.id for conversation in conversations]
                    session.query(Conversation).where(
                        Conversation.id.in_(conversation_ids),
                    ).delete(synchronize_session=False)
                    session.commit()

                    click.echo(
                        click.style(
                            f"[{datetime.datetime.now()}] Processed {len(conversation_ids)}"
                            f" conversations for tenant {tenant_id}"
                        )
                    )

            # Process expired workflow node executions with backup
            session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
            node_execution_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(session_maker)
            before_date = datetime.datetime.now() - datetime.timedelta(days=days)
            total_deleted = 0

            while True:
                # Get a batch of expired executions for backup
                workflow_node_executions = node_execution_repo.get_expired_executions_batch(
                    tenant_id=tenant_id,
                    before_date=before_date,
                    batch_size=batch,
                )

                if len(workflow_node_executions) == 0:
                    break

                # Save workflow node executions to storage
                storage.save(
                    f"free_plan_tenant_expired_logs/"
                    f"{tenant_id}/workflow_node_executions/{datetime.datetime.now().strftime('%Y-%m-%d')}"
                    f"-{time.time()}.json",
                    json.dumps(
                        jsonable_encoder(workflow_node_executions),
                    ).encode("utf-8"),
                )

                # Extract IDs for deletion
                workflow_node_execution_ids = [
                    workflow_node_execution.id for workflow_node_execution in workflow_node_executions
                ]

                # Delete the backed up executions
                deleted_count = node_execution_repo.delete_executions_by_ids(workflow_node_execution_ids)
                total_deleted += deleted_count

                click.echo(
                    click.style(
                        f"[{datetime.datetime.now()}] Processed {len(workflow_node_execution_ids)}"
                        f" workflow node executions for tenant {tenant_id}"
                    )
                )

                # If we got fewer than the batch size, we're done
                if len(workflow_node_executions) < batch:
                    break

            # Process expired workflow runs with backup
            session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
            workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)
            before_date = datetime.datetime.now() - datetime.timedelta(days=days)
            total_deleted = 0

            while True:
                # Get a batch of expired workflow runs for backup
                workflow_runs = workflow_run_repo.get_expired_runs_batch(
                    tenant_id=tenant_id,
                    before_date=before_date,
                    batch_size=batch,
                )

                if len(workflow_runs) == 0:
                    break

                # Save workflow runs to storage
                storage.save(
                    f"free_plan_tenant_expired_logs/"
                    f"{tenant_id}/workflow_runs/{datetime.datetime.now().strftime('%Y-%m-%d')}"
                    f"-{time.time()}.json",
                    json.dumps(
                        jsonable_encoder(
                            [workflow_run.to_dict() for workflow_run in workflow_runs],
                        ),
                    ).encode("utf-8"),
                )

                # Extract IDs for deletion
                workflow_run_ids = [workflow_run.id for workflow_run in workflow_runs]

                # Delete the backed up workflow runs
                deleted_count = workflow_run_repo.delete_runs_by_ids(workflow_run_ids)
                total_deleted += deleted_count

                click.echo(
                    click.style(
                        f"[{datetime.datetime.now()}] Processed {len(workflow_run_ids)}"
                        f" workflow runs for tenant {tenant_id}"
                    )
                )

                # If we got fewer than the batch size, we're done
                if len(workflow_runs) < batch:
                    break

            while True:
                with Session(db.engine).no_autoflush as session:
                    workflow_app_logs = (
                        session.query(WorkflowAppLog)
                        .where(
                            WorkflowAppLog.tenant_id == tenant_id,
                            WorkflowAppLog.created_at < datetime.datetime.now() - datetime.timedelta(days=days),
                        )
                        .limit(batch)
                        .all()
                    )

                    if len(workflow_app_logs) == 0:
                        break

                    # save workflow app logs
                    storage.save(
                        f"free_plan_tenant_expired_logs/"
                        f"{tenant_id}/workflow_app_logs/{datetime.datetime.now().strftime('%Y-%m-%d')}"
                        f"-{time.time()}.json",
                        json.dumps(
                            jsonable_encoder(
                                [workflow_app_log.to_dict() for workflow_app_log in workflow_app_logs],
                            ),
                        ).encode("utf-8"),
                    )

                    workflow_app_log_ids = [workflow_app_log.id for workflow_app_log in workflow_app_logs]

                    # delete workflow app logs
                    session.query(WorkflowAppLog).where(WorkflowAppLog.id.in_(workflow_app_log_ids)).delete(
                        synchronize_session=False
                    )
                    session.commit()

                    click.echo(
                        click.style(
                            f"[{datetime.datetime.now()}] Processed {len(workflow_app_log_ids)}"
                            f" workflow app logs for tenant {tenant_id}"
                        )
                    )

    @classmethod
    def process(cls, days: int, batch: int, tenant_ids: list[str]):
        """
        Clear free plan tenant expired logs.
        """

        click.echo(click.style("Clearing free plan tenant expired logs", fg="white"))
        ended_at = datetime.datetime.now()
        started_at = datetime.datetime(2023, 4, 3, 8, 59, 24)
        current_time = started_at

        with Session(db.engine) as session:
            total_tenant_count = session.query(Tenant.id).count()

        click.echo(click.style(f"Total tenant count: {total_tenant_count}", fg="white"))

        handled_tenant_count = 0

        thread_pool = ThreadPoolExecutor(max_workers=10)

        def process_tenant(flask_app: Flask, tenant_id: str):
            try:
                if (
                    not dify_config.BILLING_ENABLED
                    or BillingService.get_info(tenant_id)["subscription"]["plan"] == "sandbox"
                ):
                    # only process sandbox tenant
                    cls.process_tenant(flask_app, tenant_id, days, batch)
            except Exception:
                logger.exception("Failed to process tenant %s", tenant_id)
            finally:
                nonlocal handled_tenant_count
                handled_tenant_count += 1
                if handled_tenant_count % 100 == 0:
                    click.echo(
                        click.style(
                            f"[{datetime.datetime.now()}] "
                            f"Processed {handled_tenant_count} tenants "
                            f"({(handled_tenant_count / total_tenant_count) * 100:.1f}%), "
                            f"{handled_tenant_count}/{total_tenant_count}",
                            fg="green",
                        )
                    )

        futures = []

        if tenant_ids:
            for tenant_id in tenant_ids:
                futures.append(
                    thread_pool.submit(
                        process_tenant,
                        current_app._get_current_object(),  # type: ignore[attr-defined]
                        tenant_id,
                    )
                )
        else:
            while current_time < ended_at:
                click.echo(
                    click.style(f"Current time: {current_time}, Started at: {datetime.datetime.now()}", fg="white")
                )
                # Initial interval of 1 day, will be dynamically adjusted based on tenant count
                interval = datetime.timedelta(days=1)
                # Process tenants in this batch
                with Session(db.engine) as session:
                    # Calculate tenant count in next batch with current interval
                    # Try different intervals until we find one with a reasonable tenant count
                    test_intervals = [
                        datetime.timedelta(days=1),
                        datetime.timedelta(hours=12),
                        datetime.timedelta(hours=6),
                        datetime.timedelta(hours=3),
                        datetime.timedelta(hours=1),
                    ]

                    tenant_count = 0
                    for test_interval in test_intervals:
                        tenant_count = (
                            session.query(Tenant.id)
                            .where(Tenant.created_at.between(current_time, current_time + test_interval))
                            .count()
                        )
                        if tenant_count <= 100:
                            interval = test_interval
                            break
                    else:
                        # If all intervals have too many tenants, use minimum interval
                        interval = datetime.timedelta(hours=1)

                    # Adjust interval to target ~100 tenants per batch
                    if tenant_count > 0:
                        # Scale interval based on ratio to target count
                        interval = min(
                            datetime.timedelta(days=1),  # Max 1 day
                            max(
                                datetime.timedelta(hours=1),  # Min 1 hour
                                interval * (100 / tenant_count),  # Scale to target 100
                            ),
                        )

                    batch_end = min(current_time + interval, ended_at)

                    rs = (
                        session.query(Tenant.id)
                        .where(Tenant.created_at.between(current_time, batch_end))
                        .order_by(Tenant.created_at)
                    )

                    tenants = []
                    for row in rs:
                        tenant_id = str(row.id)
                        try:
                            tenants.append(tenant_id)
                        except Exception:
                            logger.exception("Failed to process tenant %s", tenant_id)
                            continue

                        futures.append(
                            thread_pool.submit(
                                process_tenant,
                                current_app._get_current_object(),  # type: ignore[attr-defined]
                                tenant_id,
                            )
                        )

                current_time = batch_end

        # wait for all threads to finish
        for future in futures:
            future.result()
