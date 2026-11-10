from collections.abc import Iterator
from unittest.mock import ANY, patch
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import (
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.entities.app_invoke_entities import (
    AgentAppGenerateEntity,
    ChatAppGenerateEntity,
    CreditUsageCreatedBy,
    InvokeFrom,
)
from core.credit_usage import CreditUsageAppType
from core.entities.provider_entities import ProviderQuotaType, QuotaConfiguration, QuotaUnit, SystemConfiguration
from events.event_handlers import update_provider_when_message_created
from models import AppMode, Message, TenantCreditPool
from models.enums import ProviderQuotaType as ModelProviderQuotaType
from models.provider import ProviderType
from tests.helpers.unit.core.model_fixtures import make_model_config


def _accounting_entity(
    *,
    tenant_id: str,
    app_mode: AppMode,
    quota_type: ProviderQuotaType,
    quota_unit: QuotaUnit,
    agent_gateway: bool = False,
) -> ChatAppGenerateEntity:
    """Build the generate entity the message-created handler reads.

    Preconditions: ``quota_type`` and ``quota_unit`` are real quota enums.
    Postconditions: the entity carries a system provider configuration for that
    quota and, when ``agent_gateway`` is true, an agent app that skips the
    legacy message charge.
    """

    model_conf = make_model_config(provider="openai", model="gpt-4o", mode="chat")
    configuration = model_conf.provider_model_bundle.configuration
    configuration.using_provider_type = ProviderType.SYSTEM
    configuration.system_configuration = SystemConfiguration(
        enabled=True,
        current_quota_type=quota_type,
        quota_configurations=[
            QuotaConfiguration(
                quota_type=quota_type,
                quota_unit=quota_unit,
                quota_limit=10,
                quota_used=0,
                is_valid=True,
            )
        ],
    )
    app_config = EasyUIBasedAppConfig(
        tenant_id=tenant_id,
        app_id="app-1",
        app_mode=app_mode,
        app_model_config_from=EasyUIBasedAppModelConfigFrom.ARGS,
        app_model_config_dict={},
        model=ModelConfigEntity(provider="openai", model="gpt-4o"),
        prompt_template=PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
            simple_prompt_template="prompt",
        ),
    )
    if agent_gateway:
        return AgentAppGenerateEntity(
            task_id="task",
            app_config=app_config,
            model_conf=model_conf,
            inputs={},
            files=[],
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.DEBUGGER,
            agent_id="agent-1",
            agent_config_snapshot_id="snapshot-1",
            agent_llm_gateway_enabled=True,
        )
    return ChatAppGenerateEntity(
        task_id="task",
        app_config=app_config,
        model_conf=model_conf,
        inputs={},
        files=[],
        user_id="user",
        stream=False,
        invoke_from=InvokeFrom.DEBUGGER,
    )


@pytest.fixture
def credit_pool_session_factory(sqlite_session_factory: sessionmaker[Session]) -> Iterator[sessionmaker[Session]]:
    """Bind message-created accounting to fixture-owned SQLite sessions."""
    with patch("events.event_handlers.update_provider_when_message_created.db.session", sqlite_session_factory):
        yield sqlite_session_factory


def test_message_created_trial_credit_accounting_does_not_raise_when_balance_is_insufficient(
    credit_pool_session_factory: sessionmaker[Session],
) -> None:
    tenant_id = str(uuid4())
    pool_id = str(uuid4())
    pool = TenantCreditPool(
        tenant_id=tenant_id,
        pool_type=ModelProviderQuotaType.TRIAL,
        quota_limit=10,
        quota_used=9,
    )
    pool.id = pool_id
    with credit_pool_session_factory.begin() as session:
        session.add(pool)

    application_generate_entity = _accounting_entity(
        tenant_id=tenant_id,
        app_mode=AppMode.CHAT,
        quota_type=ProviderQuotaType.TRIAL,
        quota_unit=QuotaUnit.TOKENS,
    )
    message = Message(message_tokens=2, answer_tokens=1)
    message.id = "message-1"

    with (
        patch.object(update_provider_when_message_created, "_execute_provider_updates"),
    ):
        update_provider_when_message_created.handle(
            sender=message,
            application_generate_entity=application_generate_entity,
        )

    with credit_pool_session_factory() as session:
        quota_used = session.scalar(select(TenantCreditPool.quota_used).where(TenantCreditPool.id == pool_id))

    assert quota_used == 10


def test_message_created_paid_credit_accounting_uses_paid_pool() -> None:
    tenant_id = str(uuid4())
    application_generate_entity = _accounting_entity(
        tenant_id=tenant_id,
        app_mode=AppMode.CHAT,
        quota_type=ProviderQuotaType.PAID,
        quota_unit=QuotaUnit.TOKENS,
    )
    message = Message(message_tokens=2, answer_tokens=1)
    message.id = "message-1"

    with (
        patch.object(update_provider_when_message_created, "_deduct_credit_pool_quota_capped") as mock_deduct,
        patch.object(update_provider_when_message_created, "_execute_provider_updates"),
    ):
        update_provider_when_message_created.handle(
            sender=message,
            application_generate_entity=application_generate_entity,
        )

    mock_deduct.assert_called_once_with(
        tenant_id=tenant_id,
        credits_required=3,
        pool_type="paid",
        request_id="message-1",
        metadata={
            "provider": "openai",
            "model": "gpt-4o",
            "model_type": "llm",
            "app_type": CreditUsageAppType.CHATBOT,
            "created_by": CreditUsageCreatedBy.APP.value,
        },
    )


def test_agent_app_gateway_accounting_skips_legacy_message_charge() -> None:
    tenant_id = str(uuid4())
    application_generate_entity = _accounting_entity(
        tenant_id=tenant_id,
        app_mode=AppMode.AGENT,
        quota_type=ProviderQuotaType.TRIAL,
        quota_unit=QuotaUnit.CREDITS,
        agent_gateway=True,
    )

    with (
        patch.object(update_provider_when_message_created, "_deduct_credit_pool_quota_capped") as mock_deduct,
        patch.object(update_provider_when_message_created, "_execute_provider_updates") as mock_updates,
    ):
        update_provider_when_message_created.handle(
            sender=Message(message_tokens=2, answer_tokens=1),
            application_generate_entity=application_generate_entity,
        )

    mock_deduct.assert_not_called()
    mock_updates.assert_called_once()
    assert len(mock_updates.call_args.args[0]) == 1
    assert mock_updates.call_args.args[0][0].description == "basic_last_used_update"


def test_capped_credit_pool_accounting_skips_exhaustion_warning_when_full_amount_is_deducted(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with patch(
        "services.credit_pool_service.CreditPoolService.deduct_credits_capped",
        return_value=3,
    ) as mock_deduct:
        update_provider_when_message_created._deduct_credit_pool_quota_capped(
            tenant_id="tenant-id",
            credits_required=3,
            pool_type="trial",
        )

    mock_deduct.assert_called_once_with(
        tenant_id="tenant-id",
        credits_required=3,
        pool_type="trial",
        session=ANY,
    )
    assert "Credit pool exhausted during message-created accounting" not in caplog.text
