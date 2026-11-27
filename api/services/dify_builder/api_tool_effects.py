from collections.abc import Mapping
from typing import Any


def is_api_tool(data: Mapping[str, Any]) -> bool:
    """Recognize the native custom API capability, independent of its display name."""
    return data.get("type") == "tool" and data.get("provider_type") == "api"
