import enum
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .types import StringUUID


class APIBasedExtensionPoint(enum.StrEnum):
    APP_EXTERNAL_DATA_TOOL_QUERY = "app.external_data_tool.query"
    PING = "ping"
    APP_MODERATION_INPUT = "app.moderation.input"
    APP_MODERATION_OUTPUT = "app.moderation.output"


class APIBasedExtension(Base):
    __tablename__ = "api_based_extensions"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="api_based_extension_pkey"),
        sa.Index("api_based_extension_tenant_idx", "tenant_id"),
    )

    id = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    tenant_id = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    api_endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    api_key = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
