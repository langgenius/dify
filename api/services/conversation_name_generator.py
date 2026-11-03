"""Prepare a conversation-title model separately from its invocation."""

from typing import override

from flask import current_app

from core.app.entities.app_invoke_entities import get_credit_usage_app_type
from core.credit_usage import CreditUsageCreatedBy
from core.llm_generator.llm_generator import LLMGenerator
from core.model_context import use_credit_usage_metadata
from core.model_manager import ModelManager
from extensions.ext_database import db
from graphon.model_runtime.entities.model_entities import ModelType
from services.conversation_name_service import ConversationNameGenerator
from services.tracing.scopes import UNCORRELATED, TraceScopes


class DefaultModelConversationNameGenerator(ConversationNameGenerator):
    """Name conversations with the workspace's default model and report each naming to its app's trace."""

    def __init__(self, *, trace_scopes: TraceScopes) -> None:
        self._trace_scopes = trace_scopes

    @override
    def __call__(self, *, tenant_id: str, app_id: str, conversation_id: str, query: str, app_mode: str) -> str:
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
                trace_scope=self._trace_scopes.for_app(
                    tenant_id=tenant_id, app_id=app_id, user_id=None, correlation=UNCORRELATED
                ),
            )
