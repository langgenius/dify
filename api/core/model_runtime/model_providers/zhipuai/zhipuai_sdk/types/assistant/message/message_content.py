from typing import Annotated, TypeAlias, Union

from ....core._utils import PropertyInfo
from .text_content_block import TextContentBlock
from .tools_delta_block import ToolsDeltaBlock

__all__ = ["MessageContent"]


MessageContent: TypeAlias = Annotated[
    Union[ToolsDeltaBlock, TextContentBlock],
    PropertyInfo(discriminator="type"),
]
