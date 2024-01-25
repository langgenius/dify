from enum import Enum


class IndexType(Enum):
    PARAGRAPH_INDEX = "paragraph_index"
    QA_INDEX = "qa_index"
    PARENT_CHILD_INDEX = "parent_child_index"
    SUMMARY_INDEX = "summary_index"
