from unittest.mock import MagicMock

import pytest

from machinery.context import RequestContext
from services.app_site_service import AppSiteChanges, AppSiteCommandResult, AppSiteService


def _command_result() -> AppSiteCommandResult:
    return AppSiteCommandResult(
        app_id="app-1",
        code="site-code",
        title="Site",
        icon=None,
        icon_background=None,
        description=None,
        default_language="en-US",
        customize_domain=None,
        copyright=None,
        privacy_policy=None,
        input_placeholder=None,
        custom_disclaimer="",
        customize_token_strategy="not_allow",
        prompt_public=False,
        show_workflow_steps=True,
        use_icon_as_answer_icon=False,
    )


def test_service_passes_stable_identity_to_store() -> None:
    context = RequestContext("request-1", None, "account-1", "workspace-1")
    changes = AppSiteChanges(title="Updated")
    store = MagicMock()
    store.update_site.return_value = _command_result()
    store.reset_access_token.return_value = _command_result()
    service = AppSiteService(sites=store)

    assert service.update(context, "app-1", changes) == _command_result()
    assert service.reset_access_token(context, "app-1") == _command_result()

    store.update_site.assert_called_once_with(
        workspace_id="workspace-1",
        app_id="app-1",
        actor_id="account-1",
        changes=changes,
    )
    store.reset_access_token.assert_called_once_with(
        workspace_id="workspace-1",
        app_id="app-1",
        actor_id="account-1",
    )


def test_service_rejects_context_without_active_workspace() -> None:
    context = RequestContext("request-1", None, "account-1", None)
    service = AppSiteService(sites=MagicMock())

    with pytest.raises(RuntimeError, match="active workspace"):
        service.update(context, "app-1", AppSiteChanges())
