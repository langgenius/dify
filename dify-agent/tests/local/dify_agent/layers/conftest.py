from __future__ import annotations

import sys
import types

from agenton.layers import EmptyLayerConfig, EmptyRuntimeState, NoLayerDeps, PlainLayer
from pydantic import BaseModel


class _BaseSettings(BaseModel):
    """Minimal test stub for environments without pydantic-settings installed."""


class _SettingsConfigDict(dict[str, object]):
    """Minimal callable mapping used by ShellAdapterSettings.model_config."""


if "pydantic_settings" not in sys.modules:
    stub = types.ModuleType("pydantic_settings")
    setattr(stub, "BaseSettings", _BaseSettings)
    setattr(stub, "SettingsConfigDict", _SettingsConfigDict)
    sys.modules["pydantic_settings"] = stub


if "dify_agent.layers.execution_context.layer" not in sys.modules:
    execution_context_stub = types.ModuleType("dify_agent.layers.execution_context.layer")

    class DifyExecutionContextLayer(PlainLayer[NoLayerDeps, EmptyLayerConfig, EmptyRuntimeState]):
        """Minimal test stub for shell-layer type-only imports."""

    setattr(execution_context_stub, "DifyExecutionContextLayer", DifyExecutionContextLayer)
    sys.modules["dify_agent.layers.execution_context.layer"] = execution_context_stub
