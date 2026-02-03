from __future__ import annotations

import sys

from pydantic import TypeAdapter, with_config

from core.workflow.entities.base_node import BaseNodeData

if sys.version_info >= (3, 12):
    from typing import TypedDict
else:
    from typing_extensions import TypedDict


@with_config(extra="allow")
class NodeConfigDict(TypedDict):
    id: str
    data: BaseNodeData


NodeConfigDictAdapter = TypeAdapter(NodeConfigDict)
