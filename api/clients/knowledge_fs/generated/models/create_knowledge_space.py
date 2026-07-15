from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateKnowledgeSpace")


@_attrs_define
class CreateKnowledgeSpace:
    """
    Attributes:
        name (str):
        slug (str):
        description (str | Unset):
    """

    name: str
    slug: str
    description: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        slug = self.slug

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "slug": slug,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        slug = d.pop("slug")

        description = d.pop("description", UNSET)

        create_knowledge_space = cls(
            name=name,
            slug=slug,
            description=description,
        )

        return create_knowledge_space
