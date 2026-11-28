"""Canonical plugin provider identities, independent of provider loading and persistence."""

import re


def normalize_provider_id(value: str) -> str:
    """Expand shorthand provider IDs; return canonical IDs or raise ValueError without I/O."""
    if re.match(r"^[a-z0-9_-]+\/[a-z0-9_-]+\/[a-z0-9_-]+$", value):
        return value
    if re.match(r"^[a-z0-9_-]+$", value):
        return f"langgenius/{value}/{value}"
    raise ValueError(f"Invalid plugin id {value}")


def normalize_tool_provider_id(value: str) -> str:
    """Normalize a provider ID with tool aliases; reject invalid IDs without loading providers."""
    organization, plugin_name, provider_name = normalize_provider_id(value).split("/")
    if organization == "langgenius" and provider_name in ("jina", "siliconflow", "stepfun", "gitee_ai"):
        plugin_name = f"{provider_name}_tool"
    return f"{organization}/{plugin_name}/{provider_name}"
