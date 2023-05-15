# -*- coding:utf-8 -*-
from libs.exception import BaseHTTPException


class ArchivedDocumentImmutableError(BaseHTTPException):
    error_code = 'archived_document_immutable'
    description = "Cannot operate when document was archived."
    code = 403


class DocumentIndexingError(BaseHTTPException):
    error_code = 'document_indexing'
    description = "Cannot operate document during indexing."
    code = 403


class DatasetNotInitedError(BaseHTTPException):
    error_code = 'dataset_not_inited'
    description = "Dataset not inited."
    code = 403
