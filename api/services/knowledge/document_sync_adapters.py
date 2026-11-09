"""Infrastructure adapters for document-sync requests."""

from collections.abc import Callable


class CeleryDocumentSyncDispatcher:
    def __init__(self, *, delay: Callable[[str, str], object]) -> None:
        self._delay = delay

    def dispatch(self, *, dataset_id: str, document_id: str) -> None:
        self._delay(dataset_id, document_id)
