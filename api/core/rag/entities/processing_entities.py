from enum import StrEnum
from typing import Literal

from pydantic import BaseModel


class ParentMode(StrEnum):
    FULL_DOC = "full-doc"
    PARAGRAPH = "paragraph"


class PreProcessingRule(BaseModel):
    id: str
    enabled: bool


class Segmentation(BaseModel):
    separator: str = "\n"
    max_tokens: int
    chunk_overlap: int = 0


class Rule(BaseModel):
    pre_processing_rules: list[PreProcessingRule] | None = None
    segmentation: Segmentation | None = None
    parent_mode: Literal["full-doc", "paragraph"] | None = None
    subchunk_segmentation: Segmentation | None = None
