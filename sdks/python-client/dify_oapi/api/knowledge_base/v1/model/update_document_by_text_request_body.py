from __future__ import annotations


from pydantic import BaseModel
from .document_request_process_rule import DocumentRequestProcessRule


class UpdateDocumentByTextRequestBody(BaseModel):
    name: str | None = None
    text: str | None = None
    process_rule: DocumentRequestProcessRule | None = None

    @staticmethod
    def builder() -> UpdateDocumentByTextRequestBodyBuilder:
        return UpdateDocumentByTextRequestBodyBuilder()


class UpdateDocumentByTextRequestBodyBuilder(object):
    def __init__(self):
        self._update_document_by_text_request_body = UpdateDocumentByTextRequestBody()

    def build(self) -> UpdateDocumentByTextRequestBody:
        return self._update_document_by_text_request_body

    def name(self, name: str) -> UpdateDocumentByTextRequestBodyBuilder:
        self._update_document_by_text_request_body.name = name
        return self

    def text(self, text: str) -> UpdateDocumentByTextRequestBodyBuilder:
        self._update_document_by_text_request_body.text = text
        return self

    def process_rule(
        self, process_rule: DocumentRequestProcessRule
    ) -> UpdateDocumentByTextRequestBodyBuilder:
        self._update_document_by_text_request_body.process_rule = process_rule
        return self
