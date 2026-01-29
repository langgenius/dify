from __future__ import annotations

from typing import TypedDict

from pydantic import TypeAdapter, with_config


@with_config(extra="allow")
class NodeConfigData(TypedDict):
    type: str


@with_config(extra="allow")
class NodeConfigDict(TypedDict):
    id: str
    data: NodeConfigData


NodeConfigDictAdapter = TypeAdapter(NodeConfigDict)

