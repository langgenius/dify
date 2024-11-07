from __future__ import annotations

from typing import Literal

from pydantic import BaseModel
from .document_request_process_rule import DocumentRequestProcessRule


class CreateDocumentByTextRequestBody(BaseModel):
    name: str | None = None
    text: str | None = None
    indexing_technique: str | None = None
    process_rule: DocumentRequestProcessRule | None = None

    @staticmethod
    def builder() -> CreateDocumentByTextRequestBodyBuilder:
        return CreateDocumentByTextRequestBodyBuilder()


class CreateDocumentByTextRequestBodyBuilder(object):
    def __init__(self):
        create_document_by_text_request_body = CreateDocumentByTextRequestBody()
        self._create_document_by_text_request_body = (
            create_document_by_text_request_body
        )

    def build(self) -> CreateDocumentByTextRequestBody:
        return self._create_document_by_text_request_body

    def name(self, name: str) -> CreateDocumentByTextRequestBodyBuilder:
        self._create_document_by_text_request_body.name = name
        return self

    def text(self, text: str) -> CreateDocumentByTextRequestBodyBuilder:
        self._create_document_by_text_request_body.text = text
        return self

    def indexing_technique(
        self, indexing_technique: Literal["high_quality", "economy"]
    ) -> CreateDocumentByTextRequestBodyBuilder:
        self._create_document_by_text_request_body.indexing_technique = (
            indexing_technique
        )
        return self

    def process_rule(
        self, process_rule: DocumentRequestProcessRule
    ) -> CreateDocumentByTextRequestBodyBuilder:
        self._create_document_by_text_request_body.process_rule = process_rule
        return self
