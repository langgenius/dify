from __future__ import annotations

import threading
from collections.abc import Iterable


class FileAccessRunGrants:
    """Mutable, workflow-run-scoped file access grants shared across graphon worker threads."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._retriever_segment_ids: set[str] = set()
        self._upload_file_ids: set[str] = set()

    def grant_retriever_segments(self, segment_ids: Iterable[str]) -> None:
        granted = {str(segment_id) for segment_id in segment_ids if segment_id}
        if not granted:
            return
        with self._lock:
            self._retriever_segment_ids.update(granted)

    def grant_upload_files(self, upload_file_ids: Iterable[str]) -> None:
        granted = {str(file_id) for file_id in upload_file_ids if file_id}
        if not granted:
            return
        with self._lock:
            self._upload_file_ids.update(granted)

    def is_retriever_segment_granted(self, segment_id: str) -> bool:
        with self._lock:
            return str(segment_id) in self._retriever_segment_ids

    def granted_upload_file_ids(self) -> frozenset[str]:
        with self._lock:
            return frozenset(self._upload_file_ids)
