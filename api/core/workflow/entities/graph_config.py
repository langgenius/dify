from __future__ import annotations

import sys

from pydantic import TypeAdapter, with_config

if sys.version_info >= (3, 12):
    from typing import TypedDict
else:
    from typing_extensions import TypedDict


@with_config(extra="allow")
class NodeConfigData(TypedDict):
    type: str


@with_config(extra="allow")
class NodeConfigDict(TypedDict):
    id: str
    data: NodeConfigData


NodeConfigDictAdapter = TypeAdapter(NodeConfigDict)
