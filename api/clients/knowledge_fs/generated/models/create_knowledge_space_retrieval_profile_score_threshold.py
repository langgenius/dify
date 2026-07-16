from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.create_knowledge_space_retrieval_profile_score_threshold_stage import (
    CreateKnowledgeSpaceRetrievalProfileScoreThresholdStage,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateKnowledgeSpaceRetrievalProfileScoreThreshold")


@_attrs_define
class CreateKnowledgeSpaceRetrievalProfileScoreThreshold:
    """
    Attributes:
        enabled (bool):
        stage (CreateKnowledgeSpaceRetrievalProfileScoreThresholdStage):
        value (float | Unset):
    """

    enabled: bool
    stage: CreateKnowledgeSpaceRetrievalProfileScoreThresholdStage
    value: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        enabled = self.enabled

        stage = self.stage.value

        value = self.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "enabled": enabled,
                "stage": stage,
            }
        )
        if value is not UNSET:
            field_dict["value"] = value

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        enabled = d.pop("enabled")

        stage = CreateKnowledgeSpaceRetrievalProfileScoreThresholdStage(d.pop("stage"))

        value = d.pop("value", UNSET)

        create_knowledge_space_retrieval_profile_score_threshold = cls(
            enabled=enabled,
            stage=stage,
            value=value,
        )

        return create_knowledge_space_retrieval_profile_score_threshold
