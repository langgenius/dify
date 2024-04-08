from typing import Any, List
from pydantic import BaseModel, ConfigDict
from langchain_core.load.serializable import Serializable
from langchain_core.pydantic_v1 import BaseModel, ConfigDict


class PromptMessageFile(BaseModel):
    data: Any = None
    model_config = ConfigDict(arbitrary_types_allowed=True)


class LCHumanMessageWithFiles(Serializable):
    # content: Union[str, list[Union[str, Dict]]]
    content: str
    files: List[PromptMessageFile]
    model_config = ConfigDict(arbitrary_types_allowed=True)

