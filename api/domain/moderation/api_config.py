"""Parse untrusted API moderation settings into one operation's configuration.

Runtime admission inspects only the selected direction. Disabled selections do
not require a valid extension ID. Form admission checks both directions in order.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Annotated, Literal, TypedDict

from pydantic import Field, TypeAdapter


class APIModerationDirectionConfig(TypedDict):
    """A configured direction explicitly chooses a boolean enable state."""

    enabled: bool


class APIModerationConfig(TypedDict):
    """Complete authored settings, distinct from untrusted runtime input."""

    inputs_config: APIModerationDirectionConfig
    outputs_config: APIModerationDirectionConfig
    api_based_extension_id: str


_direction_adapter = TypeAdapter(APIModerationDirectionConfig)
_extension_id_adapter = TypeAdapter(Annotated[str, Field(strict=True, min_length=1)])


@dataclass(frozen=True, slots=True)
class DisabledDirection:
    """The selected direction requires no lookup or outbound work."""


@dataclass(frozen=True, slots=True)
class EnabledDirection:
    """The selected enabled direction carries its parsed, nonempty lookup key."""

    extension_id: str


def parse_direction(
    raw: Mapping[str, object] | None, direction: Literal["inputs_config", "outputs_config"]
) -> DisabledDirection | EnabledDirection:
    """Admit one raw runtime direction without inspecting the opposite direction.

    Missing config raises ValueError; malformed selected settings raise
    ValidationError. Disabled settings return before ID validation. No I/O occurs.
    """
    if raw is None:
        raise ValueError("The config is not set.")
    selected = _direction_adapter.validate_python(raw.get(direction), strict=True)
    if not selected["enabled"]:
        return DisabledDirection()
    return EnabledDirection(_extension_id_adapter.validate_python(raw.get("api_based_extension_id")))


def parse_form(raw: Mapping[str, object]) -> EnabledDirection:
    """Admit both form directions, require one enabled, then parse the ID without I/O.

    Malformed settings raise ValidationError. Two disabled directions retain their
    business error before ID validation, including when the ID is absent or invalid.
    """
    inputs_config = _direction_adapter.validate_python(raw.get("inputs_config"), strict=True)
    outputs_config = _direction_adapter.validate_python(raw.get("outputs_config"), strict=True)
    if not inputs_config["enabled"] and not outputs_config["enabled"]:
        raise ValueError("At least one of inputs_config or outputs_config must be enabled")
    return EnabledDirection(_extension_id_adapter.validate_python(raw.get("api_based_extension_id")))
