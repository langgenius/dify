from sqlalchemy.dialects.postgresql import JSONB

from extensions.ext_database import db
from models import StringUUID


class DataSourceOauthBinding(db.Model):
    __tablename__ = 'data_source_bindings'
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


class DataSourceBearerBinding(db.Model):
    __tablename__ = 'data_source_bearer_bindings'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='source_bearer_binding_pkey'),
        db.Index('source_bearer_binding_tenant_id_idx', 'tenant_id'),
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider = db.Column(db.String(255), nullable=False)
    endpoint_url = db.Column(db.String(512), nullable=False)  # For validation with endpoint + bearer key
    bearer_key = db.Column(db.String(512), nullable=True)    # For validation with endpoint + bearer key
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    disabled = db.Column(db.Boolean, nullable=True, server_default=db.text('false'))