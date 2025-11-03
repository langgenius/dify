import logging
import time

from celery import shared_task  # type: ignore
from sqlalchemy.orm import sessionmaker

from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models import (
    Conversation,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageChain,
    MessageFeedback,
    MessageFile,
    UploadFile,
)
from models.workflow import ConversationVariable

logger = logging.getLogger(__name__)

# Batch size for processing records to avoid memory issues
BATCH_SIZE = 1000


@shared_task(bind=True, max_retries=3, queue="conversation")
def clear_conversations_task(
    self,
    app_id: str,
    conversation_mode: str,
    conversation_ids: list[str] | None = None,
    user_id: str | None = None,
    user_type: str | None = None,
    lock_key: str | None = None,
):
    """
    Celery task to clear conversations and related data.

    Args:
        app_id: The app ID
        conversation_mode: 'chat' or 'completion'
        conversation_ids: Optional list of specific conversation IDs to clear
        user_id: The user ID for permission validation
        user_type: 'account' or 'end_user'
        lock_key: Redis lock key to release after completion
    """
    start_time = time.time()
    total_deleted = {
        "conversations": 0,
        "messages": 0,
        "files": 0,
        "annotations": 0,
        "feedbacks": 0,
        "agent_thoughts": 0,
        "message_chains": 0,
        "conversation_variables": 0,
    }

    try:
        logger.info(
            "Starting conversation cleanup for app_id=%s, mode=%s, selective=%s, count=%s",
            app_id,
            conversation_mode,
            "yes" if conversation_ids else "no",
            len(conversation_ids) if conversation_ids else "all",
        )

        # Create a new database session for this task
        Session = sessionmaker(bind=db.engine)

        with Session() as session:
            # Get conversations to delete
            conversation_query = session.query(Conversation).filter(Conversation.app_id == app_id)

            # Filter by conversation mode - handle chat modes which include chat, agent-chat, advanced-chat
            if conversation_mode == "chat":
                conversation_query = conversation_query.filter(
                    Conversation.mode.in_(["chat", "agent-chat", "advanced-chat"])
                )
            else:
                conversation_query = conversation_query.filter(Conversation.mode == conversation_mode)

            # Add user filter if provided for security
            if user_type == "account" and user_id:
                conversation_query = conversation_query.filter(
                    Conversation.from_source == "console", Conversation.from_account_id == user_id
                )
            elif user_type == "end_user" and user_id:
                conversation_query = conversation_query.filter(
                    Conversation.from_source == "api", Conversation.from_end_user_id == user_id
                )

            # Filter by specific conversation IDs if provided
            if conversation_ids:
                conversation_query = conversation_query.filter(Conversation.id.in_(conversation_ids))

            # Process conversations in batches
            batch_offset = 0
            while True:
                conversations = conversation_query.offset(batch_offset).limit(BATCH_SIZE).all()

                if not conversations:
                    break

                conversation_batch_ids = [conv.id for conv in conversations]

                # Get all message IDs for this batch
                message_ids = [
                    row[0]
                    for row in session.query(Message.id)
                    .where(Message.conversation_id.in_(conversation_batch_ids))
                    .all()
                ]

                if message_ids:
                    # Delete files from storage and get upload file IDs
                    upload_file_ids = _cleanup_message_files(session, message_ids)
                    total_deleted["files"] += len(upload_file_ids)

                    # Delete message-related records in batches
                    total_deleted["feedbacks"] += _delete_records_batch(
                        session, MessageFeedback, MessageFeedback.message_id.in_(message_ids)
                    )
                    total_deleted["message_chains"] += _delete_records_batch(
                        session, MessageChain, MessageChain.message_id.in_(message_ids)
                    )
                    total_deleted["agent_thoughts"] += _delete_records_batch(
                        session, MessageAgentThought, MessageAgentThought.message_id.in_(message_ids)
                    )

                    # Delete messages
                    total_deleted["messages"] += _delete_records_batch(session, Message, Message.id.in_(message_ids))

                # Delete conversation-related records
                total_deleted["annotations"] += _delete_records_batch(
                    session, MessageAnnotation, MessageAnnotation.conversation_id.in_(conversation_batch_ids)
                )
                total_deleted["conversation_variables"] += _delete_records_batch(
                    session, ConversationVariable, ConversationVariable.conversation_id.in_(conversation_batch_ids)
                )

                # Delete conversations
                total_deleted["conversations"] += _delete_records_batch(
                    session, Conversation, Conversation.id.in_(conversation_batch_ids)
                )

                # Update progress
                batch_offset += BATCH_SIZE
                self.update_state(
                    state="PROGRESS",
                    meta={"processed_batches": batch_offset // BATCH_SIZE, "current_totals": total_deleted.copy()},
                )

                # Commit this batch
                session.commit()

                logger.info(
                    "Processed batch %s, deleted %s conversations", batch_offset // BATCH_SIZE, len(conversations)
                )

        execution_time = time.time() - start_time
        logger.info("Conversation cleanup completed in %.2fs. Deleted: %s", execution_time, total_deleted)

        # Release Redis lock on successful completion
        if lock_key:
            try:
                redis_client.delete(lock_key)
                logger.info("Released lock: %s", lock_key)
            except Exception as e:
                logger.warning("Failed to release lock %s: %s", lock_key, e)

        return {
            "status": "completed",
            "execution_time": execution_time,
            "deleted_counts": total_deleted,
            "app_id": app_id,
            "mode": conversation_mode,
            "selective": conversation_ids is not None,
        }

    except Exception as exc:
        logger.error("Conversation cleanup failed for app_id=%s: %s", app_id, exc, exc_info=True)
        # Retry the task with exponential backoff
        from celery.exceptions import MaxRetriesExceededError

        try:
            raise self.retry(exc=exc, countdown=60 * (2**self.request.retries))
        except MaxRetriesExceededError:
            logger.exception("Max retries exceeded for conversation cleanup, app_id=%s", app_id)
            # Release lock after max retries
            if lock_key:
                try:
                    redis_client.delete(lock_key)
                    logger.info("Released lock after max retries: %s", lock_key)
                except Exception as e:
                    logger.warning("Failed to release lock %s: %s", lock_key, e)
            raise


def _cleanup_message_files(session, message_ids: list[str]) -> list[str]:
    """Clean up files associated with messages and return upload file IDs."""
    from sqlalchemy.exc import DatabaseError

    upload_file_ids = []

    try:
        # Get message files to delete their actual files from storage
        message_files = session.query(MessageFile).where(MessageFile.message_id.in_(message_ids)).all()

        upload_file_ids = [mf.upload_file_id for mf in message_files if mf.upload_file_id]

        if upload_file_ids:
            # Get upload files and delete from storage
            upload_files = session.query(UploadFile).where(UploadFile.id.in_(upload_file_ids)).all()

            for upload_file in upload_files:
                try:
                    storage.delete(upload_file.key)
                except OSError as e:
                    logger.warning("Failed to delete file from storage %s: %s", upload_file.key, e)
                except Exception as e:
                    logger.error("Unexpected error deleting file %s: %s", upload_file.key, e, exc_info=True)

            # Delete upload file records
            session.query(UploadFile).where(UploadFile.id.in_(upload_file_ids)).delete(synchronize_session=False)

        # Delete message file records
        session.query(MessageFile).where(MessageFile.message_id.in_(message_ids)).delete(synchronize_session=False)

    except DatabaseError as e:
        logger.error("Database error cleaning up message files: %s", e, exc_info=True)
    except Exception as e:
        logger.error("Unexpected error cleaning up message files: %s", e, exc_info=True)

    return upload_file_ids


def _delete_records_batch(session, model_class, filter_condition) -> int:
    """Delete records in batch with error handling."""
    from sqlalchemy.exc import DatabaseError, OperationalError

    try:
        result = session.query(model_class).where(filter_condition).delete(synchronize_session=False)
        return result or 0
    except OperationalError as e:
        logger.warning("Table might not exist for %s: %s", model_class.__name__, e)
        return 0
    except DatabaseError as e:
        logger.error("Database error deleting %s records: %s", model_class.__name__, e, exc_info=True)
        return 0
    except Exception as e:
        logger.error("Unexpected error deleting %s records: %s", model_class.__name__, e, exc_info=True)
        return 0
