"""Batch text without changing its contents or exceeding JSON payload limits."""

import json
from collections.abc import Iterator, Sequence


def iter_text_batches(texts: Sequence[str], *, max_items: int, max_bytes: int) -> Iterator[list[str]]:
    """Bound a JSON text array by item count and encoded bytes, preserving order.

    Check every item before yielding so an oversized item cannot cause partial
    processing. Strings are never split: doing so can change tokenizer results.
    The byte limit includes JSON escaping, quotes, brackets and separators.
    """
    if max_items <= 0 or max_bytes < 2:
        raise ValueError("Batch limits must allow at least one item and an empty JSON array.")
    text_sizes = [len(json.dumps(text, ensure_ascii=True).encode("utf-8")) for text in texts]
    if any(size + 2 > max_bytes for size in text_sizes):
        raise ValueError("Text exceeds the batch size limit; reduce the chunk size.")

    batch: list[str] = []
    batch_bytes = 2
    for text, text_size in zip(texts, text_sizes, strict=True):
        additional_bytes = text_size + (2 if batch else 0)
        if batch and (len(batch) >= max_items or batch_bytes + additional_bytes > max_bytes):
            yield batch
            batch = []
            batch_bytes = 2
            additional_bytes = text_size
        batch.append(text)
        batch_bytes += additional_bytes
    if batch:
        yield batch
