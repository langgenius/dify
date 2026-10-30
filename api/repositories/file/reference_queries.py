"""SQL helpers shared by upload-file owner reference queries."""

from __future__ import annotations

import base64
from collections.abc import Sequence
from typing import Any

from sqlalchemy import String, or_
from sqlalchemy.sql.elements import ColumnElement

from services.entities.upload_file import UploadFileReferenceCandidate
from services.file_reference_parser import CANONICAL_FILE_REFERENCE_PREFIX

REFERENCE_QUERY_BATCH_SIZE = 100


def _canonical_record_id_tokens(record_id: str) -> tuple[str, ...]:
    """Return base64 substrings covering every JSON byte alignment for an id."""

    raw_id = record_id.encode()
    tokens: list[str] = []
    for offset in range(3):
        aligned = raw_id[offset:]
        stable_length = len(aligned) - len(aligned) % 3
        if stable_length:
            tokens.append(base64.urlsafe_b64encode(aligned[:stable_length]).decode().rstrip("="))
    if tokens:
        return tuple(tokens)
    # Upload ids are UUIDs in production. Keep malformed historical short ids
    # conservative instead of allowing a canonical-only reference to be missed.
    return (CANONICAL_FILE_REFERENCE_PREFIX,)


def candidate_batches(
    candidates: Sequence[UploadFileReferenceCandidate],
) -> tuple[tuple[UploadFileReferenceCandidate, ...], ...]:
    """Return stable, bounded candidate batches for owner-domain queries."""

    by_id = {candidate.id: candidate for candidate in candidates if candidate.id}
    ordered = tuple(by_id[file_id] for file_id in sorted(by_id))
    return tuple(
        ordered[offset : offset + REFERENCE_QUERY_BATCH_SIZE]
        for offset in range(0, len(ordered), REFERENCE_QUERY_BATCH_SIZE)
    )


def payload_reference_predicate(
    columns: Sequence[Any],
    candidates: Sequence[UploadFileReferenceCandidate],
) -> ColumnElement[bool]:
    """Prefilter payload rows without treating the SQL substring as ownership proof."""

    tokens = [candidate.id for candidate in candidates if candidate.id]
    tokens.extend(candidate.key for candidate in candidates if candidate.key)
    tokens.extend(
        token for candidate in candidates if candidate.id for token in _canonical_record_id_tokens(candidate.id)
    )
    predicates = [
        column.cast(String).contains(token, autoescape=True) for column in columns for token in dict.fromkeys(tokens)
    ]
    return or_(*predicates)
