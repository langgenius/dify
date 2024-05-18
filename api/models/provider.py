from enum import Enum

from extensions.ext_database import db
from models import StringUUID


class ProviderType(Enum):
    CUSTOM = 'custom'
    SYSTEM = 'system'

    @staticmethod
    def value_of(value):
        for member in ProviderType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class ProviderQuotaType(Enum):
    PAID = 'paid'
    """hosted paid quota"""

    FREE = 'free'
    """third-party free quota"""

    TRIAL = 'trial'
    """hosted trial quota"""

    @staticmethod
    def value_of(value):
        for member in ProviderQuotaType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class Provider(db.Model):
    """
    Provider model representing the API providers and their configurations.
    """
    __tablename__ = 'providers'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='provider_pkey'),
        db.Index('provider_tenant_id_provider_idx', 'tenant_id', 'provider_name'),
        db.UniqueConstraint('tenant_id', 'provider_name', 'provider_type', 'quota_type', name='unique_provider_name_type_quota')
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider_name = db.Column(db.String(40), nullable=False)
    provider_type = db.Column(db.String(40), nullable=False, server_default=db.text("'custom'::character varying"))
    encrypted_config = db.Column(db.Text, nullable=True)
    is_valid = db.Column(db.Boolean, nullable=False, server_default=db.text('false'))
    last_used = db.Column(db.DateTime, nullable=True)

    quota_type = db.Column(db.String(40), nullable=True, server_default=db.text("''::character varying"))
    quota_limit = db.Column(db.BigInteger, nullable=True)
    quota_used = db.Column(db.BigInteger, default=0)

    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    def __repr__(self):
        return f"<Provider(id={self.id}, tenant_id={self.tenant_id}, provider_name='{self.provider_name}', provider_type='{self.provider_type}')>"

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


class ProviderModel(db.Model):
    """
    Provider model representing the API provider_models and their configurations.
    """
    __tablename__ = 'provider_models'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='provider_model_pkey'),
        db.Index('provider_model_tenant_id_provider_idx', 'tenant_id', 'provider_name'),
        db.UniqueConstraint('tenant_id', 'provider_name', 'model_name', 'model_type', name='unique_provider_model_name')
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider_name = db.Column(db.String(40), nullable=False)
    model_name = db.Column(db.String(255), nullable=False)
    model_type = db.Column(db.String(40), nullable=False)
    encrypted_config = db.Column(db.Text, nullable=True)
    is_valid = db.Column(db.Boolean, nullable=False, server_default=db.text('false'))
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))


class TenantDefaultModel(db.Model):
    __tablename__ = 'tenant_default_models'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='tenant_default_model_pkey'),
        db.Index('tenant_default_model_tenant_id_provider_type_idx', 'tenant_id', 'provider_name', 'model_type'),
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider_name = db.Column(db.String(40), nullable=False)
    model_name = db.Column(db.String(255), nullable=False)
    model_type = db.Column(db.String(40), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))


class TenantPreferredModelProvider(db.Model):
    __tablename__ = 'tenant_preferred_model_providers'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='tenant_preferred_model_provider_pkey'),
        db.Index('tenant_preferred_model_provider_tenant_provider_idx', 'tenant_id', 'provider_name'),
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider_name = db.Column(db.String(40), nullable=False)
    preferred_provider_type = db.Column(db.String(40), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))


class ProviderOrder(db.Model):
    __tablename__ = 'provider_orders'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='provider_order_pkey'),
        db.Index('provider_order_tenant_provider_idx', 'tenant_id', 'provider_name'),
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider_name = db.Column(db.String(40), nullable=False)
    account_id = db.Column(StringUUID, nullable=False)
    payment_product_id = db.Column(db.String(191), nullable=False)
    payment_id = db.Column(db.String(191))
    transaction_id = db.Column(db.String(191))
    quantity = db.Column(db.Integer, nullable=False, server_default=db.text('1'))
    currency = db.Column(db.String(40))
    total_amount = db.Column(db.Integer)
    payment_status = db.Column(db.String(40), nullable=False, server_default=db.text("'wait_pay'::character varying"))
    paid_at = db.Column(db.DateTime)
    pay_failed_at = db.Column(db.DateTime)
    refunded_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
