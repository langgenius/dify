from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.create_knowledge_space_response_400_type_0_code import (
    CreateKnowledgeSpaceResponse400Type0Code,
)
from ..models.create_knowledge_space_response_400_type_0_error import (
    CreateKnowledgeSpaceResponse400Type0Error,
)
from ..models.create_knowledge_space_response_400_type_0_mode import (
    CreateKnowledgeSpaceResponse400Type0Mode,
)

T = TypeVar("T", bound="CreateKnowledgeSpaceResponse400Type0")


@_attrs_define
class CreateKnowledgeSpaceResponse400Type0:
    """
    Attributes:
        code (CreateKnowledgeSpaceResponse400Type0Code):
        error (CreateKnowledgeSpaceResponse400Type0Error):
        mode (CreateKnowledgeSpaceResponse400Type0Mode):
    """

    code: CreateKnowledgeSpaceResponse400Type0Code
    error: CreateKnowledgeSpaceResponse400Type0Error
    mode: CreateKnowledgeSpaceResponse400Type0Mode

    def to_dict(self) -> dict[str, Any]:
        code = self.code.value

        error = self.error.value

        mode = self.mode.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "code": code,
                "error": error,
                "mode": mode,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        code = CreateKnowledgeSpaceResponse400Type0Code(d.pop("code"))

        error = CreateKnowledgeSpaceResponse400Type0Error(d.pop("error"))

        mode = CreateKnowledgeSpaceResponse400Type0Mode(d.pop("mode"))

        create_knowledge_space_response_400_type_0 = cls(
            code=code,
            error=error,
            mode=mode,
        )

        return create_knowledge_space_response_400_type_0
