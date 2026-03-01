import logging
import time

import click
from redis.exceptions import LockError

import app
from configs import dify_config
from extensions.ext_redis import redis_client
from services.retention.conversation.messages_clean_policy import create_message_clean_policy
from services.retention.conversation.messages_clean_service import MessagesCleanService

logger = logging.getLogger(__name__)


@app.celery.task(queue="retention")
def clean_messages():
    """
    Clean expired messages based on clean policy.

    This task uses MessagesCleanService to efficiently clean messages in batches.
    The behavior depends on BILLING_ENABLED configuration:
    - BILLING_ENABLED=True: only delete messages from sandbox tenants (with whitelist/grace period)
    - BILLING_ENABLED=False: delete all messages within the time range
    """
    click.echo(click.style("clean_messages: start clean messages.", fg="green"))
    start_at = time.perf_counter()

    try:
        # Create policy based on billing configuration
        policy = create_message_clean_policy(
            graceful_period_days=dify_config.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD,
        )

        # Create and run the cleanup service
        # lock the task to avoid concurrent execution in case of the future data volume growth
        with redis_client.lock(
            "retention:clean_messages", timeout=dify_config.SANDBOX_EXPIRED_RECORDS_CLEAN_TASK_LOCK_TTL, blocking=False
        ):
            service = MessagesCleanService.from_days(
                policy=policy,
                days=dify_config.SANDBOX_EXPIRED_RECORDS_RETENTION_DAYS,
                batch_size=dify_config.SANDBOX_EXPIRED_RECORDS_CLEAN_BATCH_SIZE,
            )
            stats = service.run()

        end_at = time.perf_counter()
        click.echo(
            click.style(
                f"clean_messages: completed successfully\n"
                f"  - Latency: {end_at - start_at:.2f}s\n"
                f"  - Batches processed: {stats['batches']}\n"
                f"  - Total messages scanned: {stats['total_messages']}\n"
                f"  - Messages filtered: {stats['filtered_messages']}\n"
                f"  - Messages deleted: {stats['total_deleted']}",
                fg="green",
            )
        )
    except LockError:
        end_at = time.perf_counter()
        logger.exception("clean_messages: acquire task lock failed, skip current execution")
        click.echo(
            click.style(
                f"clean_messages: skipped (lock already held) - latency: {end_at - start_at:.2f}s",
                fg="yellow",
            )
        )
        raise
    except Exception as e:
        end_at = time.perf_counter()
        logger.exception("clean_messages failed")
        click.echo(
            click.style(
                f"clean_messages: failed after {end_at - start_at:.2f}s - {str(e)}",
                fg="red",
            )
        )
        raise
