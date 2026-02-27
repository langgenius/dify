from collections.abc import Sequence
from enum import StrEnum, auto

from pydantic import BaseModel, ConfigDict

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import ModelType, ProviderModel
from core.model_runtime.entities.provider_entities import ProviderEntity


class ModelStatus(StrEnum):
    """
    Enum class for model status.
    """

    ACTIVE = auto()
    NO_CONFIGURE = "no-configure"
    QUOTA_EXCEEDED = "quota-exceeded"
    NO_PERMISSION = "no-permission"
    DISABLED = auto()
    CREDENTIAL_REMOVED = "credential-removed"


class SimpleModelProviderEntity(BaseModel):
    """
    Simple provider.
    """

    provider: str
    label: I18nObject
    icon_small: I18nObject | None = None
    icon_small_dark: I18nObject | None = None
    supported_model_types: list[ModelType]

    def __init__(self, provider_entity: ProviderEntity):
        """
        Init simple provider.

        :param provider_entity: provider entity
        """
        super().__init__(
            provider=provider_entity.provider,
            label=provider_entity.label,
            icon_small=provider_entity.icon_small,
            icon_small_dark=provider_entity.icon_small_dark,
            supported_model_types=provider_entity.supported_model_types,
        )


class ProviderModelWithStatusEntity(ProviderModel):
    """
    Model class for model response.
    """

    status: ModelStatus
    load_balancing_enabled: bool = False
    has_invalid_load_balancing_configs: bool = False

    def raise_for_status(self):
        """
        Check model status and raise ValueError if not active.

        :raises ValueError: When model status is not active, with a descriptive message
        """
        if self.status == ModelStatus.ACTIVE:
            return

        error_messages = {
            ModelStatus.NO_CONFIGURE: "Model is not configured",
            ModelStatus.QUOTA_EXCEEDED: "Model quota has been exceeded",
            ModelStatus.NO_PERMISSION: "No permission to use this model",
            ModelStatus.DISABLED: "Model is disabled",
        }

        if self.status in error_messages:
            raise ValueError(error_messages[self.status])


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
    icon_small: I18nObject | None = None
    supported_model_types: Sequence[ModelType] = []


class DefaultModelEntity(BaseModel):
    """
    Default model entity.
    """

    model: str
    model_type: ModelType
    provider: DefaultModelProviderEntity

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())
