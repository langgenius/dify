from __future__ import annotations

from typing import TypedDict

from pydantic import TypeAdapter, with_config

from graphon.entities.base_node_data import BaseNodeData


@with_config(extra="allow")
class NodeConfigDict(TypedDict):
    id: str
    # This is the permissive raw graph boundary. Node factories re-validate `data`
    # with the concrete `NodeData` subtype after resolving the node implementation.
    data: BaseNodeData


NodeConfigDictAdapter = TypeAdapter(NodeConfigDict)
