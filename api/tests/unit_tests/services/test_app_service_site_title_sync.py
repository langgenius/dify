"""Regression tests for #41593.

The pre-fix code left ``Site.title`` untouched on app rename, so the
public webapp kept showing the old app name long after the console
had renamed the app. The fix syncs the title forward only when it
still matches the previous app name; a manually-edited title is
left alone.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from models.enums import CustomizeTokenStrategy
from models.model import App, AppMode, IconType, Site
from services.app_service import AppService


def _persist_app_with_site(
    session: Session, *, tenant_id: str, name: str, site_title: str | None
) -> tuple[App, Site | None]:
    """Persist an App and (optionally) its Site row, returning both."""
    app = App(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=name,
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#FFFFFF",
        enable_site=True,
        enable_api=False,
    )
    session.add(app)
    session.flush()

    site: Site | None = None
    if site_title is not None:
        site = Site(
            app_id=app.id,
            title=site_title,
            icon_type=IconType.EMOJI,
            default_language="en-US",
            show_workflow_steps=True,
            chat_color_theme_inverted=False,
            use_icon_as_answer_icon=False,
            customize_token_strategy=CustomizeTokenStrategy.ALLOW,
        )
        session.add(site)
        session.flush()
    return app, site


class TestSyncSiteTitleIfMatchedOldAppName:
    def test_no_op_when_name_did_not_change(self, sqlite_session: Session, account_and_tenant: tuple[str, str]) -> None:
        tenant_id, _ = account_and_tenant
        app, site = _persist_app_with_site(
            sqlite_session, tenant_id=tenant_id, name="Same Name", site_title="Same Name"
        )
        sqlite_session.commit()

        AppService._sync_site_title_if_matched_old_app_name(app, "Same Name", session=sqlite_session)
        sqlite_session.commit()

        site = sqlite_session.get(Site, site.id)
        assert site.title == "Same Name"

    def test_no_op_when_no_site_exists(self, sqlite_session: Session, account_and_tenant: tuple[str, str]) -> None:
        tenant_id, _ = account_and_tenant
        app, _ = _persist_app_with_site(sqlite_session, tenant_id=tenant_id, name="Old", site_title=None)
        app.name = "New"
        sqlite_session.commit()

        # No site row for this app — must not raise.
        AppService._sync_site_title_if_matched_old_app_name(app, "Old", session=sqlite_session)

    def test_syncs_when_site_title_still_matches_old_name(
        self, sqlite_session: Session, account_and_tenant: tuple[str, str]
    ) -> None:
        tenant_id, _ = account_and_tenant
        app, site = _persist_app_with_site(sqlite_session, tenant_id=tenant_id, name="Old Name", site_title="Old Name")
        sqlite_session.commit()

        # The console renamed the app. The Site still mirrors the old
        # name, so we should sync it forward.
        app.name = "New Name"
        AppService._sync_site_title_if_matched_old_app_name(app, "Old Name", session=sqlite_session)
        sqlite_session.commit()

        site = sqlite_session.get(Site, site.id)
        assert site.title == "New Name"

    def test_preserves_customized_site_title(
        self, sqlite_session: Session, account_and_tenant: tuple[str, str]
    ) -> None:
        tenant_id, _ = account_and_tenant
        app, site = _persist_app_with_site(
            sqlite_session, tenant_id=tenant_id, name="Old Name", site_title="Marketing Title"
        )
        sqlite_session.commit()

        app.name = "New Name"
        AppService._sync_site_title_if_matched_old_app_name(app, "Old Name", session=sqlite_session)
        sqlite_session.commit()

        site = sqlite_session.get(Site, site.id)
        assert site.title == "Marketing Title"


@pytest.fixture
def account_and_tenant(sqlite_session: Session) -> tuple[str, str]:
    """Reuse the existing helper from the test_app_service module."""
    from tests.unit_tests.services.test_app_service import _persist_account

    account = _persist_account(sqlite_session)
    return account.current_tenant.id, account.id
