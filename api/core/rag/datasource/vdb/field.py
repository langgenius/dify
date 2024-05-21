from enum import Enum


class Field(Enum):
    CONTENT_KEY = "page_content"
    METADATA_KEY = "metadata"
    GROUP_KEY = "group_id"
    VECTOR = "vector"
    TEXT_KEY = "text"
    PRIMARY_KEY = "id"
    BM25_KEY = "bm25_ef"
