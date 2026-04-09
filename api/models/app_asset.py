from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from core.app.entities.app_asset_entities import AppAssetFileTree

from .base import Base
from .types import LongText, StringUUID


class AppAssets(Base):
    __tablename__ = "app_assets"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="app_assets_pkey"),
        sa.Index("app_assets_version_idx", "tenant_id", "app_id", "version"),
    )

    VERSION_DRAFT = "draft"
    VERSION_PUBLISHED = "published"

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    version: Mapped[str] = mapped_column(String(255), nullable=False)
    _asset_tree: Mapped[str] = mapped_column("asset_tree", LongText, nullable=False, default='{"nodes":[]}')
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_by: Mapped[str | None] = mapped_column(StringUUID)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=func.current_timestamp(),
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
    )

    @property
    def asset_tree(self) -> AppAssetFileTree:
        if not self._asset_tree:
            return AppAssetFileTree()
        return AppAssetFileTree.model_validate_json(self._asset_tree)

    @asset_tree.setter
    def asset_tree(self, value: AppAssetFileTree) -> None:
        self._asset_tree = value.model_dump_json()

    def __repr__(self) -> str:
        return f"<AppAssets(id={self.id}, app_id={self.app_id}, version={self.version})>"


class AppAssetContent(Base):
    """Inline content cache for app asset draft files.

    Acts as a read-through cache for S3: text-like asset content is dual-written
    here on save and read from DB first (falling back to S3 on miss with sync backfill).
    Keyed by (tenant_id, app_id, node_id) — stores only the current draft content,
    not published snapshots.

    See core/app_assets/content_accessor.py for the accessor abstraction that
    manages the DB/S3 read-through and dual-write logic.
    """

    __tablename__ = "app_asset_contents"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="app_asset_contents_pkey"),
        sa.UniqueConstraint("tenant_id", "app_id", "node_id", name="uq_asset_content_node"),
        sa.Index("idx_asset_content_app", "tenant_id", "app_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    node_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    content: Mapped[str] = mapped_column(LongText, nullable=False, default="")
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=func.current_timestamp(),
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
    )

    def __repr__(self) -> str:
        return f"<AppAssetContent(id={self.id}, node_id={self.node_id})>"
