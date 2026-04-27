"""
SQLAlchemy column type for ModelType with legacy DB string compatibility.

Older installs stored embedding models as ``embeddings`` while :class:`ModelType`
uses ``text-embedding``. Plain :class:`~models.types.EnumText` maps only exact
enum ``.value`` strings, so loading legacy rows fails after switching to
``EnumText(ModelType)``. This type delegates to :meth:`ModelType.value_of`
instead, matching API/origin aliases (see graphon ``ModelType``).

See: https://github.com/langgenius/dify/issues/34365
"""

from __future__ import annotations

from graphon.model_runtime.entities.model_entities import ModelType
from sqlalchemy import Dialect

from .types import EnumText


class ModelTypeEnumText(EnumText[ModelType]):
    """Like :class:`~models.types.EnumText` but accepts legacy stored model-type strings."""

    def __init__(self, length: int | None = None):
        super().__init__(ModelType, length=length)

    def process_bind_param(self, value: ModelType | str | None, dialect: Dialect) -> str | None:
        if value is None:
            return None
        if isinstance(value, ModelType):
            return value.value
        return ModelType.value_of(value).value

    def process_result_value(self, value: str | None, dialect: Dialect) -> ModelType | None:
        if value is None:
            return None
        return ModelType.value_of(value)
