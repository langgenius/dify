import datetime
import logging
import time

import click

import app
from configs import dify_config
from extensions.ext_database import db
from models.model import (
    AppAnnotationHitHistory,
    Conversation,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageChain,
    MessageFeedback,
    MessageFile,
)
from models.workflow import ConversationVariable, WorkflowAppLog, WorkflowNodeExecutionModel, WorkflowRun

logger = logging.getLogger(__name__)


MAX_RETRIES = 3
BATCH_SIZE = dify_config.WORKFLOW_LOG_CLEANUP_BATCH_SIZE


@app.celery.task(queue="dataset")
def clean_workflow_runlogs_precise():
    """Clean expired workflow run logs with retry mechanism and complete message cascade"""

    click.echo(click.style("Start clean workflow run logs (precise mode with complete cascade).", fg="green"))
    start_at = time.perf_counter()

    retention_days = dify_config.WORKFLOW_LOG_RETENTION_DAYS
    cutoff_date = datetime.datetime.now() - datetime.timedelta(days=retention_days)

    try:
        total_workflow_runs = db.session.query(WorkflowRun).where(WorkflowRun.created_at < cutoff_date).count()
        if total_workflow_runs == 0:
            logger.info("No expired workflow run logs found")
            return
        logger.info("Found %s expired workflow run logs to clean", total_workflow_runs)

        total_deleted = 0
        failed_batches = 0
        batch_count = 0

        while True:
            workflow_runs = (
                db.session.query(WorkflowRun.id).where(WorkflowRun.created_at < cutoff_date).limit(BATCH_SIZE).all()
            )

            if not workflow_runs:
                break

            workflow_run_ids = [run.id for run in workflow_runs]
            batch_count += 1

            success = _delete_batch_with_retry(workflow_run_ids, failed_batches)

            if success:
                total_deleted += len(workflow_run_ids)
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
        db.session.rollback()
        logger.exception("Unexpected error in workflow log cleanup")
        raise

    end_at = time.perf_counter()
    execution_time = end_at - start_at
    click.echo(click.style(f"Cleaned workflow run logs from db success latency: {execution_time:.2f}s", fg="green"))


def _delete_batch_with_retry(workflow_run_ids: list[str], attempt_count: int) -> bool:
    """Delete a single batch with a retry mechanism and complete cascading deletion"""
    try:
        with db.session.begin_nested():
            message_data = (
                db.session.query(Message.id, Message.conversation_id)
                .where(Message.workflow_run_id.in_(workflow_run_ids))
                .all()
            )
            message_id_list = [msg.id for msg in message_data]
            conversation_id_list = list({msg.conversation_id for msg in message_data if msg.conversation_id})
            if message_id_list:
                db.session.query(AppAnnotationHitHistory).where(
                    AppAnnotationHitHistory.message_id.in_(message_id_list)
                ).delete(synchronize_session=False)

                db.session.query(MessageAgentThought).where(MessageAgentThought.message_id.in_(message_id_list)).delete(
                    synchronize_session=False
                )

                db.session.query(MessageChain).where(MessageChain.message_id.in_(message_id_list)).delete(
                    synchronize_session=False
                )

                db.session.query(MessageFile).where(MessageFile.message_id.in_(message_id_list)).delete(
                    synchronize_session=False
                )

                db.session.query(MessageAnnotation).where(MessageAnnotation.message_id.in_(message_id_list)).delete(
                    synchronize_session=False
                )

                db.session.query(MessageFeedback).where(MessageFeedback.message_id.in_(message_id_list)).delete(
                    synchronize_session=False
                )

                db.session.query(Message).where(Message.workflow_run_id.in_(workflow_run_ids)).delete(
                    synchronize_session=False
                )

            db.session.query(WorkflowAppLog).where(WorkflowAppLog.workflow_run_id.in_(workflow_run_ids)).delete(
                synchronize_session=False
            )

            db.session.query(WorkflowNodeExecutionModel).where(
                WorkflowNodeExecutionModel.workflow_run_id.in_(workflow_run_ids)
            ).delete(synchronize_session=False)

            if conversation_id_list:
                db.session.query(ConversationVariable).where(
                    ConversationVariable.conversation_id.in_(conversation_id_list)
                ).delete(synchronize_session=False)

                db.session.query(Conversation).where(Conversation.id.in_(conversation_id_list)).delete(
                    synchronize_session=False
                )

            db.session.query(WorkflowRun).where(WorkflowRun.id.in_(workflow_run_ids)).delete(synchronize_session=False)

        db.session.commit()
        return True

    except Exception:
        db.session.rollback()
        logger.exception("Batch deletion failed (attempt %s)", attempt_count + 1)
        return False
