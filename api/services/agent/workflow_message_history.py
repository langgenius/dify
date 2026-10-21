import logging

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from core.memory.token_buffer_memory import TokenBufferMemory
from extensions.ext_database import db
from graphon.model_runtime.entities.message_entities import PromptMessage
from models.model import App, Message
from repositories.factory import DifyAPIRepositoryFactory
from services.agent.message_history import AgentMessageHistory

logger = logging.getLogger(__name__)


def get_workflow_agent_history(
    *,
    memory: TokenBufferMemory,
    tenant_id: str,
    app_id: str,
    node_id: str,
    provider: str,
    model: str,
    message_limit: int | None,
) -> list[PromptMessage]:
    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    repository = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(session_maker)

    def load_message(message: Message) -> list[PromptMessage] | None:
        if message.app_id != app_id:
            return []
        if not message.workflow_run_id:
            return None
        executions = repository.get_executions_by_workflow_run(tenant_id, app_id, message.workflow_run_id)
        restored: list[PromptMessage] = []
        for execution in executions:
            if execution.node_id != node_id:
                continue
            process_data = repository.load_full_process_data(execution)
            if not process_data or "model_history" not in process_data:
                continue
            try:
                history = AgentMessageHistory.model_validate(process_data["model_history"])
                messages = history.restore(provider=provider, model=model)
                if messages is not None:
                    restored.extend(messages)
            except ValidationError:
                logger.warning("Invalid agent model history for execution %s", execution.id)
        return restored or None

    with session_maker() as session:
        app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id))
        if app is None or memory.conversation.app_id != app_id:
            return []
        history = TokenBufferMemory.load_history(
            conversation=memory.conversation,
            app_record=app,
            session=session,
            message_limit=message_limit,
            message_loader=load_message,
        )
    return history.to_prompt_messages()
