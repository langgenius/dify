# -*- coding:utf-8 -*-
from functools import wraps

from flask import current_app, abort
from flask_login import current_user

from controllers.console.workspace.error import AccountNotInitializedError
from services.billing_service import BillingService


def account_initialization_required(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        # check account initialization
        account = current_user

        if account.status == 'uninitialized':
            raise AccountNotInitializedError()

        return view(*args, **kwargs)

    return decorated


def only_edition_cloud(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        if current_app.config['EDITION'] != 'CLOUD':
            abort(404)

        return view(*args, **kwargs)

    return decorated


def only_edition_self_hosted(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        if current_app.config['EDITION'] != 'SELF_HOSTED':
            abort(404)

        return view(*args, **kwargs)

    return decorated


def cloud_edition_billing_resource_check(resource: str,
                                         error_msg: str = "You have reached the limit of your subscription."):
    def interceptor(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            if current_app.config['EDITION'] == 'CLOUD':
                tenant_id = current_user.current_tenant_id
                billing_info = BillingService.get_info(tenant_id)
                members = billing_info['members']
                apps = billing_info['apps']
                vector_space = billing_info['vector_space']

                if resource == 'members' and 0 < members['limit'] <= members['size']:
                    abort(403, error_msg)
                elif resource == 'apps' and 0 < apps['limit'] <= apps['size']:
                    abort(403, error_msg)
                elif resource == 'vector_space' and 0 < vector_space['limit'] <= vector_space['size']:
                    abort(403, error_msg)
                else:
                    return view(*args, **kwargs)

            return view(*args, **kwargs)
        return decorated
    return interceptor

