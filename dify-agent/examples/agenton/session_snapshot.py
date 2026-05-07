"""Run with: uv run --project dify-agent python examples/agenton/session_snapshot.py."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from dataclasses import dataclass
from typing import ClassVar

from pydantic import BaseModel, ConfigDict
from typing_extensions import override

from agenton.compositor import Compositor
from agenton.layers import LayerControl, NoLayerDeps, PlainLayer, PlainPromptType, PlainToolType


class ConnectionState(BaseModel):
    connection_id: str = "demo-connection"

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class ConnectionHandle:
    def __init__(self, connection_id: str) -> None:
        self.connection_id = connection_id


class ConnectionHandles(BaseModel):
    connection: ConnectionHandle | None = None

    model_config = ConfigDict(extra="forbid", validate_assignment=True, arbitrary_types_allowed=True)


@dataclass(slots=True)
class ConnectionLayer(PlainLayer[NoLayerDeps]):
    runtime_state_type: ClassVar[type[BaseModel]] = ConnectionState
    runtime_handles_type: ClassVar[type[BaseModel]] = ConnectionHandles

    @override
    async def on_context_create(self, control: LayerControl) -> None:
        assert isinstance(control.runtime_state, ConnectionState)
        assert isinstance(control.runtime_handles, ConnectionHandles)
        control.runtime_handles.connection = ConnectionHandle(control.runtime_state.connection_id)

    @override
    async def on_context_resume(self, control: LayerControl) -> None:
        assert isinstance(control.runtime_state, ConnectionState)
        assert isinstance(control.runtime_handles, ConnectionHandles)
        control.runtime_handles.connection = ConnectionHandle(f"restored:{control.runtime_state.connection_id}")


async def main() -> None:
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("connection", ConnectionLayer())])
    )
    session = compositor.new_session()
    async with compositor.enter(session) as active_session:
        active_session.suspend_on_exit()

    snapshot = compositor.snapshot_session(session)
    print("Snapshot:", snapshot.model_dump(mode="json"))

    restored = compositor.session_from_snapshot(snapshot)
    async with compositor.enter(restored):
        handles = restored.layer("connection").runtime_handles
        assert isinstance(handles, ConnectionHandles)
        assert handles.connection is not None
        print("Rehydrated handle:", handles.connection.connection_id)


if __name__ == "__main__":
    asyncio.run(main())
