import contextlib
import json
import os
import time
from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

from flask import abort, request

from configs import dify_config
from controllers.console.auth.error import AuthenticationFailedError, EmailCodeError
from controllers.console.workspace.error import AccountNotInitializedError
from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.encryption import FieldEncryption
from libs.login import current_account_with_tenant
from models.account import AccountStatus
from models.dataset import RateLimitLog
from models.model import DifySetup
from services.feature_service import FeatureService, LicenseStatus
from services.operation_service import OperationService

from .error import NotInitValidateError, NotSetupError, UnauthorizedAndForceLogout

P = ParamSpec("P")
R = TypeVar("R")

# Field names for decryption
FIELD_NAME_PASSWORD = "password"
FIELD_NAME_CODE = "code"

# Error messages for decryption failures
ERROR_MSG_INVALID_ENCRYPTED_DATA = "Invalid encrypted data"
ERROR_MSG_INVALID_ENCRYPTED_CODE = "Invalid encrypted code"


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
        from libs.workspace_permission import check_workspace_owner_transfer_permission

        _, current_tenant_id = current_account_with_tenant()
        # Check both billing/plan level and workspace policy level permissions
        check_workspace_owner_transfer_permission(current_tenant_id)
        return view(*args, **kwargs)

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


def is_admin_or_owner_required(f: Callable[P, R]):
    @wraps(f)
    def decorated_function(*args: P.args, **kwargs: P.kwargs):
        from werkzeug.exceptions import Forbidden

        from libs.login import current_user
        from models import Account

        user = current_user._get_current_object()
        if not isinstance(user, Account) or not user.is_admin_or_owner:
            raise Forbidden()
        return f(*args, **kwargs)

    return decorated_function


def annotation_import_rate_limit(view: Callable[P, R]):
    """
    Rate limiting decorator for annotation import operations.

    Implements sliding window rate limiting with two tiers:
    - Short-term: Configurable requests per minute (default: 5)
    - Long-term: Configurable requests per hour (default: 20)

    Uses Redis ZSET for distributed rate limiting across multiple instances.
    """

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        _, current_tenant_id = current_account_with_tenant()
        current_time = int(time.time() * 1000)

        # Check per-minute rate limit
        minute_key = f"annotation_import_rate_limit:{current_tenant_id}:1min"
        redis_client.zadd(minute_key, {current_time: current_time})
        redis_client.zremrangebyscore(minute_key, 0, current_time - 60000)
        minute_count = redis_client.zcard(minute_key)
        redis_client.expire(minute_key, 120)  # 2 minutes TTL

        if minute_count > dify_config.ANNOTATION_IMPORT_RATE_LIMIT_PER_MINUTE:
            abort(
                429,
                f"Too many annotation import requests. Maximum {dify_config.ANNOTATION_IMPORT_RATE_LIMIT_PER_MINUTE} "
                f"requests per minute allowed. Please try again later.",
            )

        # Check per-hour rate limit
        hour_key = f"annotation_import_rate_limit:{current_tenant_id}:1hour"
        redis_client.zadd(hour_key, {current_time: current_time})
        redis_client.zremrangebyscore(hour_key, 0, current_time - 3600000)
        hour_count = redis_client.zcard(hour_key)
        redis_client.expire(hour_key, 7200)  # 2 hours TTL

        if hour_count > dify_config.ANNOTATION_IMPORT_RATE_LIMIT_PER_HOUR:
            abort(
                429,
                f"Too many annotation import requests. Maximum {dify_config.ANNOTATION_IMPORT_RATE_LIMIT_PER_HOUR} "
                f"requests per hour allowed. Please try again later.",
            )

        return view(*args, **kwargs)

    return decorated


def annotation_import_concurrency_limit(view: Callable[P, R]):
    """
    Concurrency control decorator for annotation import operations.

    Limits the number of concurrent import tasks per tenant to prevent
    resource exhaustion and ensure fair resource allocation.

    Uses Redis ZSET to track active import jobs with automatic cleanup
    of stale entries (jobs older than 2 minutes).
    """

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        _, current_tenant_id = current_account_with_tenant()
        current_time = int(time.time() * 1000)

        active_jobs_key = f"annotation_import_active:{current_tenant_id}"

        # Clean up stale entries (jobs that should have completed or timed out)
        stale_threshold = current_time - 120000  # 2 minutes ago
        redis_client.zremrangebyscore(active_jobs_key, 0, stale_threshold)

        # Check current active job count
        active_count = redis_client.zcard(active_jobs_key)

        if active_count >= dify_config.ANNOTATION_IMPORT_MAX_CONCURRENT:
            abort(
                429,
                f"Too many concurrent import tasks. Maximum {dify_config.ANNOTATION_IMPORT_MAX_CONCURRENT} "
                f"concurrent imports allowed per workspace. Please wait for existing imports to complete.",
            )

        # Allow the request to proceed
        # The actual job registration will happen in the service layer
        return view(*args, **kwargs)

    return decorated


def _decrypt_field(field_name: str, error_class: type[Exception], error_message: str) -> None:
    """
    Helper to decode a Base64 encoded field in the request payload.

    Args:
        field_name: Name of the field to decode
        error_class: Exception class to raise on decoding failure
        error_message: Error message to include in the exception
    """
    if not request or not request.is_json:
        return
    # Get the payload dict - it's cached and mutable
    payload = request.get_json()
    if not payload or field_name not in payload:
        return
    encoded_value = payload[field_name]
    decoded_value = FieldEncryption.decrypt_field(encoded_value)

    # If decoding failed, raise error immediately
    if decoded_value is None:
        raise error_class(error_message)

    # Update payload dict in-place with decoded value
    # Since payload is a mutable dict and get_json() returns the cached reference,
    # modifying it will affect all subsequent accesses including console_ns.payload
    payload[field_name] = decoded_value


def decrypt_password_field(view: Callable[P, R]):
    """
    Decorator to decrypt password field in request payload.

    Automatically decrypts the 'password' field if encryption is enabled.
    If decryption fails, raises AuthenticationFailedError.

    Usage:
        @decrypt_password_field
        def post(self):
            args = LoginPayload.model_validate(console_ns.payload)
            # args.password is now decrypted
    """

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        _decrypt_field(FIELD_NAME_PASSWORD, AuthenticationFailedError, ERROR_MSG_INVALID_ENCRYPTED_DATA)
        return view(*args, **kwargs)

    return decorated


def decrypt_code_field(view: Callable[P, R]):
    """
    Decorator to decrypt verification code field in request payload.

    Automatically decrypts the 'code' field if encryption is enabled.
    If decryption fails, raises EmailCodeError.

    Usage:
        @decrypt_code_field
        def post(self):
            args = EmailCodeLoginPayload.model_validate(console_ns.payload)
            # args.code is now decrypted
    """

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        _decrypt_field(FIELD_NAME_CODE, EmailCodeError, ERROR_MSG_INVALID_ENCRYPTED_CODE)
        return view(*args, **kwargs)

    return decorated
