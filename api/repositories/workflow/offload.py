"""Upload capability consumed by workflow payload persistence."""

from typing import Protocol

from models.model import UploadFile


class WorkflowOffloadUploader(Protocol):
    def __call__(self, *, filename: str, content: bytes) -> UploadFile: ...
