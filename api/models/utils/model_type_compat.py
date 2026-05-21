import sqlalchemy as sa
from sqlalchemy.orm import Mapped

from graphon.model_runtime.entities.model_entities import ModelType


def legacy_compatible_model_type_filter(column: Mapped[ModelType], model_type: ModelType | str):
    """
    Match both canonical and legacy persisted model_type values during reads.

    Graphon normalizes legacy values such as ``text-generation`` to
    ``ModelType.LLM``. Query paths therefore receive canonical enums while
    older rows may still store the original string value.
    """

    model_type_enum = model_type if isinstance(model_type, ModelType) else ModelType.value_of(model_type)
    legacy_model_type = model_type_enum.to_origin_model_type()

    if legacy_model_type == model_type_enum.value:
        return column == model_type_enum

    return sa.or_(
        column == model_type_enum,
        # rely on sa.type_coerce instead of sa.cast to ensure that we can
        # utilize indexes.
        sa.type_coerce(column, sa.String()) == legacy_model_type,
    )
