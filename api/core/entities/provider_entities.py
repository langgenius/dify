from enum import Enum
from typing import Optional

from core.model_runtime.entities.model_entities import ModelType
from models.provider import ProviderQuotaType
from pydantic import BaseModel


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


class CustomConfiguration(BaseModel):
    """
    Model class for provider custom configuration.
    """
    provider: Optional[CustomProviderConfiguration] = None
    models: list[CustomModelConfiguration] = []
