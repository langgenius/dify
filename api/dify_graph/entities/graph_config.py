from __future__ import annotations

import sys

from pydantic import TypeAdapter, with_config

from dify_graph.entities.base_node_data import BaseNodeData

if sys.version_info >= (3, 12):
    from typing import TypedDict
else:
    from typing_extensions import TypedDict


@with_config(extra="allow")
class NodeConfigDict(TypedDict):
    id: str
    # This is the permissive raw graph boundary. Node factories re-validate `data`
    # with the concrete `NodeData` subtype after resolving the node implementation.
    data: BaseNodeData


NodeConfigDictAdapter = TypeAdapter(NodeConfigDict)
