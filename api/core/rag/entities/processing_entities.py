from enum import StrEnum
from typing import Annotated, Literal

from pydantic import AliasChoices, BaseModel, Field, WithJsonSchema


class ParentMode(StrEnum):
    FULL_DOC = "full-doc"
    PARAGRAPH = "paragraph"


PreProcessingRuleID = Annotated[
    str,
    WithJsonSchema(
        {
            "enum": ["remove_stopwords", "remove_extra_spaces", "remove_urls_emails"],
            "type": "string",
        }
    ),
]


class PreProcessingRule(BaseModel):
    id: PreProcessingRuleID = Field(description="Rule identifier.")
    enabled: bool = Field(description="Whether this preprocessing rule is enabled.")


class Segmentation(BaseModel):
    # TODO: there are internally mismatched / inconsistent naming
    # between `separator`` and `delimiter` across the codebase.
    # Taking `separator` as the canonical.
    separator: str = Field(
        default="\n",
        description="Custom separator for splitting text.",
        validation_alias=AliasChoices("separator", "delimiter"),
    )
    max_tokens: int = Field(description="Maximum token count per chunk.")
    chunk_overlap: int = Field(default=0, description="Token overlap between chunks.")


class Rule(BaseModel):
    pre_processing_rules: list[PreProcessingRule] | None = Field(
        default=None,
        description="Pre-processing rules to apply before segmentation.",
    )
    segmentation: Segmentation | None = Field(default=None, description="Parent chunk segmentation settings.")
    parent_mode: Literal["full-doc", "paragraph"] | None = Field(
        default=None,
        description="Parent-child segmentation mode.",
    )
    subchunk_segmentation: Segmentation | None = Field(
        default=None,
        description="Child chunk segmentation settings.",
    )
