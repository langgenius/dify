from datetime import datetime
from enum import StrEnum, auto
from functools import cached_property

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .engine import db
from .types import StringUUID


class ProviderType(StrEnum):
    CUSTOM = auto()
    SYSTEM = auto()

    @staticmethod
    def value_of(value: str) -> "ProviderType":
        for member in ProviderType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class ProviderQuotaType(StrEnum):
    PAID = auto()
    """hosted paid quota"""

    FREE = auto()
    """third-party free quota"""

    TRIAL = auto()
    """hosted trial quota"""

    @staticmethod
    def value_of(value: str) -> "ProviderQuotaType":
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
        sa.PrimaryKeyConstraint("id", name="provider_pkey"),
        sa.Index("provider_tenant_id_provider_idx", "tenant_id", "provider_name"),
        sa.UniqueConstraint(
            "tenant_id", "provider_name", "provider_type", "quota_type", name="unique_provider_name_type_quota"
        ),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_type: Mapped[str] = mapped_column(
        String(40), nullable=False, server_default=text("'custom'::character varying")
    )
    is_valid: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=text("false"))
    last_used: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    credential_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)

    quota_type: Mapped[str | None] = mapped_column(
        String(40), nullable=True, server_default=text("''::character varying")
    )
    quota_limit: Mapped[int | None] = mapped_column(sa.BigInteger, nullable=True)
    quota_used: Mapped[int | None] = mapped_column(sa.BigInteger, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())

    def __repr__(self):
        return (
            f"<Provider(id={self.id}, tenant_id={self.tenant_id}, provider_name='{self.provider_name}',"
            f" provider_type='{self.provider_type}')>"
        )

    @cached_property
    def credential(self):
        if self.credential_id:
            return db.session.query(ProviderCredential).where(ProviderCredential.id == self.credential_id).first()

    @property
    def credential_name(self):
        credential = self.credential
        return credential.credential_name if credential else None

    @property
    def encrypted_config(self):
        credential = self.credential
        return credential.encrypted_config if credential else None

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
        if self.provider_type == ProviderType.SYSTEM:
            return self.is_valid
        else:
            return self.is_valid and self.token_is_set


class ProviderModel(Base):
    """
    Provider model representing the API provider_models and their configurations.
    """

    __tablename__ = "provider_models"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="provider_model_pkey"),
        sa.Index("provider_model_tenant_id_provider_idx", "tenant_id", "provider_name"),
        sa.UniqueConstraint(
            "tenant_id", "provider_name", "model_name", "model_type", name="unique_provider_model_name"
        ),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_type: Mapped[str] = mapped_column(String(40), nullable=False)
    credential_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    is_valid: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())

    @cached_property
    def credential(self):
        if self.credential_id:
            return (
                db.session.query(ProviderModelCredential)
                .where(ProviderModelCredential.id == self.credential_id)
                .first()
            )

    @property
    def credential_name(self):
        credential = self.credential
        return credential.credential_name if credential else None

    @property
    def encrypted_config(self):
        credential = self.credential
        return credential.encrypted_config if credential else None


class TenantDefaultModel(Base):
    __tablename__ = "tenant_default_models"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tenant_default_model_pkey"),
        sa.Index("tenant_default_model_tenant_id_provider_type_idx", "tenant_id", "provider_name", "model_type"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_type: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class TenantPreferredModelProvider(Base):
    __tablename__ = "tenant_preferred_model_providers"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tenant_preferred_model_provider_pkey"),
        sa.Index("tenant_preferred_model_provider_tenant_provider_idx", "tenant_id", "provider_name"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    preferred_provider_type: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class ProviderOrder(Base):
    __tablename__ = "provider_orders"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="provider_order_pkey"),
        sa.Index("provider_order_tenant_provider_idx", "tenant_id", "provider_name"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    payment_product_id: Mapped[str] = mapped_column(String(191), nullable=False)
    payment_id: Mapped[str | None] = mapped_column(String(191))
    transaction_id: Mapped[str | None] = mapped_column(String(191))
    quantity: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=text("1"))
    currency: Mapped[str | None] = mapped_column(String(40))
    total_amount: Mapped[int | None] = mapped_column(sa.Integer)
    payment_status: Mapped[str] = mapped_column(
        String(40), nullable=False, server_default=text("'wait_pay'::character varying")
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime)
    pay_failed_at: Mapped[datetime | None] = mapped_column(DateTime)
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class ProviderModelSetting(Base):
    """
    Provider model settings for record the model enabled status and load balancing status.
    """

    __tablename__ = "provider_model_settings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="provider_model_setting_pkey"),
        sa.Index("provider_model_setting_tenant_provider_model_idx", "tenant_id", "provider_name", "model_type"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_type: Mapped[str] = mapped_column(String(40), nullable=False)
    enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=text("true"))
    load_balancing_enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class LoadBalancingModelConfig(Base):
    """
    Configurations for load balancing models.
    """

    __tablename__ = "load_balancing_model_configs"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="load_balancing_model_config_pkey"),
        sa.Index("load_balancing_model_config_tenant_provider_model_idx", "tenant_id", "provider_name", "model_type"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_type: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    encrypted_config: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    credential_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    credential_source_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class ProviderCredential(Base):
    """
    Provider credential - stores multiple named credentials for each provider
    """

    __tablename__ = "provider_credentials"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="provider_credential_pkey"),
        sa.Index("provider_credential_tenant_provider_idx", "tenant_id", "provider_name"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=text("uuidv7()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    credential_name: Mapped[str] = mapped_column(String(255), nullable=False)
    encrypted_config: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class ProviderModelCredential(Base):
    """
    Provider model credential - stores multiple named credentials for each provider model
    """

    __tablename__ = "provider_model_credentials"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="provider_model_credential_pkey"),
        sa.Index(
            "provider_model_credential_tenant_provider_model_idx",
            "tenant_id",
            "provider_name",
            "model_name",
            "model_type",
        ),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=text("uuidv7()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_type: Mapped[str] = mapped_column(String(40), nullable=False)
    credential_name: Mapped[str] = mapped_column(String(255), nullable=False)
    encrypted_config: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
