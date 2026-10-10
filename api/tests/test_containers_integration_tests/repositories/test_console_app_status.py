"""Status comparisons must wait for concurrent writes, including apparent no-ops."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.model import App, AppMode
from repositories.app.console_repository import ConsoleAppRepository
from services.entities.app_entities import AppChange


@pytest.mark.parametrize("surface", ["site", "api"])
@pytest.mark.parametrize("enabled", [True, False])
def test_status_update_waits_for_inflight_opposite_write(
    db_session_with_containers: Session, surface: str, enabled: bool
) -> None:
    factory = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    context = RequestContext("request", None, str(uuid4()), str(uuid4()))
    app_id = str(uuid4())
    with factory.begin() as session:
        session.add(
            App(
                id=app_id,
                tenant_id=context.active_workspace_id,
                name="Concurrent status",
                mode=AppMode.CHAT,
                enable_site=enabled,
                enable_api=enabled,
            )
        )
    repository = ConsoleAppRepository(session_factory=factory)
    set_enabled = repository.set_site_enabled if surface == "site" else repository.set_api_enabled
    column = App.enable_site if surface == "site" else App.enable_api
    started = Event()
    finished = Event()

    def restore_status() -> AppChange:
        started.set()
        try:
            return set_enabled(context, app_id, enabled)
        finally:
            finished.set()

    with ThreadPoolExecutor(max_workers=1) as executor:
        with factory.begin() as first:
            first.execute(update(App).where(App.id == app_id).values({column: not enabled}))
            future = executor.submit(restore_status)
            assert started.wait(timeout=5)
            returned_before_commit = finished.wait(timeout=1)
        result = future.result(timeout=10)

    assert not returned_before_commit
    assert result.changed
    assert (result.app.enable_site if surface == "site" else result.app.enable_api) is enabled
    with factory() as read:
        assert read.scalar(select(column).where(App.id == app_id)) is enabled
