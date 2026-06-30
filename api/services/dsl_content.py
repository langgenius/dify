"""Shared DSL content guards used before YAML parsing.

DSL imports can arrive as already-decoded request payloads or as bytes fetched
from remote URLs. The import boundary should apply the same byte-size limit to
both forms before YAML parsing or Redis persistence.
"""

from typing import Any, Final

from core.helper.download import DownloadSizeLimitExceededError, download_with_size_limit

DEFAULT_DSL_MAX_SIZE: Final = 10 * 1024 * 1024  # 10MB

__all__ = [
    "DEFAULT_DSL_MAX_SIZE",
    "DownloadSizeLimitExceededError",
    "decode_dsl_content",
    "dsl_content_size",
    "exceeds_dsl_size_limit",
    "fetch_dsl_content_from_url",
]


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


def fetch_dsl_content_from_url(url: str, max_size: int, **kwargs: Any) -> bytes:
    """Fetch remote DSL content while enforcing the same byte limit during download."""
    return download_with_size_limit(url, max_size, **kwargs)
