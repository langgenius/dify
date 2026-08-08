from collections.abc import Callable
from functools import wraps

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import Forbidden

from configs import dify_config
from extensions.ext_database import db
from libs.login import current_account_with_tenant
from models.account import TenantPluginDebugPermission, TenantPluginInstallPermission, TenantPluginPermission


def plugin_permission_required(
    install_required: bool = False,
    debug_required: bool = False,
):
    def interceptor[**P, R](view: Callable[P, R]) -> Callable[P, R]:
        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
            if dify_config.RBAC_ENABLED:
                return view(*args, **kwargs)

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
                    match permission.install_permission:
                        case TenantPluginInstallPermission.NOBODY:
                            raise Forbidden()
                        case TenantPluginInstallPermission.ADMINS:
                            if not user.is_admin_or_owner:
                                raise Forbidden()
                        case TenantPluginInstallPermission.EVERYONE:
                            pass

                if debug_required:
                    match permission.debug_permission:
                        case TenantPluginDebugPermission.NOBODY:
                            raise Forbidden()
                        case TenantPluginDebugPermission.ADMINS:
                            if not user.is_admin_or_owner:
                                raise Forbidden()
                        case TenantPluginDebugPermission.EVERYONE:
                            pass

            return view(*args, **kwargs)

        return decorated

    return interceptor
