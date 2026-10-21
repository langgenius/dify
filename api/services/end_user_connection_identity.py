"""Adapt the existing authenticated Web Passport result to Connection authority."""

from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionConfigurationError, ConnectionIdentityError


def connection_context_from_web_passport(*, app: App, end_user: EndUser) -> WebConnectionContext:
    """Call only with the persisted objects returned by the Web authentication guard.

    This does not verify JWTs or replace App Access/Guest feature gating. Those
    entry policies run before connection management. Do not pass request DTOs here
    or infer an Account from external_user_id, session_id, or workspace membership.
    Service API/Portal identity reconstruction remains their separate entry task.
    """
    if (
        not app.id
        or not app.tenant_id
        or not end_user.id
        or end_user.tenant_id != app.tenant_id
        or end_user.app_id != app.id
        or end_user.type != EndUserType.BROWSER
        or end_user.account_id == ""
    ):
        raise ConnectionIdentityError()
    if app.mode not in (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW):
        raise ConnectionConfigurationError()
    return WebConnectionContext(
        tenant_id=app.tenant_id,
        app_id=app.id,
        end_user_id=end_user.id,
        account_id=end_user.account_id,
    )
