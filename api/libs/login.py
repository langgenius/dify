from functools import wraps
from typing import Any

from flask import current_app, g, has_request_context, request
from flask_login import user_logged_in  # type: ignore
from flask_login.config import EXEMPT_METHODS  # type: ignore
from werkzeug.exceptions import Unauthorized
from werkzeug.local import LocalProxy

from configs import dify_config
from extensions.ext_database import db
from models.account import Account, Tenant, TenantAccountJoin

#: A proxy for the current user. If no user is logged in, this will be an
#: anonymous user
current_user: Any = LocalProxy(lambda: _get_user())


def login_required(func):
    """
    If you decorate a view with this, it will ensure that the current user is
    logged in and authenticated before calling the actual view. (If they are
    not, it calls the :attr:`LoginManager.unauthorized` callback.) For
    example::

        @app.route('/post')
        @login_required
        def post():
            pass

    If there are only certain times you need to require that your user is
    logged in, you can do so with::

        if not current_user.is_authenticated:
            return current_app.login_manager.unauthorized()

    ...which is essentially the code that this function adds to your views.

    It can be convenient to globally turn off authentication when unit testing.
    To enable this, if the application configuration variable `LOGIN_DISABLED`
    is set to `True`, this decorator will be ignored.

    .. Note ::

        Per `W3 guidelines for CORS preflight requests
        <http://www.w3.org/TR/cors/#cross-origin-request-with-preflight-0>`_,
        HTTP ``OPTIONS`` requests are exempt from login checks.

    :param func: The view function to decorate.
    :type func: function
    """

    @wraps(func)
    def decorated_view(*args, **kwargs):
        auth_header = request.headers.get("Authorization")
        if dify_config.ADMIN_API_KEY_ENABLE:
            if auth_header:
                if " " not in auth_header:
                    raise Unauthorized("Invalid Authorization header format. Expected 'Bearer <api-key>' format.")
                auth_scheme, auth_token = auth_header.split(None, 1)
                auth_scheme = auth_scheme.lower()
                if auth_scheme != "bearer":
                    raise Unauthorized("Invalid Authorization header format. Expected 'Bearer <api-key>' format.")

                admin_api_key = dify_config.ADMIN_API_KEY
                if admin_api_key:
                    if admin_api_key == auth_token:
                        workspace_id = request.headers.get("X-WORKSPACE-ID")
                        if workspace_id:
                            tenant_account_join = (
                                db.session.query(Tenant, TenantAccountJoin)
                                .filter(Tenant.id == workspace_id)
                                .filter(TenantAccountJoin.tenant_id == Tenant.id)
                                .filter(TenantAccountJoin.role == "owner")
                                .one_or_none()
                            )
                            if tenant_account_join:
                                tenant, ta = tenant_account_join
                                account = Account.query.filter_by(id=ta.account_id).first()
                                # Login admin
                                if account:
                                    account.current_tenant = tenant
                                    current_app.login_manager._update_request_context_with_user(account)  # type: ignore
                                    user_logged_in.send(current_app._get_current_object(), user=_get_user())  # type: ignore
        if request.method in EXEMPT_METHODS or dify_config.LOGIN_DISABLED:
            pass
        elif not current_user.is_authenticated:
            return current_app.login_manager.unauthorized()  # type: ignore

        # flask 1.x compatibility
        # current_app.ensure_sync is only available in Flask >= 2.0
        if callable(getattr(current_app, "ensure_sync", None)):
            return current_app.ensure_sync(func)(*args, **kwargs)
        return func(*args, **kwargs)

    return decorated_view


def _get_user():
    if has_request_context():
        if "_login_user" not in g:
            current_app.login_manager._load_user()  # type: ignore

        return g._login_user

    return None
