"""Shared DSL content guards used before YAML parsing.

DSL imports can arrive as already-decoded request payloads or as bytes fetched
from remote URLs. The import boundary should apply the same byte-size limit to
both forms before YAML parsing or Redis persistence.
"""

from typing import Final

DEFAULT_DSL_MAX_SIZE: Final = 10 * 1024 * 1024  # 10MB


def dsl_content_size(content: str | bytes) -> int:
    """Return the UTF-8 byte size used by DSL import limits."""
    if isinstance(content, str):
        return len(content.encode("utf-8"))
    return len(content)


def exceeds_dsl_size_limit(content: str | bytes, max_size: int) -> bool:
    """Check whether raw DSL content exceeds the configured byte limit."""
    return dsl_content_size(content) > max_size


def decode_dsl_content(content: str | bytes) -> str:
    """Return decoded YAML content after the caller has applied size guards."""
    if isinstance(content, str):
        return content
    return content.decode()
