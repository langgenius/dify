import json
from functools import wraps

from flask import abort, current_app, request
from flask_login import current_user

from controllers.console.workspace.error import AccountNotInitializedError
from services.feature_service import FeatureService
from services.operation_service import OperationService


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
            features = FeatureService.get_features(current_user.current_tenant_id)

            if features.billing.enabled:
                members = features.members
                apps = features.apps
                vector_space = features.vector_space
                documents_upload_quota = features.documents_upload_quota
                annotation_quota_limit = features.annotation_quota_limit

                if resource == 'members' and 0 < members.limit <= members.size:
                    abort(403, error_msg)
                elif resource == 'apps' and 0 < apps.limit <= apps.size:
                    abort(403, error_msg)
                elif resource == 'vector_space' and 0 < vector_space.limit <= vector_space.size:
                    abort(403, error_msg)
                elif resource == 'documents' and 0 < documents_upload_quota.limit <= documents_upload_quota.size:
                    # The api of file upload is used in the multiple places, so we need to check the source of the request from datasets
                    source = request.args.get('source')
                    if source == 'datasets':
                        abort(403, error_msg)
                    else:
                        return view(*args, **kwargs)
                elif resource == 'workspace_custom' and not features.can_replace_logo:
                    abort(403, error_msg)
                elif resource == 'annotation' and 0 < annotation_quota_limit.limit < annotation_quota_limit.size:
                    abort(403, error_msg)
                else:
                    return view(*args, **kwargs)

            return view(*args, **kwargs)
        return decorated
    return interceptor


def cloud_utm_record(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        try:
            features = FeatureService.get_features(current_user.current_tenant_id)

            if features.billing.enabled:
                utm_info = request.cookies.get('utm_info')

                if utm_info:
                    utm_info = json.loads(utm_info)
                    OperationService.record_utm(current_user.current_tenant_id, utm_info)
        except Exception as e:
            pass
        return view(*args, **kwargs)
    return decorated
