from enum import StrEnum
from typing import Literal, Self

from pydantic import AliasChoices, BaseModel, Field, model_validator


class ParentMode(StrEnum):
    FULL_DOC = "full-doc"
    PARAGRAPH = "paragraph"


type PreProcessingRuleKey = Literal["remove_stopwords", "remove_extra_spaces", "remove_urls_emails"]


class PreProcessingRule(BaseModel):
    id: PreProcessingRuleKey = Field(description="Rule identifier.")
    enabled: bool = Field(description="Whether this preprocessing rule is enabled.")


class Segmentation(BaseModel):
    # TODO: there are internally mismatched / inconsistent naming
    # between `separator` and `delimiter` across the codebase.
    # Taking `separator` as the canonical.
    separator: str = Field(
        default="\n",
        description="Custom separator for splitting text.",
        validation_alias=AliasChoices("separator", "delimiter"),
    )
    max_tokens: int = Field(ge=0, description="Maximum token count per chunk.")
    chunk_overlap: int = Field(default=0, ge=0, description="Token overlap between chunks.")

    @model_validator(mode="after")
    def validate_overlap(self) -> Self:
        if self.max_tokens > 0 and self.chunk_overlap >= self.max_tokens:
            raise ValueError("chunk_overlap must be less than max_tokens.")
        return self


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

    @model_validator(mode="after")
    def validate_segmentation_bounds(self) -> Self:
        if self.segmentation is not None and self.parent_mode != ParentMode.FULL_DOC:
            if self.segmentation.max_tokens <= 0:
                raise ValueError("segmentation.max_tokens must be greater than 0.")
        if self.subchunk_segmentation is not None and self.subchunk_segmentation.max_tokens <= 0:
            raise ValueError("subchunk_segmentation.max_tokens must be greater than 0.")
        return self
