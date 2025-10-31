import contextlib
import json
import os
import time
from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

from flask import abort, request

from configs import dify_config
from controllers.console.workspace.error import AccountNotInitializedError
from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.login import current_account_with_tenant
from models.account import AccountStatus
from models.dataset import RateLimitLog
from models.model import DifySetup
from services.feature_service import FeatureService, LicenseStatus
from services.operation_service import OperationService

from .error import NotInitValidateError, NotSetupError, UnauthorizedAndForceLogout

P = ParamSpec("P")
R = TypeVar("R")


def account_initialization_required(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        # check account initialization
        current_user, _ = current_account_with_tenant()
        if current_user.status == AccountStatus.UNINITIALIZED:
            raise AccountNotInitializedError()

        return view(*args, **kwargs)

    return decorated


def only_edition_cloud(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        if dify_config.EDITION != "CLOUD":
            abort(404)

        return view(*args, **kwargs)

    return decorated


def only_edition_enterprise(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        if not dify_config.ENTERPRISE_ENABLED:
            abort(404)

        return view(*args, **kwargs)

    return decorated


def only_edition_self_hosted(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        if dify_config.EDITION != "SELF_HOSTED":
            abort(404)

        return view(*args, **kwargs)

    return decorated


def cloud_edition_billing_enabled(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        _, current_tenant_id = current_account_with_tenant()
        features = FeatureService.get_features(current_tenant_id)
        if not features.billing.enabled:
            abort(403, "Billing feature is not enabled.")
        return view(*args, **kwargs)

    return decorated


def cloud_edition_billing_resource_check(resource: str):
    def interceptor(view: Callable[P, R]):
        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs):
            _, current_tenant_id = current_account_with_tenant()
            features = FeatureService.get_features(current_tenant_id)
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
    def interceptor(view: Callable[P, R]):
        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs):
            _, current_tenant_id = current_account_with_tenant()
            features = FeatureService.get_features(current_tenant_id)
            if features.billing.enabled:
                if resource == "add_segment":
                    if features.billing.subscription.plan == CloudPlan.SANDBOX:
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
    def interceptor(view: Callable[P, R]):
        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs):
            if resource == "knowledge":
                _, current_tenant_id = current_account_with_tenant()
                knowledge_rate_limit = FeatureService.get_knowledge_rate_limit(current_tenant_id)
                if knowledge_rate_limit.enabled:
                    current_time = int(time.time() * 1000)
                    key = f"rate_limit_{current_tenant_id}"

                    redis_client.zadd(key, {current_time: current_time})

                    redis_client.zremrangebyscore(key, 0, current_time - 60000)

                    request_count = redis_client.zcard(key)

                    if request_count > knowledge_rate_limit.limit:
                        # add ratelimit record
                        rate_limit_log = RateLimitLog(
                            tenant_id=current_tenant_id,
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


def cloud_utm_record(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        with contextlib.suppress(Exception):
            _, current_tenant_id = current_account_with_tenant()
            features = FeatureService.get_features(current_tenant_id)

            if features.billing.enabled:
                utm_info = request.cookies.get("utm_info")

                if utm_info:
                    utm_info_dict: dict = json.loads(utm_info)
                    OperationService.record_utm(current_tenant_id, utm_info_dict)

        return view(*args, **kwargs)

    return decorated


def setup_required(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
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


def enterprise_license_required(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        settings = FeatureService.get_system_features()
        if settings.license.status in [LicenseStatus.INACTIVE, LicenseStatus.EXPIRED, LicenseStatus.LOST]:
            raise UnauthorizedAndForceLogout("Your license is invalid. Please contact your administrator.")

        return view(*args, **kwargs)

    return decorated


def email_password_login_enabled(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        features = FeatureService.get_system_features()
        if features.enable_email_password_login:
            return view(*args, **kwargs)

        # otherwise, return 403
        abort(403)

    return decorated


def email_register_enabled(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        features = FeatureService.get_system_features()
        if features.is_allow_register:
            return view(*args, **kwargs)

        # otherwise, return 403
        abort(403)

    return decorated


def enable_change_email(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        features = FeatureService.get_system_features()
        if features.enable_change_email:
            return view(*args, **kwargs)

        # otherwise, return 403
        abort(403)

    return decorated


def is_allow_transfer_owner(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        _, current_tenant_id = current_account_with_tenant()
        features = FeatureService.get_features(current_tenant_id)
        if features.is_allow_transfer_workspace:
            return view(*args, **kwargs)

        # otherwise, return 403
        abort(403)

    return decorated


def knowledge_pipeline_publish_enabled(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        _, current_tenant_id = current_account_with_tenant()
        features = FeatureService.get_features(current_tenant_id)
        if features.knowledge_pipeline.publish_enabled:
            return view(*args, **kwargs)
        abort(403)

    return decorated


def edit_permission_required(f: Callable[P, R]):
    @wraps(f)
    def decorated_function(*args: P.args, **kwargs: P.kwargs):
        from werkzeug.exceptions import Forbidden

        from libs.login import current_user
        from models import Account

        user = current_user._get_current_object()  # type: ignore
        if not isinstance(user, Account):
            raise Forbidden()
        if not current_user.has_edit_permission:
            raise Forbidden()
        return f(*args, **kwargs)

    return decorated_function
