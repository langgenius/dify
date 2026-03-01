from collections.abc import Sequence
from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities.model_entities import AIModelEntity
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.workflow.enums import SystemVariableKey
from core.workflow.file.models import File
from core.workflow.runtime import VariablePool
from core.workflow.variables.segments import ArrayAnySegment, ArrayFileSegment, FileSegment, NoneSegment, StringSegment
from extensions.ext_database import db
from models.model import Conversation

from .exc import InvalidVariableTypeError


def fetch_model_schema(*, model_instance: ModelInstance) -> AIModelEntity:
    model_schema = cast(LargeLanguageModel, model_instance.model_type_instance).get_model_schema(
        model_instance.model_name,
        model_instance.credentials,
    )
    if not model_schema:
        raise ValueError(f"Model schema not found for {model_instance.model_name}")
    return model_schema


def fetch_files(variable_pool: VariablePool, selector: Sequence[str]) -> Sequence["File"]:
    variable = variable_pool.get(selector)
    if variable is None:
        return []
    elif isinstance(variable, FileSegment):
        return [variable.value]
    elif isinstance(variable, ArrayFileSegment):
        return variable.value
    elif isinstance(variable, NoneSegment | ArrayAnySegment):
        return []
    raise InvalidVariableTypeError(f"Invalid variable type: {type(variable)}")


def fetch_memory(
    variable_pool: VariablePool, app_id: str, node_data_memory: MemoryConfig | None, model_instance: ModelInstance
) -> TokenBufferMemory | None:
    if not node_data_memory:
        return None

    # get conversation id
    conversation_id_variable = variable_pool.get(["sys", SystemVariableKey.CONVERSATION_ID])
    if not isinstance(conversation_id_variable, StringSegment):
        return None
    conversation_id = conversation_id_variable.value

    with Session(db.engine, expire_on_commit=False) as session:
        stmt = select(Conversation).where(Conversation.app_id == app_id, Conversation.id == conversation_id)
        conversation = session.scalar(stmt)
        if not conversation:
            return None

    memory = TokenBufferMemory(conversation=conversation, model_instance=model_instance)
    return memory
