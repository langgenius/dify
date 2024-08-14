from typing import Optional

from typing_extensions import TypedDict


class Reference(TypedDict, total=False):
    enable: Optional[bool]
    search_query: Optional[str]
