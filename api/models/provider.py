from enum import Enum

from sqlalchemy import func

from models.base import Base

from .engine import db
from .types import StringUUID


class ProviderType(Enum):
    CUSTOM = "custom"
    SYSTEM = "system"

    @staticmethod
    def value_of(value):
        for member in ProviderType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class ProviderQuotaType(Enum):
    PAID = "paid"
    """hosted paid quota"""

    FREE = "free"
    """third-party free quota"""

    TRIAL = "trial"
    """hosted trial quota"""

    @staticmethod
    def value_of(value):
        for member in ProviderQuotaType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class Provider(Base):
    """
    Provider model representing the API providers and their configurations.
    """

    __tablename__ = "providers"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="provider_pkey"),
        db.Index("provider_tenant_id_provider_idx", "tenant_id", "provider_name"),
        db.UniqueConstraint(
            "tenant_id", "provider_name", "provider_type", "quota_type", name="unique_provider_name_type_quota"
        ),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider_name = db.Column(db.String(255), nullable=False)
    provider_type = db.Column(db.String(40), nullable=False, server_default=db.text("'custom'::character varying"))
    encrypted_config = db.Column(db.Text, nullable=True)
    is_valid = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    last_used = db.Column(db.DateTime, nullable=True)

    quota_type = db.Column(db.String(40), nullable=True, server_default=db.text("''::character varying"))
    quota_limit = db.Column(db.BigInteger, nullable=True)
    quota_used = db.Column(db.BigInteger, default=0)

    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    def __repr__(self):
        return (
            f"<Provider(id={self.id}, tenant_id={self.tenant_id}, provider_name='{self.provider_name}',"
            f" provider_type='{self.provider_type}')>"
        )

    @property
    def token_is_set(self):
        """
        Returns True if the encrypted_config is not None, indicating that the token is set.
        """
        return self.encrypted_config is not None

    @property
    def is_enabled(self):
        """
        Returns True if the provider is enabled.
        """
        if self.provider_type == ProviderType.SYSTEM.value:
            return self.is_valid
        else:
            return self.is_valid and self.token_is_set


class ProviderModel(Base):
    """
    Provider model representing the API provider_models and their configurations.
    """

    __tablename__ = "provider_models"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="provider_model_pkey"),
        db.Index("provider_model_tenant_id_provider_idx", "tenant_id", "provider_name"),
        db.UniqueConstraint(
            "tenant_id", "provider_name", "model_name", "model_type", name="unique_provider_model_name"
        ),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider_name = db.Column(db.String(255), nullable=False)
    model_name = db.Column(db.String(255), nullable=False)
    model_type = db.Column(db.String(40), nullable=False)
    encrypted_config = db.Column(db.Text, nullable=True)
    is_valid = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


class TenantDefaultModel(Base):
    __tablename__ = "tenant_default_models"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="tenant_default_model_pkey"),
        db.Index("tenant_default_model_tenant_id_provider_type_idx", "tenant_id", "provider_name", "model_type"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider_name = db.Column(db.String(255), nullable=False)
    model_name = db.Column(db.String(255), nullable=False)
    model_type = db.Column(db.String(40), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


class TenantPreferredModelProvider(Base):
    __tablename__ = "tenant_preferred_model_providers"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="tenant_preferred_model_provider_pkey"),
        db.Index("tenant_preferred_model_provider_tenant_provider_idx", "tenant_id", "provider_name"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider_name = db.Column(db.String(255), nullable=False)
    preferred_provider_type = db.Column(db.String(40), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


class ProviderOrder(Base):
    __tablename__ = "provider_orders"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="provider_order_pkey"),
        db.Index("provider_order_tenant_provider_idx", "tenant_id", "provider_name"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider_name = db.Column(db.String(255), nullable=False)
    account_id = db.Column(StringUUID, nullable=False)
    payment_product_id = db.Column(db.String(191), nullable=False)
    payment_id = db.Column(db.String(191))
    transaction_id = db.Column(db.String(191))
    quantity = db.Column(db.Integer, nullable=False, server_default=db.text("1"))
    currency = db.Column(db.String(40))
    total_amount = db.Column(db.Integer)
    payment_status = db.Column(db.String(40), nullable=False, server_default=db.text("'wait_pay'::character varying"))
    paid_at = db.Column(db.DateTime)
    pay_failed_at = db.Column(db.DateTime)
    refunded_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


class ProviderModelSetting(Base):
    """
    Provider model settings for record the model enabled status and load balancing status.
    """

    __tablename__ = "provider_model_settings"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="provider_model_setting_pkey"),
        db.Index("provider_model_setting_tenant_provider_model_idx", "tenant_id", "provider_name", "model_type"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider_name = db.Column(db.String(255), nullable=False)
    model_name = db.Column(db.String(255), nullable=False)
    model_type = db.Column(db.String(40), nullable=False)
    enabled = db.Column(db.Boolean, nullable=False, server_default=db.text("true"))
    load_balancing_enabled = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


class LoadBalancingModelConfig(Base):
    """
    Configurations for load balancing models.
    """

    __tablename__ = "load_balancing_model_configs"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="load_balancing_model_config_pkey"),
        db.Index("load_balancing_model_config_tenant_provider_model_idx", "tenant_id", "provider_name", "model_type"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider_name = db.Column(db.String(255), nullable=False)
    model_name = db.Column(db.String(255), nullable=False)
    model_type = db.Column(db.String(40), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    encrypted_config = db.Column(db.Text, nullable=True)
    enabled = db.Column(db.Boolean, nullable=False, server_default=db.text("true"))
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
