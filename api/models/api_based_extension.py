import enum
from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import TypeBase
from .types import LongText, StringUUID


class APIBasedExtensionPoint(enum.StrEnum):
    APP_EXTERNAL_DATA_TOOL_QUERY = "app.external_data_tool.query"
    PING = "ping"
    APP_MODERATION_INPUT = "app.moderation.input"
    APP_MODERATION_OUTPUT = "app.moderation.output"


class APIBasedExtension(TypeBase):
    __tablename__ = "api_based_extensions"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="api_based_extension_pkey"),
        sa.Index("api_based_extension_tenant_idx", "tenant_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    api_endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    api_key: Mapped[str] = mapped_column(LongText, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
