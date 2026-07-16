from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_knowledge_space_embedding_profile import (
        CreateKnowledgeSpaceEmbeddingProfile,
    )
    from ..models.create_knowledge_space_retrieval_profile import (
        CreateKnowledgeSpaceRetrievalProfile,
    )


T = TypeVar("T", bound="CreateKnowledgeSpace")


@_attrs_define
class CreateKnowledgeSpace:
    """
    Attributes:
        name (str):
        description (str | Unset):
        embedding_profile (CreateKnowledgeSpaceEmbeddingProfile | Unset):
        icon_ref (str | Unset):
        idempotency_key (str | Unset):
        retrieval_profile (CreateKnowledgeSpaceRetrievalProfile | Unset):
        slug (str | Unset):
    """

    name: str
    description: str | Unset = UNSET
    embedding_profile: CreateKnowledgeSpaceEmbeddingProfile | Unset = UNSET
    icon_ref: str | Unset = UNSET
    idempotency_key: str | Unset = UNSET
    retrieval_profile: CreateKnowledgeSpaceRetrievalProfile | Unset = UNSET
    slug: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description = self.description

        embedding_profile: dict[str, Any] | Unset = UNSET
        if not isinstance(self.embedding_profile, Unset):
            embedding_profile = self.embedding_profile.to_dict()

        icon_ref = self.icon_ref

        idempotency_key = self.idempotency_key

        retrieval_profile: dict[str, Any] | Unset = UNSET
        if not isinstance(self.retrieval_profile, Unset):
            retrieval_profile = self.retrieval_profile.to_dict()

        slug = self.slug

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if embedding_profile is not UNSET:
            field_dict["embeddingProfile"] = embedding_profile
        if icon_ref is not UNSET:
            field_dict["iconRef"] = icon_ref
        if idempotency_key is not UNSET:
            field_dict["idempotencyKey"] = idempotency_key
        if retrieval_profile is not UNSET:
            field_dict["retrievalProfile"] = retrieval_profile
        if slug is not UNSET:
            field_dict["slug"] = slug

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_knowledge_space_embedding_profile import (
            CreateKnowledgeSpaceEmbeddingProfile,
        )
        from ..models.create_knowledge_space_retrieval_profile import (
            CreateKnowledgeSpaceRetrievalProfile,
        )

        d = dict(src_dict)
        name = d.pop("name")

        description = d.pop("description", UNSET)

        _embedding_profile = d.pop("embeddingProfile", UNSET)
        embedding_profile: CreateKnowledgeSpaceEmbeddingProfile | Unset
        if isinstance(_embedding_profile, Unset):
            embedding_profile = UNSET
        else:
            embedding_profile = CreateKnowledgeSpaceEmbeddingProfile.from_dict(
                _embedding_profile
            )

        icon_ref = d.pop("iconRef", UNSET)

        idempotency_key = d.pop("idempotencyKey", UNSET)

        _retrieval_profile = d.pop("retrievalProfile", UNSET)
        retrieval_profile: CreateKnowledgeSpaceRetrievalProfile | Unset
        if isinstance(_retrieval_profile, Unset):
            retrieval_profile = UNSET
        else:
            retrieval_profile = CreateKnowledgeSpaceRetrievalProfile.from_dict(
                _retrieval_profile
            )

        slug = d.pop("slug", UNSET)

        create_knowledge_space = cls(
            name=name,
            description=description,
            embedding_profile=embedding_profile,
            icon_ref=icon_ref,
            idempotency_key=idempotency_key,
            retrieval_profile=retrieval_profile,
            slug=slug,
        )

        return create_knowledge_space
