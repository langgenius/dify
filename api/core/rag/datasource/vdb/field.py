from enum import StrEnum, auto


class Field(StrEnum):
    CONTENT_KEY = "page_content"
    METADATA_KEY = "metadata"
    GROUP_KEY = "group_id"
    VECTOR = auto()
    # Sparse Vector aims to support full text search
    SPARSE_VECTOR = auto()
    TEXT_KEY = "text"
    PRIMARY_KEY = "id"
    DOC_ID = "metadata.doc_id"
    DOCUMENT_ID = "metadata.document_id"
