from typing import Protocol


class SummaryIndexServiceProtocol(Protocol):
    def generate_and_vectorize_summary(
        self, dataset_id: str, document_id: str, is_preview: bool, summary_index_setting: dict | None = None
    ): ...
