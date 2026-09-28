"""Run with: uv run --project dify-agent python -m agenton_examples.session_snapshot."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import ClassVar

from pydantic import BaseModel, ConfigDict

from agenton.compositor import Compositor, LayerNode
from agenton.layers import EmptyLayerConfig, NoLayerDeps, PlainLayer


class ConnectionState(BaseModel):
    connection_id: str = "demo-connection"

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class ConnectionHandle:
    def __init__(self, connection_id: str) -> None:
        self.connection_id = connection_id


@dataclass(slots=True)
class ConnectionLayer(PlainLayer[NoLayerDeps, EmptyLayerConfig, ConnectionState]):
    runtime_state_type: ClassVar[type[BaseModel]] = ConnectionState


async def main() -> None:
    compositor = Compositor([LayerNode("connection", ConnectionLayer)])
    async with compositor.enter() as run:
        layer = run.get_layer("connection", ConnectionLayer)
        connection = ConnectionHandle(layer.runtime_state.connection_id)
        print("Active external handle:", connection.connection_id)
        run.suspend_on_exit()

    snapshot = run.session_snapshot
    assert snapshot is not None
    print("Snapshot:", snapshot.model_dump(mode="json"))

    async with compositor.enter(session_snapshot=snapshot) as restored_run:
        layer = restored_run.get_layer("connection", ConnectionLayer)
        restored_connection = ConnectionHandle(f"restored:{layer.runtime_state.connection_id}")
        print("Rehydrated external handle:", restored_connection.connection_id)


if __name__ == "__main__":
    asyncio.run(main())
