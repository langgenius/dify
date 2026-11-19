"""Historical synchronization payload values."""

from __future__ import annotations

from collections.abc import Mapping

from pydantic import ConfigDict, JsonValue, RootModel


class OpaqueProviderPayload(RootModel[dict[str, JsonValue]]):
    """Opaque JSON retained by historical synchronization facts."""

    model_config = ConfigDict(frozen=True, strict=True, validate_default=True)

    # TODO(QuantumGhost): Remove from_mapping and to_mapping.
    @classmethod
    def from_mapping(cls, values: Mapping[str, JsonValue]) -> OpaqueProviderPayload:
        return cls(dict(values))

    def to_mapping(self) -> dict[str, JsonValue]:
        return dict(self.root)


__all__ = ["OpaqueProviderPayload"]
