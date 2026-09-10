"""Shared DSL content size and decoding rules."""

DSL_MAX_SIZE = 10 * 1024 * 1024  # 10MB


def dsl_content_size(content: str | bytes) -> int:
    if isinstance(content, bytes):
        return len(content)
    return len(content.encode("utf-8"))
