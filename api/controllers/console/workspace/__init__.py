from functools import wraps

from flask_login import current_user
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from extensions.ext_database import db
from models.account import TenantPluginPermission


def plugin_permission_required(
    install_required: bool = False,
    debug_required: bool = False,
):
    def interceptor(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            user = current_user
            tenant_id = user.current_tenant_id

            with Session(db.engine) as session:
                permission = (
                    session.query(TenantPluginPermission)
                    .filter(
                        TenantPluginPermission.tenant_id == tenant_id,
                    )
                    .first()
                )

                if not permission:
                    # no permission set, allow access for everyone
                    return view(*args, **kwargs)

                if install_required:
                    if permission.install_permission == TenantPluginPermission.InstallPermission.NOBODY:
                        raise Forbidden()
                    if permission.install_permission == TenantPluginPermission.InstallPermission.ADMINS:
                        if not user.is_admin_or_owner:
                            raise Forbidden()
                    if permission.install_permission == TenantPluginPermission.InstallPermission.EVERYONE:
                        pass

                if debug_required:
                    if permission.debug_permission == TenantPluginPermission.DebugPermission.NOBODY:
                        raise Forbidden()
                    if permission.debug_permission == TenantPluginPermission.DebugPermission.ADMINS:
                        if not user.is_admin_or_owner:
                            raise Forbidden()
                    if permission.debug_permission == TenantPluginPermission.DebugPermission.EVERYONE:
                        pass

            return view(*args, **kwargs)

        return decorated

    return interceptor
