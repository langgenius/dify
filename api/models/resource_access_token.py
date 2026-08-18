from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now

from .base import Base
from .types import EnumText, StringUUID


class ResourceAccessTokenResourceType(StrEnum):
    APP = "app"
    KNOWLEDGE = "knowledge"


class ResourceAccessToken(Base):
    __tablename__ = "resource_access_tokens"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="resource_access_token_pkey"),
        sa.Index("resource_access_token_tenant_idx", "tenant_id"),
        sa.Index("resource_access_token_token_idx", "token", unique=True),
        sa.Index("resource_access_token_track_id_idx", "track_id", unique=True),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    track_id: Mapped[str] = mapped_column(String(32), nullable=False)
    token: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=naive_utc_now,
        server_default=func.current_timestamp(),
    )


class ResourceAccessTokenRelation(Base):
    __tablename__ = "resource_access_tokens_relation"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="resource_access_token_relation_pkey"),
        sa.CheckConstraint(
            "(resource_type = 'app' AND app_id IS NOT NULL AND dataset_id IS NULL) OR "
            "(resource_type = 'knowledge' AND dataset_id IS NOT NULL AND app_id IS NULL)",
            name="resource_access_token_relation_resource_check",
        ),
        sa.Index("resource_access_token_relation_token_idx", "token_id"),
        sa.Index("resource_access_token_relation_app_idx", "app_id"),
        sa.Index("resource_access_token_relation_dataset_idx", "dataset_id"),
        sa.UniqueConstraint("token_id", "resource_type", "app_id", name="resource_access_token_relation_app_unique"),
        sa.UniqueConstraint(
            "token_id",
            "resource_type",
            "dataset_id",
            name="resource_access_token_relation_dataset_unique",
        ),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuid4()))
    token_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    resource_type: Mapped[ResourceAccessTokenResourceType] = mapped_column(
        EnumText(ResourceAccessTokenResourceType, length=16),
        nullable=False,
    )
    app_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    dataset_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=naive_utc_now,
        server_default=func.current_timestamp(),
    )
