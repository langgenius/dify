from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict

from core.model_runtime.entities.model_entities import ModelType
from models.provider import ProviderQuotaType


class QuotaUnit(Enum):
    TIMES = 'times'
    TOKENS = 'tokens'
    CREDITS = 'credits'


class SystemConfigurationStatus(Enum):
    """
    Enum class for system configuration status.
    """
    ACTIVE = 'active'
    QUOTA_EXCEEDED = 'quota-exceeded'
    UNSUPPORTED = 'unsupported'


class RestrictModel(BaseModel):
    model: str
    base_model_name: Optional[str] = None
    model_type: ModelType

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())


class QuotaConfiguration(BaseModel):
    """
    Model class for provider quota configuration.
    """
    quota_type: ProviderQuotaType
    quota_unit: QuotaUnit
    quota_limit: int
    quota_used: int
    is_valid: bool
    restrict_models: list[RestrictModel] = []


class SystemConfiguration(BaseModel):
    """
    Model class for provider system configuration.
    """
    enabled: bool
    current_quota_type: Optional[ProviderQuotaType] = None
    quota_configurations: list[QuotaConfiguration] = []
    credentials: Optional[dict] = None


class CustomProviderConfiguration(BaseModel):
    """
    Model class for provider custom configuration.
    """
    credentials: dict


class CustomModelConfiguration(BaseModel):
    """
    Model class for provider custom model configuration.
    """
    model: str
    model_type: ModelType
    credentials: dict

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())


class CustomConfiguration(BaseModel):
    """
    Model class for provider custom configuration.
    """
    provider: Optional[CustomProviderConfiguration] = None
    models: list[CustomModelConfiguration] = []


class ModelLoadBalancingConfiguration(BaseModel):
    """
    Class for model load balancing configuration.
    """
    id: str
    name: str
    credentials: dict


class ModelSettings(BaseModel):
    """
    Model class for model settings.
    """
    model: str
    model_type: ModelType
    enabled: bool = True
    load_balancing_configs: list[ModelLoadBalancingConfiguration] = []

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())
