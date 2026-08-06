"""Database repository for the Explore banner read model."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.enums import BannerStatus
from models.model import ExporleBanner
from services.explore_banner_query_service import ExploreBannerQuery, ExploreBannerRecord


class ExploreBannerQueryRepository(ExploreBannerQuery):
    def __init__(self, client: sessionmaker[Session]) -> None:
        self._client = client

    @override
    def list_enabled(self, language: str) -> tuple[ExploreBannerRecord, ...]:
        stmt = (
            select(
                ExporleBanner.id,
                ExporleBanner.content,
                ExporleBanner.link,
                ExporleBanner.sort,
                ExporleBanner.status,
                ExporleBanner.created_at,
            )
            .where(
                ExporleBanner.status == BannerStatus.ENABLED,
                ExporleBanner.language == language,
            )
            .order_by(ExporleBanner.sort)
        )

        with self._client() as session:
            rows = session.execute(stmt).all()
            return tuple(
                ExploreBannerRecord(
                    id=banner_id,
                    content=content,
                    link=link,
                    sort=sort,
                    status=status.value,
                    created_at=created_at,
                )
                for banner_id, content, link, sort, status, created_at in rows
            )
