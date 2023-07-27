import json
from enum import Enum

from sqlalchemy.dialects.postgresql import UUID

from extensions.ext_database import db


class ToolProviderName(Enum):
    SERPAPI = 'serpapi'

    @staticmethod
    def value_of(value):
        for member in ToolProviderName:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class ToolProvider(db.Model):
    __tablename__ = 'tool_providers'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='tool_provider_pkey'),
        db.UniqueConstraint('tenant_id', 'tool_name', name='unique_tool_provider_tool_name')
    )

    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(UUID, nullable=False)
    tool_name = db.Column(db.String(40), nullable=False)
    encrypted_credentials = db.Column(db.Text, nullable=True)
    is_enabled = db.Column(db.Boolean, nullable=False, server_default=db.text('false'))
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    @property
    def credentials_is_set(self):
        """
         Returns True if the encrypted_config is not None, indicating that the token is set.
         """
        return self.encrypted_credentials is not None

    @property
    def credentials(self):
        """
        Returns the decrypted config.
        """
        return json.loads(self.encrypted_credentials) if self.encrypted_credentials is not None else None
