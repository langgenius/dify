from __future__ import annotations

from sqlalchemy import desc
from sqlalchemy.dialects.postgresql import JSONB, UUID

from .engine import db

# from .account import Account  <- This is the source of the circular import


class PromptTemplate(db.Model):
    __tablename__ = 'prompt_templates'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='prompt_template_pkey'),
        db.Index('prompt_template_tenant_id_idx', 'tenant_id'),
    )

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    id = db.Column(UUID, primary_key=True, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(UUID, nullable=False)
    name = db.Column(db.String(255), nullable=False)
    mode = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    tags = db.Column(JSONB, nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False,
                           server_default=db.text('CURRENT_TIMESTAMP(0)'),
                           onupdate=db.text('CURRENT_TIMESTAMP(0)'))
    
    # Relationships
    versions = db.relationship('PromptVersion', back_populates='prompt_template',
                               cascade="all, delete-orphan", lazy='dynamic')

    def get_latest_version(self):
        """
        Fetches the most recent version of the prompt template.
        """
        return self.versions.order_by(desc(PromptVersion.created_at)).first()

    def to_dict(self):
        latest_version = self.get_latest_version()
        model_settings = None
        if latest_version:
            model_settings = {
                "model_name": latest_version.model_name,
                "parameters": latest_version.model_parameters
            }

        return {
            'id': str(self.id),
            'name': self.name,
            'mode': self.mode,
            'description': self.description,
            'tags': self.tags,
            'prompt_content': latest_version.prompt_text if latest_version else None,
            'model_settings': model_settings,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
        }

    def __repr__(self):
        return f'<PromptTemplate @{self.id}>'


class PromptVersion(db.Model):
    __tablename__ = 'prompt_versions'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='prompt_version_pkey'),
        db.Index('prompt_version_template_id_idx', 'prompt_template_id'),
    )
    
    id = db.Column(UUID, primary_key=True, server_default=db.text('uuid_generate_v4()'))
    prompt_template_id = db.Column(UUID, db.ForeignKey('prompt_templates.id'), nullable=False)
    version = db.Column(db.String(255), nullable=False, default='1.0')
    prompt_text = db.Column(db.Text, nullable=False)
    variables = db.Column(JSONB, nullable=True)
    model_name = db.Column(db.String(255), nullable=True)
    model_parameters = db.Column(JSONB, nullable=True)
    model_settings = db.Column(JSONB, nullable=True)
    
    status = db.Column(db.String(50), nullable=False, default='draft') # e.g., draft, published, archived

    created_by = db.Column(UUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False,
                           server_default=db.text('CURRENT_TIMESTAMP(0)'),
                           onupdate=db.text('CURRENT_TIMESTAMP(0)'))
    
    # Relationships
    prompt_template = db.relationship('PromptTemplate', back_populates='versions')

    def __repr__(self):
        return f'<PromptVersion @{self.id} for Template {self.prompt_template_id}>' 