from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.create_knowledge_space_retrieval_profile_default_mode import (
    CreateKnowledgeSpaceRetrievalProfileDefaultMode,
)

if TYPE_CHECKING:
    from ..models.create_knowledge_space_retrieval_profile_reasoning_model import (
        CreateKnowledgeSpaceRetrievalProfileReasoningModel,
    )
    from ..models.create_knowledge_space_retrieval_profile_rerank import (
        CreateKnowledgeSpaceRetrievalProfileRerank,
    )
    from ..models.create_knowledge_space_retrieval_profile_score_threshold import (
        CreateKnowledgeSpaceRetrievalProfileScoreThreshold,
    )


T = TypeVar("T", bound="CreateKnowledgeSpaceRetrievalProfile")


@_attrs_define
class CreateKnowledgeSpaceRetrievalProfile:
    """
    Attributes:
        default_mode (CreateKnowledgeSpaceRetrievalProfileDefaultMode):
        reasoning_model (CreateKnowledgeSpaceRetrievalProfileReasoningModel):
        rerank (CreateKnowledgeSpaceRetrievalProfileRerank):
        score_threshold (CreateKnowledgeSpaceRetrievalProfileScoreThreshold):
        top_k (int):
    """

    default_mode: CreateKnowledgeSpaceRetrievalProfileDefaultMode
    reasoning_model: CreateKnowledgeSpaceRetrievalProfileReasoningModel
    rerank: CreateKnowledgeSpaceRetrievalProfileRerank
    score_threshold: CreateKnowledgeSpaceRetrievalProfileScoreThreshold
    top_k: int

    def to_dict(self) -> dict[str, Any]:
        default_mode = self.default_mode.value

        reasoning_model = self.reasoning_model.to_dict()

        rerank = self.rerank.to_dict()

        score_threshold = self.score_threshold.to_dict()

        top_k = self.top_k

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "defaultMode": default_mode,
                "reasoningModel": reasoning_model,
                "rerank": rerank,
                "scoreThreshold": score_threshold,
                "topK": top_k,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_knowledge_space_retrieval_profile_reasoning_model import (
            CreateKnowledgeSpaceRetrievalProfileReasoningModel,
        )
        from ..models.create_knowledge_space_retrieval_profile_rerank import (
            CreateKnowledgeSpaceRetrievalProfileRerank,
        )
        from ..models.create_knowledge_space_retrieval_profile_score_threshold import (
            CreateKnowledgeSpaceRetrievalProfileScoreThreshold,
        )

        d = dict(src_dict)
        default_mode = CreateKnowledgeSpaceRetrievalProfileDefaultMode(
            d.pop("defaultMode")
        )

        reasoning_model = CreateKnowledgeSpaceRetrievalProfileReasoningModel.from_dict(
            d.pop("reasoningModel")
        )

        rerank = CreateKnowledgeSpaceRetrievalProfileRerank.from_dict(d.pop("rerank"))

        score_threshold = CreateKnowledgeSpaceRetrievalProfileScoreThreshold.from_dict(
            d.pop("scoreThreshold")
        )

        top_k = d.pop("topK")

        create_knowledge_space_retrieval_profile = cls(
            default_mode=default_mode,
            reasoning_model=reasoning_model,
            rerank=rerank,
            score_threshold=score_threshold,
            top_k=top_k,
        )

        return create_knowledge_space_retrieval_profile
