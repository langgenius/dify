import logging
import time as time_module
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.orm import Session

from configs import dify_config
from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity, ChatAppGenerateEntity
from core.entities.provider_entities import QuotaUnit, SystemConfiguration
from core.plugin.entities.plugin import ModelProviderID
from events.message_event import message_was_created
from extensions.ext_database import db
from libs import datetime_utils
from models.model import Message
from models.provider import Provider, ProviderType

logger = logging.getLogger(__name__)


class _ProviderUpdateFilters(BaseModel):
    """Filters for identifying Provider records to update."""

    tenant_id: str
    provider_name: str
    provider_type: Optional[str] = None
    quota_type: Optional[str] = None


class _ProviderUpdateAdditionalFilters(BaseModel):
    """Additional filters for Provider updates."""

    quota_limit_check: bool = False


class _ProviderUpdateValues(BaseModel):
    """Values to update in Provider records."""

    last_used: Optional[datetime] = None
    quota_used: Optional[Any] = None  # Can be Provider.quota_used + int expression


class _ProviderUpdateOperation(BaseModel):
    """A single Provider update operation."""

    filters: _ProviderUpdateFilters
    values: _ProviderUpdateValues
    additional_filters: _ProviderUpdateAdditionalFilters = _ProviderUpdateAdditionalFilters()
    description: str = "unknown"


@message_was_created.connect
def handle(sender: Message, **kwargs):
    """
    Consolidated handler for Provider updates when a message is created.

    This handler replaces both:
    - update_provider_last_used_at_when_message_created
    - deduct_quota_when_message_created

    By performing all Provider updates in a single transaction, we ensure
    consistency and efficiency when updating Provider records.
    """
    message = sender
    application_generate_entity = kwargs.get("application_generate_entity")

    if not isinstance(application_generate_entity, ChatAppGenerateEntity | AgentChatAppGenerateEntity):
        return

    tenant_id = application_generate_entity.app_config.tenant_id
    provider_name = application_generate_entity.model_conf.provider
    current_time = datetime_utils.naive_utc_now()

    # Prepare updates for both scenarios
    updates_to_perform: list[_ProviderUpdateOperation] = []

    # 1. Always update last_used for the provider
    basic_update = _ProviderUpdateOperation(
        filters=_ProviderUpdateFilters(
            tenant_id=tenant_id,
            provider_name=provider_name,
        ),
        values=_ProviderUpdateValues(last_used=current_time),
        description="basic_last_used_update",
    )
    logger.info("provider used, tenant_id=%s, provider_name=%s", tenant_id, provider_name)
    updates_to_perform.append(basic_update)

    # 2. Check if we need to deduct quota (system provider only)
    model_config = application_generate_entity.model_conf
    provider_model_bundle = model_config.provider_model_bundle
    provider_configuration = provider_model_bundle.configuration

    if (
        provider_configuration.using_provider_type == ProviderType.SYSTEM
        and provider_configuration.system_configuration
        and provider_configuration.system_configuration.current_quota_type is not None
    ):
        system_configuration = provider_configuration.system_configuration

        # Calculate quota usage
        used_quota = _calculate_quota_usage(
            message=message,
            system_configuration=system_configuration,
            model_name=model_config.model,
        )

        if used_quota is not None:
            quota_update = _ProviderUpdateOperation(
                filters=_ProviderUpdateFilters(
                    tenant_id=tenant_id,
                    provider_name=ModelProviderID(model_config.provider).provider_name,
                    provider_type=ProviderType.SYSTEM.value,
                    quota_type=provider_configuration.system_configuration.current_quota_type.value,
                ),
                values=_ProviderUpdateValues(quota_used=Provider.quota_used + used_quota, last_used=current_time),
                additional_filters=_ProviderUpdateAdditionalFilters(
                    quota_limit_check=True  # Provider.quota_limit > Provider.quota_used
                ),
                description="quota_deduction_update",
            )
            updates_to_perform.append(quota_update)

    # Execute all updates
    start_time = time_module.perf_counter()
    try:
        _execute_provider_updates(updates_to_perform)

        # Log successful completion with timing
        duration = time_module.perf_counter() - start_time

        logger.info(
            "Provider updates completed successfully. Updates: %s, Duration: %s s, Tenant: %s, Provider: %s",
            len(updates_to_perform),
            duration,
            tenant_id,
            provider_name,
        )

    except Exception as e:
        # Log failure with timing and context
        duration = time_module.perf_counter() - start_time

        logger.exception(
            "Provider updates failed after %s s. Updates: %s, Tenant: %s, Provider: %s",
            duration,
            len(updates_to_perform),
            tenant_id,
            provider_name,
        )
        raise


def _calculate_quota_usage(
    *, message: Message, system_configuration: SystemConfiguration, model_name: str
) -> Optional[int]:
    """Calculate quota usage based on message tokens and quota type."""
    quota_unit = None
    for quota_configuration in system_configuration.quota_configurations:
        if quota_configuration.quota_type == system_configuration.current_quota_type:
            quota_unit = quota_configuration.quota_unit
            if quota_configuration.quota_limit == -1:
                return None
            break
    if quota_unit is None:
        return None

    try:
        if quota_unit == QuotaUnit.TOKENS:
            tokens = message.message_tokens + message.answer_tokens
            return tokens
        if quota_unit == QuotaUnit.CREDITS:
            tokens = dify_config.get_model_credits(model_name)
            return tokens
        elif quota_unit == QuotaUnit.TIMES:
            return 1
        return None
    except Exception as e:
        logger.exception("Failed to calculate quota usage")
        return None


def _execute_provider_updates(updates_to_perform: list[_ProviderUpdateOperation]):
    """Execute all Provider updates in a single transaction."""
    if not updates_to_perform:
        return

    updates_to_perform = sorted(updates_to_perform, key=lambda i: (i.filters.tenant_id, i.filters.provider_name))

    # Use SQLAlchemy's context manager for transaction management
    # This automatically handles commit/rollback
    with Session(db.engine) as session, session.begin():
        # Use a single transaction for all updates
        for update_operation in updates_to_perform:
            filters = update_operation.filters
            values = update_operation.values
            additional_filters = update_operation.additional_filters
            description = update_operation.description

            # Build the where conditions
            where_conditions = [
                Provider.tenant_id == filters.tenant_id,
                Provider.provider_name == filters.provider_name,
            ]

            # Add additional filters if specified
            if filters.provider_type is not None:
                where_conditions.append(Provider.provider_type == filters.provider_type)
            if filters.quota_type is not None:
                where_conditions.append(Provider.quota_type == filters.quota_type)
            if additional_filters.quota_limit_check:
                where_conditions.append(Provider.quota_limit > Provider.quota_used)

            # Prepare values dict for SQLAlchemy update
            update_values = {}
            # updateing to `last_used` is removed due to performance reason.
            # ref: https://github.com/langgenius/dify/issues/24526
            if values.quota_used is not None:
                update_values["quota_used"] = values.quota_used
            # Skip the current update operation if no updates are required.
            if not update_values:
                continue

            # Build and execute the update statement
            stmt = update(Provider).where(*where_conditions).values(**update_values)
            result = session.execute(stmt)
            rows_affected = result.rowcount

            logger.debug(
                "Provider update (%s): %s rows affected. Filters: %s, Values: %s",
                description,
                rows_affected,
                filters.model_dump(),
                update_values,
            )

            # If no rows were affected for quota updates, log a warning
            if rows_affected == 0 and description == "quota_deduction_update":
                logger.warning(
                    "No Provider rows updated for quota deduction. "
                    "This may indicate quota limit exceeded or provider not found. "
                    "Filters: %s",
                    filters.model_dump(),
                )

        logger.debug("Successfully processed %s Provider updates", len(updates_to_perform))
