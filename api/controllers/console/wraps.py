import json
import os
import time
from functools import wraps

from flask import abort, request
from flask_login import current_user  # type: ignore

from configs import dify_config
from controllers.console.workspace.error import AccountNotInitializedError
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import RateLimitLog
from models.model import DifySetup
from services.feature_service import FeatureService, LicenseStatus
from services.operation_service import OperationService

from .error import NotInitValidateError, NotSetupError, UnauthorizedAndForceLogout


def account_initialization_required(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        # check account initialization
        account = current_user

        if account.status == "uninitialized":
            raise AccountNotInitializedError()

        return view(*args, **kwargs)

    return decorated


def only_edition_cloud(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        if dify_config.EDITION != "CLOUD":
            abort(404)

        return view(*args, **kwargs)

    return decorated


def only_edition_self_hosted(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        if dify_config.EDITION != "SELF_HOSTED":
            abort(404)

        return view(*args, **kwargs)

    return decorated


def cloud_edition_billing_resource_check(resource: str):
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
                if resource == "members" and 0 < members.limit <= members.size:
                    abort(403, "The number of members has reached the limit of your subscription.")
                elif resource == "apps" and 0 < apps.limit <= apps.size:
                    abort(403, "The number of apps has reached the limit of your subscription.")
                elif resource == "vector_space" and 0 < vector_space.limit <= vector_space.size:
                    abort(
                        403, "The capacity of the knowledge storage space has reached the limit of your subscription."
                    )
                elif resource == "documents" and 0 < documents_upload_quota.limit <= documents_upload_quota.size:
                    # The api of file upload is used in the multiple places,
                    # so we need to check the source of the request from datasets
                    source = request.args.get("source")
                    if source == "datasets":
                        abort(403, "The number of documents has reached the limit of your subscription.")
                    else:
                        return view(*args, **kwargs)
                elif resource == "workspace_custom" and not features.can_replace_logo:
                    abort(403, "The workspace custom feature has reached the limit of your subscription.")
                elif resource == "annotation" and 0 < annotation_quota_limit.limit < annotation_quota_limit.size:
                    abort(403, "The annotation quota has reached the limit of your subscription.")
                else:
                    return view(*args, **kwargs)

            return view(*args, **kwargs)

        return decorated

    return interceptor


def cloud_edition_billing_knowledge_limit_check(resource: str):
    def interceptor(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            features = FeatureService.get_features(current_user.current_tenant_id)
            if features.billing.enabled:
                if resource == "add_segment":
                    if features.billing.subscription.plan == "sandbox":
                        abort(
                            403,
                            "To unlock this feature and elevate your Dify experience, please upgrade to a paid plan.",
                        )
                else:
                    return view(*args, **kwargs)

            return view(*args, **kwargs)

        return decorated

    return interceptor


def cloud_edition_billing_rate_limit_check(resource: str):
    def interceptor(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            if resource == "knowledge":
                knowledge_rate_limit = FeatureService.get_knowledge_rate_limit(current_user.current_tenant_id)
                if knowledge_rate_limit.enabled:
                    current_time = int(time.time() * 1000)
                    key = f"rate_limit_{current_user.current_tenant_id}"

                    redis_client.zadd(key, {current_time: current_time})

                    redis_client.zremrangebyscore(key, 0, current_time - 60000)

                    request_count = redis_client.zcard(key)

                    if request_count > knowledge_rate_limit.limit:
                        # add ratelimit record
                        rate_limit_log = RateLimitLog(
                            tenant_id=current_user.current_tenant_id,
                            subscription_plan=knowledge_rate_limit.subscription_plan,
                            operation="knowledge",
                        )
                        db.session.add(rate_limit_log)
                        db.session.commit()
                        abort(
                            403, "Sorry, you have reached the knowledge base request rate limit of your subscription."
                        )
            return view(*args, **kwargs)

        return decorated

    return interceptor


def cloud_utm_record(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        try:
            features = FeatureService.get_features(current_user.current_tenant_id)

            if features.billing.enabled:
                utm_info = request.cookies.get("utm_info")

                if utm_info:
                    utm_info_dict: dict = json.loads(utm_info)
                    OperationService.record_utm(current_user.current_tenant_id, utm_info_dict)
        except Exception as e:
            pass
        return view(*args, **kwargs)

    return decorated


def setup_required(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        # check setup
        if (
            dify_config.EDITION == "SELF_HOSTED"
            and os.environ.get("INIT_PASSWORD")
            and not db.session.query(DifySetup).first()
        ):
            raise NotInitValidateError()
        elif dify_config.EDITION == "SELF_HOSTED" and not db.session.query(DifySetup).first():
            raise NotSetupError()

        return view(*args, **kwargs)

    return decorated


def enterprise_license_required(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        settings = FeatureService.get_system_features()
        if settings.license.status in [LicenseStatus.INACTIVE, LicenseStatus.EXPIRED, LicenseStatus.LOST]:
            raise UnauthorizedAndForceLogout("Your license is invalid. Please contact your administrator.")

        return view(*args, **kwargs)

    return decorated
