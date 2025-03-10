import enum

from sqlalchemy import func

from .engine import db
from .types import StringUUID, uuid_default


class APIBasedExtensionPoint(enum.Enum):
    APP_EXTERNAL_DATA_TOOL_QUERY = "app.external_data_tool.query"
    PING = "ping"
    APP_MODERATION_INPUT = "app.moderation.input"
    APP_MODERATION_OUTPUT = "app.moderation.output"


class APIBasedExtension(db.Model):  # type: ignore[name-defined]
    __tablename__ = "api_based_extensions"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="api_based_extension_pkey"),
        db.Index("api_based_extension_tenant_idx", "tenant_id"),
    )

    id = db.Column(StringUUID, **uuid_default())
    tenant_id = db.Column(StringUUID, nullable=False)
    name = db.Column(db.String(255), nullable=False)
    api_endpoint = db.Column(db.String(255), nullable=False)
    api_key = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
