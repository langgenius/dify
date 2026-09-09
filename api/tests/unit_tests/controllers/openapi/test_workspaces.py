"""Phase E step 17: workspace reads at /openapi/v1/workspaces. Bearer-authed
list + member-gated detail. No legacy /v1/ equivalent — the cookie-authed
/console/api/workspaces is a separate consumer that stays in console.
"""

import builtins

import pytest
from flask.views import MethodView

from controllers.openapi.app_run import AppRunApi
from controllers.openapi.workspaces import (
    WorkspaceMemberApi,
    WorkspaceMembersApi,
    WorkspaceSwitchApi,
)

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    "view",
    [
        WorkspaceSwitchApi.post,
        WorkspaceMembersApi.post,
        WorkspaceMemberApi.delete,
        WorkspaceMemberApi.patch,
        AppRunApi.post,
    ],
    ids=["switch", "members.invite", "members.remove", "members.update_role", "app_run.run"],
)
def test_write_routes_commit_the_request_session(view):
    """The routes whose `@with_session` carried the decorator's own default before
    it moved onto `@endpoint`: each mutates through the router's session, so a
    `write=False` here is silent data loss. The allow/deny matrix cannot see
    this — it observes admission before the view body runs.
    """
    assert view.__spec__.write is True
