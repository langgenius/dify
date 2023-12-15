from enum import Enum

from core.model_runtime.entities.model_entities import ProviderModel
from core.model_runtime.entities.provider_entities import SimpleProviderEntity


class ModelStatus(Enum):
    """
    Enum class for model status.
    """
    ACTIVE = "active"
    NO_CONFIGURE = "no-configure"
    QUOTA_EXCEEDED = "quota-exceeded"
    NO_PERMISSION = "no-permission"


class ModelWithProviderEntity(ProviderModel):
    """
    Model with provider entity.
    """
    provider: SimpleProviderEntity
    status: ModelStatus
