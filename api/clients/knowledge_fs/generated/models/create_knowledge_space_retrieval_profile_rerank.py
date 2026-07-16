from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_knowledge_space_retrieval_profile_rerank_model import (
        CreateKnowledgeSpaceRetrievalProfileRerankModel,
    )


T = TypeVar("T", bound="CreateKnowledgeSpaceRetrievalProfileRerank")


@_attrs_define
class CreateKnowledgeSpaceRetrievalProfileRerank:
    """
    Attributes:
        enabled (bool):
        model (CreateKnowledgeSpaceRetrievalProfileRerankModel | Unset):
    """

    enabled: bool
    model: CreateKnowledgeSpaceRetrievalProfileRerankModel | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        enabled = self.enabled

        model: dict[str, Any] | Unset = UNSET
        if not isinstance(self.model, Unset):
            model = self.model.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "enabled": enabled,
            }
        )
        if model is not UNSET:
            field_dict["model"] = model

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_knowledge_space_retrieval_profile_rerank_model import (
            CreateKnowledgeSpaceRetrievalProfileRerankModel,
        )

        d = dict(src_dict)
        enabled = d.pop("enabled")

        _model = d.pop("model", UNSET)
        model: CreateKnowledgeSpaceRetrievalProfileRerankModel | Unset
        if isinstance(_model, Unset):
            model = UNSET
        else:
            model = CreateKnowledgeSpaceRetrievalProfileRerankModel.from_dict(_model)

        create_knowledge_space_retrieval_profile_rerank = cls(
            enabled=enabled,
            model=model,
        )

        return create_knowledge_space_retrieval_profile_rerank
