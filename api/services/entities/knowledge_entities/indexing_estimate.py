"""Commands and validation shared by knowledge indexing-estimate use cases."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from core.rag.entities.processing_entities import PreProcessingRuleKey
from services.entities.knowledge_entities.records import DatasetRecord, DocumentRecord


class EstimateValidationError(ValueError):
    """Raised when an estimate process rule is invalid."""


class _PreProcessingRule(BaseModel):
    id: PreProcessingRuleKey
    enabled: bool


class _Segmentation(BaseModel):
    separator: str = Field(min_length=1)
    max_tokens: int = Field(gt=0)


class _Rules(BaseModel):
    pre_processing_rules: list[_PreProcessingRule]
    segmentation: _Segmentation

    @field_validator("pre_processing_rules")
    @classmethod
    def _deduplicate(cls, value: list[_PreProcessingRule]) -> list[_PreProcessingRule]:
        by_id = {rule.id: rule for rule in value}
        return list(by_id.values())


class _HierarchicalRules(_Rules):
    parent_mode: Literal["full-doc", "paragraph"] | None = None
    subchunk_segmentation: _Segmentation | None = None


class _SummaryIndexSettingDisabled(BaseModel):
    enable: Literal[False] = False


class _SummaryIndexSettingEnabled(BaseModel):
    enable: Literal[True]
    model_name: str = Field(min_length=1)
    model_provider_name: str = Field(min_length=1)


_SummaryIndexSetting = Annotated[
    _SummaryIndexSettingDisabled | _SummaryIndexSettingEnabled,
    Field(discriminator="enable"),
]


class _ProcessRuleBase(BaseModel):
    model_config = ConfigDict(extra="allow")

    summary_index_setting: _SummaryIndexSetting | None = None

    @field_validator("summary_index_setting", mode="before")
    @classmethod
    def _normalize_summary_index_setting(cls, value: object) -> object:
        """Treat mappings with a missing/None enable flag as absent (#36602)."""

        if value is None:
            return None
        if isinstance(value, Mapping) and value.get("enable") is None:
            return None
        return value


class _AutomaticProcessRule(_ProcessRuleBase):
    mode: Literal["automatic"]


class _CustomProcessRule(_ProcessRuleBase):
    mode: Literal["custom"]
    rules: _Rules


class _HierarchicalProcessRule(_ProcessRuleBase):
    mode: Literal["hierarchical"]
    rules: _HierarchicalRules


_ProcessRule = Annotated[
    _AutomaticProcessRule | _CustomProcessRule | _HierarchicalProcessRule,
    Field(discriminator="mode"),
]


class _EstimateArgs(BaseModel):
    info_list: dict[str, object]
    process_rule: _ProcessRule


class _ProcessRuleEnvelope(BaseModel):
    process_rule: _ProcessRule


def _validation_message(error: ValidationError) -> str:
    first = error.errors()[0]
    original = first.get("ctx", {}).get("error")
    return str(original) if isinstance(original, ValueError) else str(first["msg"])


def normalize_process_rule(process_rule: Mapping[str, object]) -> dict[str, object]:
    """Validate and normalize a process rule without mutating caller-owned input."""

    try:
        validated = _ProcessRuleEnvelope.model_validate({"process_rule": process_rule})
    except ValidationError as error:
        raise EstimateValidationError(_validation_message(error)) from error

    result = validated.process_rule.model_dump(exclude_none=True)
    if validated.process_rule.mode == "automatic":
        result["rules"] = {}
    elif validated.process_rule.mode == "hierarchical":
        rules = result.get("rules")
        if isinstance(rules, dict) and not rules.get("parent_mode"):
            rules["parent_mode"] = "paragraph"
    return result


def normalize_indexing_estimate_args(args: Mapping[str, object]) -> dict[str, object]:
    """Compatibility validator for the existing generic estimate transport."""

    try:
        validated = _EstimateArgs.model_validate(args)
    except ValidationError as error:
        raise EstimateValidationError(_validation_message(error)) from error
    return normalize_process_rule(validated.process_rule.model_dump(exclude_none=True))


@dataclass(frozen=True, slots=True)
class UploadFileEstimateSource:
    file_id: str
    source_type: Literal["upload_file"] = field(default="upload_file", init=False)


@dataclass(frozen=True, slots=True)
class NotionEstimateSource:
    workspace_id: str
    page_id: str
    page_type: str
    credential_id: str
    source_type: Literal["notion_import"] = field(default="notion_import", init=False)


@dataclass(frozen=True, slots=True)
class WebsiteEstimateSource:
    provider: str
    job_id: str
    url: str
    mode: str = "crawl"
    only_main_content: bool = False
    source_type: Literal["website_crawl"] = field(default="website_crawl", init=False)


type NewEstimateSource = UploadFileEstimateSource | NotionEstimateSource | WebsiteEstimateSource


@dataclass(frozen=True, slots=True)
class NewSourcesEstimateCommand:
    sources: tuple[NewEstimateSource, ...]
    process_rule: Mapping[str, object]
    doc_form: str = "text_model"
    doc_language: str = "English"
    dataset_id: str | None = None
    indexing_technique: str = "economy"


@dataclass(frozen=True, slots=True)
class ExistingDocumentsEstimateCommand:
    dataset: DatasetRecord
    documents: tuple[DocumentRecord, ...]


type EstimateCommand = NewSourcesEstimateCommand | ExistingDocumentsEstimateCommand
