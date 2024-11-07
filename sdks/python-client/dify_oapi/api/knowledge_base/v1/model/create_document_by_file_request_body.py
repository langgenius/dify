from __future__ import annotations


from pydantic import BaseModel
from .create_document_by_file_request_body_data import (
    CreateDocumentByTextRequestBodyData,
)


class CreateDocumentByFileRequestBody(BaseModel):
    data: str | None = None

    @staticmethod
    def builder() -> CreateDocumentByFileRequestBodyBuilder:
        return CreateDocumentByFileRequestBodyBuilder()


class CreateDocumentByFileRequestBodyBuilder(object):
    def __init__(self):
        create_document_by_file_request_body = CreateDocumentByFileRequestBody()
        self._create_document_by_file_request_body = (
            create_document_by_file_request_body
        )

    def build(self) -> CreateDocumentByFileRequestBody:
        return self._create_document_by_file_request_body

    def data(
        self, data: CreateDocumentByTextRequestBodyData
    ) -> CreateDocumentByFileRequestBodyBuilder:
        self._create_document_by_file_request_body.data = data.model_dump_json(
            exclude_none=True
        )
        return self
