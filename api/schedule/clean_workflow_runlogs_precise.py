import datetime
import logging
import time
from collections.abc import Sequence

import click
from sqlalchemy.orm import Session, sessionmaker

import app
from configs import dify_config
from extensions.ext_database import db
from models.model import (
    AppAnnotationHitHistory,
    Conversation,
    DatasetRetrieverResource,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageChain,
    MessageFeedback,
    MessageFile,
)
from models.web import SavedMessage
from models.workflow import ConversationVariable, WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository

logger = logging.getLogger(__name__)


MAX_RETRIES = 3
BATCH_SIZE = dify_config.WORKFLOW_LOG_CLEANUP_BATCH_SIZE


def _get_specific_workflow_ids() -> list[str]:
    workflow_ids_str = dify_config.WORKFLOW_LOG_CLEANUP_SPECIFIC_WORKFLOW_IDS.strip()
    if not workflow_ids_str:
        return []
    return [wid.strip() for wid in workflow_ids_str.split(",") if wid.strip()]


@app.celery.task(queue="retention")
def clean_workflow_runlogs_precise() -> None:
    """Clean expired workflow run logs with retry mechanism and complete message cascade"""

    click.echo(click.style("Start clean workflow run logs (precise mode with complete cascade).", fg="green"))
    start_at = time.perf_counter()

    retention_days = dify_config.WORKFLOW_LOG_RETENTION_DAYS
    cutoff_date = datetime.datetime.now() - datetime.timedelta(days=retention_days)
    session_factory = sessionmaker(db.engine, expire_on_commit=False)
    workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_factory)
    workflow_ids = _get_specific_workflow_ids()
    workflow_ids_filter = workflow_ids or None

    try:
        total_deleted = 0
        failed_batches = 0
        batch_count = 0
        last_seen: tuple[datetime.datetime, str] | None = None
        while True:
            run_rows = workflow_run_repo.get_runs_batch_by_time_range(
                start_from=None,
                end_before=cutoff_date,
                last_seen=last_seen,
                batch_size=BATCH_SIZE,
                workflow_ids=workflow_ids_filter,
            )

            if not run_rows:
                if batch_count == 0:
                    logger.info("No expired workflow run logs found")
                break

            last_seen = (run_rows[-1].created_at, run_rows[-1].id)
            batch_count += 1
            with session_factory.begin() as session:
                success = _delete_batch(session, workflow_run_repo, run_rows, failed_batches)

            if success:
                total_deleted += len(run_rows)
                failed_batches = 0
            else:
                failed_batches += 1
                if failed_batches >= MAX_RETRIES:
                    logger.error("Failed to delete batch after %s retries, aborting cleanup for today", MAX_RETRIES)
                    break
                else:
                    # Calculate incremental delay times: 5, 10, 15 minutes
                    retry_delay_minutes = failed_batches * 5
                    logger.warning("Batch deletion failed, retrying in %s minutes...", retry_delay_minutes)
                    time.sleep(retry_delay_minutes * 60)
                    continue

        logger.info("Cleanup completed: %s expired workflow run logs deleted", total_deleted)

    except Exception:
        logger.exception("Unexpected error in workflow log cleanup")
        raise

    end_at = time.perf_counter()
    execution_time = end_at - start_at
    click.echo(click.style(f"Cleaned workflow run logs from db success latency: {execution_time:.2f}s", fg="green"))


def _delete_batch(
    session: Session,
    workflow_run_repo,
    workflow_runs: Sequence[WorkflowRun],
    attempt_count: int,
) -> bool:
    """Delete a single batch of workflow runs and all related data within a nested transaction."""
    try:
        with session.begin_nested():
            workflow_run_ids = [run.id for run in workflow_runs]
            message_data = (
                session.query(Message.id, Message.conversation_id)
                .where(Message.workflow_run_id.in_(workflow_run_ids))
                .all()
            )
            message_id_list = [msg.id for msg in message_data]
            conversation_id_list = list({msg.conversation_id for msg in message_data if msg.conversation_id})
            if message_id_list:
                message_related_models = [
                    AppAnnotationHitHistory,
                    DatasetRetrieverResource,
                    MessageAgentThought,
                    MessageChain,
                    MessageFile,
                    MessageAnnotation,
                    MessageFeedback,
                    SavedMessage,
                ]
                for model in message_related_models:
                    session.query(model).where(model.message_id.in_(message_id_list)).delete(synchronize_session=False)  # type: ignore
                    # error: "DeclarativeAttributeIntercept" has no attribute "message_id". But this type is only in lib
                    # and these 6 types all have the message_id field.

                session.query(Message).where(Message.workflow_run_id.in_(workflow_run_ids)).delete(
                    synchronize_session=False
                )

            if conversation_id_list:
                session.query(ConversationVariable).where(
                    ConversationVariable.conversation_id.in_(conversation_id_list)
                ).delete(synchronize_session=False)

                session.query(Conversation).where(Conversation.id.in_(conversation_id_list)).delete(
                    synchronize_session=False
                )

            def _delete_node_executions(active_session: Session, runs: Sequence[WorkflowRun]) -> tuple[int, int]:
                run_ids = [run.id for run in runs]
                repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
                    session_maker=sessionmaker(bind=active_session.get_bind(), expire_on_commit=False)
                )
                return repo.delete_by_runs(active_session, run_ids)

            def _delete_trigger_logs(active_session: Session, run_ids: Sequence[str]) -> int:
                trigger_repo = SQLAlchemyWorkflowTriggerLogRepository(active_session)
                return trigger_repo.delete_by_run_ids(run_ids)

            workflow_run_repo.delete_runs_with_related(
                workflow_runs,
                delete_node_executions=_delete_node_executions,
                delete_trigger_logs=_delete_trigger_logs,
            )

            return True

    except Exception:
        logger.exception("Batch deletion failed (attempt %s)", attempt_count + 1)
        return False
