"""Service for the app_asset_contents table.

Provides single-node and batch DB operations for the inline content cache.
All methods are static and open their own short-lived sessions.

Collaborators:
    - models.app_asset.AppAssetContent (SQLAlchemy model)
    - core.app_assets.accessor (accessor abstraction that calls this service)
"""

import logging

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from extensions.ext_database import db
from models.app_asset import AppAssetContent

logger = logging.getLogger(__name__)


class AssetContentService:
    """DB operations for the inline asset content cache.

    All methods are static. All queries are scoped by tenant_id + app_id.
    """

    @staticmethod
    def get(tenant_id: str, app_id: str, node_id: str) -> str | None:
        """Get cached content for a single node. Returns None on miss."""
        with Session(db.engine) as session:
            return session.execute(
                select(AppAssetContent.content).where(
                    AppAssetContent.tenant_id == tenant_id,
                    AppAssetContent.app_id == app_id,
                    AppAssetContent.node_id == node_id,
                )
            ).scalar_one_or_none()

    @staticmethod
    def get_many(tenant_id: str, app_id: str, node_ids: list[str]) -> dict[str, str]:
        """Batch get. Returns {node_id: content} for hits only."""
        if not node_ids:
            return {}
        with Session(db.engine) as session:
            rows = session.execute(
                select(AppAssetContent.node_id, AppAssetContent.content).where(
                    AppAssetContent.tenant_id == tenant_id,
                    AppAssetContent.app_id == app_id,
                    AppAssetContent.node_id.in_(node_ids),
                )
            ).all()
            return {row.node_id: row.content for row in rows}

    @staticmethod
    def upsert(tenant_id: str, app_id: str, node_id: str, content: str, size: int) -> None:
        """Insert or update inline content for a single node."""
        with Session(db.engine) as session:
            stmt = pg_insert(AppAssetContent).values(
                tenant_id=tenant_id,
                app_id=app_id,
                node_id=node_id,
                content=content,
                size=size,
            )
            stmt = stmt.on_conflict_do_update(
                constraint="uq_asset_content_node",
                set_={
                    "content": stmt.excluded.content,
                    "size": stmt.excluded.size,
                },
            )
            session.execute(stmt)
            session.commit()

    @staticmethod
    def delete(tenant_id: str, app_id: str, node_id: str) -> None:
        """Delete cached content for a single node."""
        with Session(db.engine) as session:
            session.execute(
                delete(AppAssetContent).where(
                    AppAssetContent.tenant_id == tenant_id,
                    AppAssetContent.app_id == app_id,
                    AppAssetContent.node_id == node_id,
                )
            )
            session.commit()

    @staticmethod
    def delete_many(tenant_id: str, app_id: str, node_ids: list[str]) -> None:
        """Delete cached content for multiple nodes."""
        if not node_ids:
            return
        with Session(db.engine) as session:
            session.execute(
                delete(AppAssetContent).where(
                    AppAssetContent.tenant_id == tenant_id,
                    AppAssetContent.app_id == app_id,
                    AppAssetContent.node_id.in_(node_ids),
                )
            )
            session.commit()
