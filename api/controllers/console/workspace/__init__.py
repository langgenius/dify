from collections.abc import Callable
from functools import wraps

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import Forbidden

from extensions.ext_database import db
from libs.login import current_account_with_tenant
from models.account import TenantPluginPermission


def plugin_permission_required(
    install_required: bool = False,
    debug_required: bool = False,
):
    def interceptor[**P, R](view: Callable[P, R]) -> Callable[P, R]:
        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
            current_user, current_tenant_id = current_account_with_tenant()
            user = current_user
            tenant_id = current_tenant_id

            with sessionmaker(db.engine).begin() as session:
                permission = session.scalar(
                    select(TenantPluginPermission)
                    .where(
                        TenantPluginPermission.tenant_id == tenant_id,
                    )
                    .limit(1)
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
