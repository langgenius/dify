from typing import Any, Literal

from pydantic import BaseModel
from pydantic.version import VERSION as PYDANTIC_VERSION

PYDANTIC_V2 = PYDANTIC_VERSION.startswith("2.")

if PYDANTIC_V2:
    from pydantic_core import Url as Url

    def _model_dump(
        model: BaseModel, mode: Literal["json", "python"] = "json", **kwargs: Any
    ) -> Any:
        return model.model_dump(mode=mode, **kwargs)
else:
    from pydantic import AnyUrl as Url  # noqa: F401

    def _model_dump(
        model: BaseModel, mode: Literal["json", "python"] = "json", **kwargs: Any
    ) -> Any:
        return model.dict(**kwargs)
