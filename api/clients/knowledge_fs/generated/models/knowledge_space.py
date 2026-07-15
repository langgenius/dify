from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="KnowledgeSpace")


@_attrs_define
class KnowledgeSpace:
    """
    Attributes:
        created_at (datetime.datetime):
        id (str):
        name (str):
        slug (str):
        tenant_id (str):
        updated_at (datetime.datetime):
        description (str | Unset):
    """

    created_at: datetime.datetime
    id: str
    name: str
    slug: str
    tenant_id: str
    updated_at: datetime.datetime
    description: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        created_at = self.created_at.isoformat()

        id = self.id

        name = self.name

        slug = self.slug

        tenant_id = self.tenant_id

        updated_at = self.updated_at.isoformat()

        description = self.description

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "createdAt": created_at,
                "id": id,
                "name": name,
                "slug": slug,
                "tenantId": tenant_id,
                "updatedAt": updated_at,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        tenant_id = d.pop("tenantId")

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        description = d.pop("description", UNSET)

        knowledge_space = cls(
            created_at=created_at,
            id=id,
            name=name,
            slug=slug,
            tenant_id=tenant_id,
            updated_at=updated_at,
            description=description,
        )

        knowledge_space.additional_properties = d
        return knowledge_space

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
