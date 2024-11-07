from __future__ import annotations

from pydantic import BaseModel
from .document_request_process_rule import DocumentRequestProcessRule


class UpdateDocumentByFileRequestBody(BaseModel):
    name: str | None = None
    process_rule: str | None = None

    @staticmethod
    def builder() -> UpdateDocumentByFileRequestBodyBuilder:
        return UpdateDocumentByFileRequestBodyBuilder()


class UpdateDocumentByFileRequestBodyBuilder(object):
    def __init__(self):
        self._update_document_by_file_request_body = UpdateDocumentByFileRequestBody()

    def build(self) -> UpdateDocumentByFileRequestBody:
        return self._update_document_by_file_request_body

    def name(self, name: str) -> UpdateDocumentByFileRequestBodyBuilder:
        self._update_document_by_file_request_body.name = name
        return self

    def process_rule(
        self, process_rule: DocumentRequestProcessRule
    ) -> UpdateDocumentByFileRequestBodyBuilder:
        self._update_document_by_file_request_body.process_rule = (
            process_rule.model_dump_json(exclude_none=True)
        )
        return self
