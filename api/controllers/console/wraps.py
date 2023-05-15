# -*- coding:utf-8 -*-
from functools import wraps

from flask import current_app, abort
from flask_login import current_user

from controllers.console.workspace.error import AccountNotInitializedError


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
