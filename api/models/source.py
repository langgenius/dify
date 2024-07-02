import json

from sqlalchemy.dialects.postgresql import JSONB

from extensions.ext_database import db
from models import StringUUID


class DataSourceOauthBinding(db.Model):
    __tablename__ = 'data_source_oauth_bindings'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='source_binding_pkey'),
        db.Index('source_binding_tenant_id_idx', 'tenant_id'),
        db.Index('source_info_idx', "source_info", postgresql_using='gin')
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    access_token = db.Column(db.String(255), nullable=False)
    provider = db.Column(db.String(255), nullable=False)
    source_info = db.Column(JSONB, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    disabled = db.Column(db.Boolean, nullable=True, server_default=db.text('false'))


class DataSourceApiKeyAuthBinding(db.Model):
    __tablename__ = 'data_source_api_key_auth_bindings'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='data_source_api_key_auth_binding_pkey'),
        db.Index('data_source_api_key_auth_binding_tenant_id_idx', 'tenant_id'),
        db.Index('data_source_api_key_auth_binding_provider_idx', 'provider'),
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    category = db.Column(db.String(255), nullable=False)
    provider = db.Column(db.String(255), nullable=False)
    credentials = db.Column(db.Text, nullable=True)  # JSON
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    disabled = db.Column(db.Boolean, nullable=True, server_default=db.text('false'))

    def to_dict(self):
        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'category': self.category,
            'provider': self.provider,
            'credentials': json.loads(self.credentials),
            'created_at': self.created_at.timestamp(),
            'updated_at': self.updated_at.timestamp(),
            'disabled': self.disabled
        }
