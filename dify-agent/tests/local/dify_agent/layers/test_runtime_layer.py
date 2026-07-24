from __future__ import annotations

from dataclasses import dataclass, field
from typing import cast

import pytest

from dify_agent.layers.runtime import DifyRuntimeLayer, DifyRuntimeLayerConfig
from dify_agent.runtime_backend import RuntimeLayout, RuntimeLease


@dataclass(slots=True)
class _Backend:
    lease: RuntimeLease
    acquired: list[str] = field(default_factory=list)
    released: list[RuntimeLease] = field(default_factory=list)

    async def acquire(self, binding_ref: str) -> RuntimeLease:
        self.acquired.append(binding_ref)
        return self.lease

    async def release(self, lease: RuntimeLease) -> None:
        self.released.append(lease)


@pytest.mark.anyio
async def test_runtime_layer_acquires_and_releases_operation_scoped_lease() -> None:
    lease = cast(
        RuntimeLease,
        type(
            "Lease",
            (),
            {
                "layout": RuntimeLayout(home_dir="/home/agent", workspace_dir="/workspace"),
                "commands": object(),
                "files": object(),
            },
        )(),
    )
    backend = _Backend(lease=lease)
    layer = DifyRuntimeLayer.from_config_with_backend(
        DifyRuntimeLayerConfig(backend_binding_ref="binding-1"),
        backend=backend,  # pyright: ignore[reportArgumentType]
    )

    async with layer.resource_context():
        assert layer.lease is lease
        await layer.on_context_create()
        await layer.on_context_suspend()
        await layer.on_context_delete()

    assert backend.acquired == ["binding-1"]
    assert backend.released == [lease]
    with pytest.raises(RuntimeError, match="resource_context"):
        _ = layer.lease


def test_runtime_layer_config_contains_only_backend_binding_ref() -> None:
    config = DifyRuntimeLayerConfig(backend_binding_ref="binding-1")

    assert config.model_dump() == {"backend_binding_ref": "binding-1"}
