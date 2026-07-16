from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="CreateKnowledgeSpaceRetrievalProfileReasoningModel")


@_attrs_define
class CreateKnowledgeSpaceRetrievalProfileReasoningModel:
    """
    Attributes:
        model (str):
        plugin_id (str):
        provider (str):
    """

    model: str
    plugin_id: str
    provider: str

    def to_dict(self) -> dict[str, Any]:
        model = self.model

        plugin_id = self.plugin_id

        provider = self.provider

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "model": model,
                "pluginId": plugin_id,
                "provider": provider,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        model = d.pop("model")

        plugin_id = d.pop("pluginId")

        provider = d.pop("provider")

        create_knowledge_space_retrieval_profile_reasoning_model = cls(
            model=model,
            plugin_id=plugin_id,
            provider=provider,
        )

        return create_knowledge_space_retrieval_profile_reasoning_model
