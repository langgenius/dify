"""Render prompt memory after the injected history reader releases its transaction."""

from collections.abc import Sequence
from dataclasses import dataclass

from core.model_manager import ModelInstance
from graphon.model_runtime.entities import PromptMessage
from services.workflow.execution.node_queries import ConversationHistory


@dataclass(frozen=True)
class NodeMemory:
    history: ConversationHistory
    tenant_id: str
    app_id: str
    conversation_id: str
    model_instance: ModelInstance

    def get_history_prompt_messages(
        self, max_token_limit: int = 2000, message_limit: int | None = None
    ) -> Sequence[PromptMessage]:
        prepared = self.history.history(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            conversation_id=self.conversation_id,
            message_limit=message_limit,
        )
        return prepared.get_prompt_messages(model_instance=self.model_instance, max_token_limit=max_token_limit)

    def get_history_prompt_text(
        self,
        human_prefix: str = "Human",
        ai_prefix: str = "Assistant",
        max_token_limit: int = 2000,
        message_limit: int | None = None,
    ) -> str:
        prepared = self.history.history(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            conversation_id=self.conversation_id,
            message_limit=message_limit,
        )
        return prepared.get_prompt_text(
            model_instance=self.model_instance,
            max_token_limit=max_token_limit,
            human_prefix=human_prefix,
            ai_prefix=ai_prefix,
        )
