from enum import Enum
from typing import Optional

from pydantic import BaseModel

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.provider_entities import ProviderEntity


class ProviderType(Enum):
    CUSTOM = 'custom'
    SYSTEM = 'system'

    @classmethod
    def value_of(cls, value) -> "ProviderType":
        for member in ProviderType:
            if member.value == cls:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class QuotaUnit(Enum):
    TIMES = 'times'
    TOKENS = 'tokens'


class QuotaType(Enum):
    PAID = 'paid'
    """hosted paid quota"""

    FREE = 'free'
    """third-party free quota"""

    TRIAL = 'trial'
    """hosted trial quota"""

    @classmethod
    def value_of(cls, value) -> "QuotaType":
        for member in cls:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class SystemConfigurationStatus(Enum):
    """
    Enum class for system configuration status.
    """
    ACTIVE = 'active'
    QUOTA_EXCEEDED = 'quota-exceeded'
    UNSUPPORTED = 'unsupported'


class QuotaConfiguration(BaseModel):
    """
    Model class for provider quota configuration.
    """
    quota_type: QuotaType
    quota_unit: QuotaUnit
    quota_limit: int
    quota_used: int
    is_valid: bool


class SystemConfiguration(BaseModel):
    """
    Model class for provider system configuration.
    """
    enabled: bool
    current_quota_type: Optional[QuotaType] = None
    quota_configurations: list[QuotaConfiguration] = []
    credentials: Optional[dict] = None


class CustomModelConfiguration(BaseModel):
    """
    Model class for provider custom model configuration.
    """
    model: str
    model_type: ModelType
    credentials: Optional[dict] = None


class CustomConfiguration(BaseModel):
    """
    Model class for provider custom configuration.
    """
    enabled: bool
    credentials: Optional[dict] = None
    models: list[CustomModelConfiguration] = []
