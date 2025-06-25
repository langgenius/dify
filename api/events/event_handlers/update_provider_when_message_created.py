import logging
import secrets
import time
import time as time_module
from datetime import UTC, datetime
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.exc import DatabaseError, IntegrityError, OperationalError

from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity, ChatAppGenerateEntity
from core.entities.provider_entities import QuotaUnit
from core.plugin.entities.plugin import ModelProviderID
from events.message_event import message_was_created
from extensions.ext_database import db
from models.provider import Provider, ProviderType

logger = logging.getLogger(__name__)

# Performance monitoring counters
_update_stats = {
    "total_updates": 0,
    "successful_updates": 0,
    "failed_updates": 0,
    "deadlock_retries": 0,
    "total_duration": 0.0,
}


@message_was_created.connect
def handle(sender, **kwargs):
    """
    Consolidated handler for Provider updates when a message is created.

    This handler replaces both:
    - update_provider_last_used_at_when_message_created
    - deduct_quota_when_message_created

    By performing all Provider updates in a single transaction, we eliminate
    the deadlock that occurred when both handlers tried to update the same
    Provider records concurrently.
    """
    message = sender
    application_generate_entity = kwargs.get("application_generate_entity")

    if not isinstance(application_generate_entity, ChatAppGenerateEntity | AgentChatAppGenerateEntity):
        return

    tenant_id = application_generate_entity.app_config.tenant_id
    provider_name = application_generate_entity.model_conf.provider
    current_time = datetime.now(UTC).replace(tzinfo=None)

    # Prepare updates for both scenarios
    updates_to_perform: list[dict[str, Any]] = []

    # 1. Always update last_used for the provider
    basic_update = {
        "filters": {
            "tenant_id": tenant_id,
            "provider_name": provider_name,
        },
        "values": {"last_used": current_time},
        "description": "basic_last_used_update",
    }
    updates_to_perform.append(basic_update)

    # 2. Check if we need to deduct quota (system provider only)
    model_config = application_generate_entity.model_conf
    provider_model_bundle = model_config.provider_model_bundle
    provider_configuration = provider_model_bundle.configuration

    if (
        provider_configuration.using_provider_type == ProviderType.SYSTEM
        and hasattr(provider_configuration, "system_configuration")
        and provider_configuration.system_configuration
        and provider_configuration.system_configuration.current_quota_type is not None
    ):
        system_configuration = provider_configuration.system_configuration

        # Calculate quota usage
        used_quota = _calculate_quota_usage(message, system_configuration)

        if used_quota is not None and used_quota > 0:
            quota_update = {
                "filters": {
                    "tenant_id": tenant_id,
                    "provider_name": ModelProviderID(model_config.provider).provider_name,
                    "provider_type": ProviderType.SYSTEM.value,
                    "quota_type": system_configuration.current_quota_type.value
                    if system_configuration.current_quota_type
                    else None,
                },
                "values": {"quota_used": Provider.quota_used + used_quota, "last_used": current_time},
                "additional_filters": {
                    "quota_limit_check": True  # Provider.quota_limit > Provider.quota_used
                },
                "description": "quota_deduction_update",
            }
            updates_to_perform.append(quota_update)

    # Execute all updates with retry logic for deadlock prevention
    start_time = time_module.perf_counter()
    try:
        _execute_provider_updates_with_retry(updates_to_perform)

        # Log successful completion with timing and update stats
        duration = time_module.perf_counter() - start_time
        _update_stats["total_updates"] += 1
        _update_stats["successful_updates"] += 1
        _update_stats["total_duration"] += duration

        logger.info(
            f"Provider updates completed successfully. "
            f"Updates: {len(updates_to_perform)}, Duration: {duration:.3f}s, "
            f"Tenant: {tenant_id}, Provider: {provider_name}"
        )

        # Log performance stats periodically
        if _update_stats["total_updates"] % 100 == 0:
            _log_performance_stats()

    except Exception as e:
        # Log failure with timing and context, update stats
        duration = time_module.perf_counter() - start_time
        _update_stats["total_updates"] += 1
        _update_stats["failed_updates"] += 1
        _update_stats["total_duration"] += duration

        logger.exception(
            f"Provider updates failed after {duration:.3f}s. "
            f"Updates: {len(updates_to_perform)}, Tenant: {tenant_id}, "
            f"Provider: {provider_name}"
        )
        raise


def _calculate_quota_usage(message: Any, system_configuration: Any) -> Optional[int]:
    """Calculate quota usage based on message tokens and quota type."""
    try:
        if system_configuration.current_quota_type == QuotaUnit.TOKENS:
            tokens = getattr(message, "answer_tokens", None)
            return int(tokens) if tokens is not None else None
        elif system_configuration.current_quota_type == QuotaUnit.TIMES:
            return 1
        return None
    except Exception as e:
        logger.warning(f"Failed to calculate quota usage: {e}")
        return None


def _execute_provider_updates_with_retry(updates_to_perform: list[dict[str, Any]], max_retries: int = 3):
    """
    Execute Provider updates with deadlock retry logic.

    Args:
        updates_to_perform: List of update operations to perform
        max_retries: Maximum number of retry attempts for deadlock recovery
    """
    for attempt in range(max_retries + 1):
        try:
            _execute_provider_updates(updates_to_perform)
            return  # Success, exit retry loop

        except IntegrityError as e:
            # Don't retry integrity constraint violations
            logger.exception("Integrity constraint violation in Provider update")
            raise

        except (OperationalError, DatabaseError) as e:
            error_msg = str(e).lower()

            # Check for various deadlock/lock timeout patterns across different databases
            is_deadlock = any(
                pattern in error_msg
                for pattern in [
                    "deadlock detected",
                    "deadlock found",
                    "lock wait timeout",
                    "lock timeout",
                    "serialization failure",
                    "could not serialize access",
                ]
            )

            if is_deadlock and attempt < max_retries:
                # Track deadlock retry statistics
                _update_stats["deadlock_retries"] += 1

                # Exponential backoff with jitter for deadlock recovery
                base_delay = (2**attempt) * 0.1
                jitter = secrets.randbelow(100) / 1000.0  # 0.0 to 0.099
                delay = base_delay + jitter

                logger.warning(
                    f"Database lock conflict detected in Provider update "
                    f"(attempt {attempt + 1}/{max_retries + 1}). "
                    f"Retrying in {delay:.2f}s. Error: {e}"
                )
                time.sleep(delay)
                continue
            else:
                # Not a deadlock or max retries exceeded
                logger.exception(f"Failed to update Provider after {attempt + 1} attempts")
                raise

        except Exception as e:
            logger.exception("Unexpected error updating Provider")
            raise


def _execute_provider_updates(updates_to_perform: list[dict[str, Any]]):
    """Execute all Provider updates in a single transaction with proper isolation."""
    if not updates_to_perform:
        return

    # Start a new transaction with explicit isolation level
    try:
        # Set transaction isolation level to prevent phantom reads
        # This helps reduce deadlock probability
        db.session.execute(text("SET TRANSACTION ISOLATION LEVEL READ COMMITTED"))

        # Use a single transaction for all updates
        for update_info in updates_to_perform:
            filters = update_info["filters"]
            values = update_info["values"]
            additional_filters = update_info.get("additional_filters", {})
            description = update_info.get("description", "unknown")

            # Build the query with consistent ordering to prevent deadlocks
            # Order by tenant_id, provider_name to ensure consistent lock acquisition
            query = (
                db.session.query(Provider)
                .filter(Provider.tenant_id == filters["tenant_id"], Provider.provider_name == filters["provider_name"])
                .order_by(Provider.tenant_id, Provider.provider_name)
            )

            # Add additional filters if specified
            if "provider_type" in filters:
                query = query.filter(Provider.provider_type == filters["provider_type"])
            if "quota_type" in filters:
                query = query.filter(Provider.quota_type == filters["quota_type"])
            if additional_filters.get("quota_limit_check"):
                query = query.filter(Provider.quota_limit > Provider.quota_used)

            # Execute the update
            rows_affected = query.update(values, synchronize_session=False)

            logger.debug(
                f"Provider update ({description}): {rows_affected} rows affected. Filters: {filters}, Values: {values}"
            )

            # If no rows were affected for quota updates, log a warning
            if rows_affected == 0 and description == "quota_deduction_update":
                logger.warning(
                    f"No Provider rows updated for quota deduction. "
                    f"This may indicate quota limit exceeded or provider not found. "
                    f"Filters: {filters}"
                )

        # Commit all updates in a single transaction
        db.session.commit()
        logger.debug(f"Successfully committed {len(updates_to_perform)} Provider updates")

    except Exception as e:
        # Rollback on any error
        try:
            db.session.rollback()
            logger.debug("Transaction rolled back successfully")
        except Exception as rollback_error:
            logger.exception("Error during rollback")

        logger.exception("Failed to update Provider")
        raise


def _log_performance_stats():
    """Log performance statistics for Provider updates."""
    stats = _update_stats.copy()

    if stats["total_updates"] > 0:
        success_rate = (stats["successful_updates"] / stats["total_updates"]) * 100
        avg_duration = stats["total_duration"] / stats["total_updates"]

        logger.info(
            f"Provider Update Performance Stats: "
            f"Total: {stats['total_updates']}, "
            f"Success Rate: {success_rate:.1f}%, "
            f"Avg Duration: {avg_duration:.3f}s, "
            f"Deadlock Retries: {stats['deadlock_retries']}, "
            f"Failed: {stats['failed_updates']}"
        )


def get_update_stats():
    """Get current update statistics for monitoring."""
    return _update_stats.copy()
