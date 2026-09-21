"""App query results survive repository closure without ORM or request state."""

from dataclasses import asdict
from uuid import uuid4

from sqlalchemy import Engine, event
from sqlalchemy.orm import sessionmaker

from fields.app_fields import AppPagination
from models.enums import AppStatus
from models.model import App, AppMode
from repositories.app.console_repository import ConsoleAppRepository
from services.app.query_service import AppQueryService
from services.entities.app_entities import AppListParams, AppRecord, AppSummary


def test_queries_return_materialized_data_and_close_their_sessions(sqlite_engine: Engine) -> None:
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False, close_resets_only=False)
    tenant_id, other_tenant_id, account_id = (str(uuid4()) for _ in range(3))
    visible_id, disabled_id, foreign_id = (str(uuid4()) for _ in range(3))
    with factory.begin() as session:
        session.add_all(
            [
                App(
                    id=app_id,
                    tenant_id=workspace,
                    name=name,
                    description=name,
                    mode=AppMode.CHAT,
                    enable_api=enabled,
                    enable_site=False,
                )
                for app_id, workspace, name, enabled in (
                    (visible_id, tenant_id, "Visible", True),
                    (disabled_id, tenant_id, "Disabled", False),
                    (foreign_id, other_tenant_id, "Other tenant", True),
                )
            ]
        )

    repository = ConsoleAppRepository(session_factory=factory)
    service = AppQueryService(apps=repository)
    connections: set[object] = set()
    checkouts: list[object] = []

    def checkout(connection: object, *_args: object) -> None:
        connections.add(connection)
        checkouts.append(connection)

    def checkin(connection: object, *_args: object) -> None:
        connections.remove(connection)

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        app = service.get_visible_app_by_id(visible_id, tenant_id)
        assert isinstance(app, AppSummary)
        assert not connections
        assert service.get_visible_app_by_id(visible_id, other_tenant_id) is None
        assert service.get_visible_app_by_id(disabled_id, tenant_id) is None
        assert service.get_visible_app_by_id(str(uuid4()), tenant_id) is None
        assert not connections

        visible = service.find_visible_apps_by_ids([visible_id, disabled_id])
        assert [item.id for item in visible] == [visible_id]
        assert not connections
        page = service.get_paginate_apps(
            account_id, tenant_id, AppListParams(status=AppStatus.NORMAL, openapi_visible=True)
        )
        assert page is not None
        assert [item.id for item in page.items] == [visible_id]
        assert page.total == 1
        assert not connections

        related = service.related_apps(tenant_id, [disabled_id, foreign_id, visible_id, str(uuid4())])
        assert [item.id for item in related] == [disabled_id, visible_id]
        assert all(isinstance(item, AppRecord) for item in related)
        assert not connections

        checkout_count = len(checkouts)
        assert checkout_count > 0
        assert asdict(app)["name"] == "Visible"
        assert asdict(page)["items"][0]["tenant_id"] == tenant_id
        serialized = AppPagination.model_validate(
            {"page": 1, "limit": 2, "total": 2, "has_more": False, "data": related}
        ).model_dump(mode="json")
        assert [item["id"] for item in serialized["data"]] == [disabled_id, visible_id]
        assert len(checkouts) == checkout_count
        assert not connections
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)
