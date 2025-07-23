import enum

from sqlalchemy import func
from sqlalchemy.orm import mapped_column

from .base import Base
from .engine import db
from .types import StringUUID


class APIBasedExtensionPoint(enum.Enum):
    APP_EXTERNAL_DATA_TOOL_QUERY = "app.external_data_tool.query"
    PING = "ping"
    APP_MODERATION_INPUT = "app.moderation.input"
    APP_MODERATION_OUTPUT = "app.moderation.output"


class APIBasedExtension(Base):
    __tablename__ = "api_based_extensions"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="api_based_extension_pkey"),
        db.Index("api_based_extension_tenant_idx", "tenant_id"),
    )

    id = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = mapped_column(StringUUID, nullable=False)
    name = mapped_column(db.String(255), nullable=False)
    api_endpoint = mapped_column(db.String(255), nullable=False)
    api_key = mapped_column(db.Text, nullable=False)
    created_at = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())
