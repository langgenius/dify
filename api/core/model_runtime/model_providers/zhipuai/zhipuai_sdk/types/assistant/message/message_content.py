
from typing import Union
from typing_extensions import Annotated, TypeAlias

from ....core._utils import PropertyInfo
from .tools_delta_block import ToolsDeltaBlock
from .text_content_block import TextContentBlock

__all__ = ["MessageContent"]


MessageContent: TypeAlias = Annotated[
    Union[ToolsDeltaBlock, TextContentBlock],
    PropertyInfo(discriminator="type"),
]