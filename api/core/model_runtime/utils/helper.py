import pydantic
from pydantic import BaseModel

from core.model_runtime.entities.message_entities import PromptMessageContentUnionTypes


def dump_model(model: BaseModel) -> dict:
    if hasattr(pydantic, "model_dump"):
        # FIXME mypy error, try to fix it instead of using type: ignore
        return pydantic.model_dump(model)  # type: ignore
    else:
        return model.model_dump()


def convert_llm_result_chunk_to_str(content: None | str | list[PromptMessageContentUnionTypes]) -> str:
    if content is None:
        message_text = ""
    elif isinstance(content, str):
        message_text = content
    elif isinstance(content, list):
        # Assuming the list contains PromptMessageContent objects with a "data" attribute
        message_text = "".join(
            item.data if hasattr(item, "data") and isinstance(item.data, str) else str(item) for item in content
        )
    else:
        message_text = str(content)
    return message_text
