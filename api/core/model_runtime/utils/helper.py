import pydantic
from pydantic import BaseModel


def dump_model(model: BaseModel) -> dict:
    if hasattr(pydantic, "model_dump"):
        # FIXME mypy error, try to fix it instead of using type: ignore
        return pydantic.model_dump(model)  # type: ignore
    else:
        return model.model_dump()
