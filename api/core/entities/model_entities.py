from enum import Enum
from typing import Optional

from pydantic import BaseModel

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import ProviderModel, ModelType
from core.model_runtime.entities.provider_entities import SimpleProviderEntity


class ModelStatus(Enum):
    """
    Enum class for model status.
    """
    ACTIVE = "active"
    NO_CONFIGURE = "no-configure"
    QUOTA_EXCEEDED = "quota-exceeded"
    NO_PERMISSION = "no-permission"


class SimpleModelProviderEntity(BaseModel):
    """
    Simple provider.
    """
    provider: str
    label: I18nObject
    icon_small: Optional[I18nObject] = None
    icon_large: Optional[I18nObject] = None
    supported_model_types: list[ModelType]


class ModelWithProviderEntity(ProviderModel):
    """
    Model with provider entity.
    """
    provider: SimpleProviderEntity
    status: ModelStatus


class DefaultModelEntity(BaseModel):
    """
    Default model entity.
    """
    model: str
    model_type: ModelType
    provider: SimpleProviderEntity
