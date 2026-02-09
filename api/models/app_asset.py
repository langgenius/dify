from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func
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
