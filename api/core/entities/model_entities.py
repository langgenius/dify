from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import ModelType, ProviderModel
from core.model_runtime.entities.provider_entities import ProviderEntity


class ModelStatus(Enum):
    """
    Enum class for model status.
    """

    ACTIVE = "active"
    NO_CONFIGURE = "no-configure"
    QUOTA_EXCEEDED = "quota-exceeded"
    NO_PERMISSION = "no-permission"
    DISABLED = "disabled"


class SimpleModelProviderEntity(BaseModel):
    """
    Simple provider.
    """

    provider: str
    label: I18nObject
    icon_small: Optional[I18nObject] = None
    icon_large: Optional[I18nObject] = None
    supported_model_types: list[ModelType]

    def __init__(self, provider_entity: ProviderEntity) -> None:
        """
        Init simple provider.

        :param provider_entity: provider entity
        """
        super().__init__(
            provider=provider_entity.provider,
            label=provider_entity.label,
            icon_small=provider_entity.icon_small,
            icon_large=provider_entity.icon_large,
            supported_model_types=provider_entity.supported_model_types,
        )


class ProviderModelWithStatusEntity(ProviderModel):
    """
    Model class for model response.
    """

    status: ModelStatus
    load_balancing_enabled: bool = False


class ModelWithProviderEntity(ProviderModelWithStatusEntity):
    """
    Model with provider entity.
    """

    provider: SimpleModelProviderEntity


class DefaultModelProviderEntity(BaseModel):
    """
    Default model provider entity.
    """

    provider: str
    label: I18nObject
    icon_small: Optional[I18nObject] = None
    icon_large: Optional[I18nObject] = None
    supported_model_types: list[ModelType]


class DefaultModelEntity(BaseModel):
    """
    Default model entity.
    """

    model: str
    model_type: ModelType
    provider: DefaultModelProviderEntity

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())
