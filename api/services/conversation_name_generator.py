"""Prepare a conversation-title model separately from its invocation."""

from flask import current_app

from core.app.entities.app_invoke_entities import get_credit_usage_app_type
from core.credit_usage import CreditUsageCreatedBy
from core.llm_generator.llm_generator import LLMGenerator
from core.model_context import use_credit_usage_metadata
from core.model_manager import ModelManager
from extensions.ext_database import db
from graphon.model_runtime.entities.model_entities import ModelType


def generate_conversation_name(*, tenant_id: str, app_id: str, conversation_id: str, query: str, app_mode: str) -> str:
    """Release model-preparation sessions before LLM I/O, preserving the caller's session."""
    # Provider resolution may commit; own its scope so it cannot affect the caller.
    with (
        current_app.app_context(),
        use_credit_usage_metadata(
            {"app_type": get_credit_usage_app_type(app_mode), "created_by": CreditUsageCreatedBy.CONVERSATION_NAME}
        ),
    ):
        model = ModelManager.for_tenant(tenant_id=tenant_id).get_default_model_instance(
            tenant_id=tenant_id, model_type=ModelType.LLM
        )
        db.session.remove()
        return LLMGenerator.generate_conversation_name(
            tenant_id=tenant_id,
            app_id=app_id,
            conversation_id=conversation_id,
            query=query,
            model_instance=model,
        )
