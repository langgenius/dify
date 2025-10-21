import time
from collections.abc import Callable
from datetime import timedelta
from enum import StrEnum, auto
from functools import wraps
from typing import Concatenate, ParamSpec, TypeVar

from flask import current_app, request
from flask_login import user_logged_in
from flask_restx import Resource
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from libs.login import current_user
from models import Account, Tenant, TenantAccountJoin, TenantStatus
from models.dataset import Dataset, RateLimitLog
from models.model import ApiToken, App, DefaultEndUserSessionID, EndUser
from services.feature_service import FeatureService

P = ParamSpec("P")
R = TypeVar("R")
T = TypeVar("T")


class WhereisUserArg(StrEnum):
    """
    Enum for whereis_user_arg.
    """

    QUERY = auto()
    JSON = auto()
    FORM = auto()


class FetchUserArg(BaseModel):
    fetch_from: WhereisUserArg
    required: bool = False


def validate_app_token(view: Callable[P, R] | None = None, *, fetch_user_arg: FetchUserArg | None = None):
    def decorator(view_func: Callable[P, R]):
        @wraps(view_func)
        def decorated_view(*args: P.args, **kwargs: P.kwargs):
            api_token = validate_and_get_api_token("app")

            app_model = db.session.query(App).where(App.id == api_token.app_id).first()
            if not app_model:
                raise Forbidden("The app no longer exists.")

            if app_model.status != "normal":
                raise Forbidden("The app's status is abnormal.")

            if not app_model.enable_api:
                raise Forbidden("The app's API service has been disabled.")

            tenant = db.session.query(Tenant).where(Tenant.id == app_model.tenant_id).first()
            if tenant is None:
                raise ValueError("Tenant does not exist.")
            if tenant.status == TenantStatus.ARCHIVE:
                raise Forbidden("The workspace's status is archived.")

            kwargs["app_model"] = app_model

            if fetch_user_arg:
                if fetch_user_arg.fetch_from == WhereisUserArg.QUERY:
                    user_id = request.args.get("user")
                elif fetch_user_arg.fetch_from == WhereisUserArg.JSON:
                    user_id = request.get_json().get("user")
                elif fetch_user_arg.fetch_from == WhereisUserArg.FORM:
                    user_id = request.form.get("user")
                else:
                    # use default-user
                    user_id = None

                if not user_id and fetch_user_arg.required:
                    raise ValueError("Arg user must be provided.")

                if user_id:
                    user_id = str(user_id)

                end_user = create_or_update_end_user_for_user_id(app_model, user_id)
                kwargs["end_user"] = end_user

                # Set EndUser as current logged-in user for flask_login.current_user
                current_app.login_manager._update_request_context_with_user(end_user)  # type: ignore
                user_logged_in.send(current_app._get_current_object(), user=end_user)  # type: ignore

            return view_func(*args, **kwargs)

        return decorated_view

    if view is None:
        return decorator
    else:
        return decorator(view)


def cloud_edition_billing_resource_check(resource: str, api_token_type: str):
    def interceptor(view: Callable[P, R]):
        def decorated(*args: P.args, **kwargs: P.kwargs):
            api_token = validate_and_get_api_token(api_token_type)
            features = FeatureService.get_features(api_token.tenant_id)

            if features.billing.enabled:
                members = features.members
                apps = features.apps
                vector_space = features.vector_space
                documents_upload_quota = features.documents_upload_quota

                if resource == "members" and 0 < members.limit <= members.size:
                    raise Forbidden("The number of members has reached the limit of your subscription.")
                elif resource == "apps" and 0 < apps.limit <= apps.size:
                    raise Forbidden("The number of apps has reached the limit of your subscription.")
                elif resource == "vector_space" and 0 < vector_space.limit <= vector_space.size:
                    raise Forbidden("The capacity of the vector space has reached the limit of your subscription.")
                elif resource == "documents" and 0 < documents_upload_quota.limit <= documents_upload_quota.size:
                    raise Forbidden("The number of documents has reached the limit of your subscription.")
                else:
                    return view(*args, **kwargs)

            return view(*args, **kwargs)

        return decorated

    return interceptor


def cloud_edition_billing_knowledge_limit_check(resource: str, api_token_type: str):
    def interceptor(view: Callable[P, R]):
        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs):
            api_token = validate_and_get_api_token(api_token_type)
            features = FeatureService.get_features(api_token.tenant_id)
            if features.billing.enabled:
                if resource == "add_segment":
                    if features.billing.subscription.plan == "sandbox":
                        raise Forbidden(
                            "To unlock this feature and elevate your Dify experience, please upgrade to a paid plan."
                        )
                else:
                    return view(*args, **kwargs)

            return view(*args, **kwargs)

        return decorated

    return interceptor


def cloud_edition_billing_rate_limit_check(resource: str, api_token_type: str):
    def interceptor(view: Callable[P, R]):
        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs):
            api_token = validate_and_get_api_token(api_token_type)

            if resource == "knowledge":
                knowledge_rate_limit = FeatureService.get_knowledge_rate_limit(api_token.tenant_id)
                if knowledge_rate_limit.enabled:
                    current_time = int(time.time() * 1000)
                    key = f"rate_limit_{api_token.tenant_id}"

                    redis_client.zadd(key, {current_time: current_time})

                    redis_client.zremrangebyscore(key, 0, current_time - 60000)

                    request_count = redis_client.zcard(key)

                    if request_count > knowledge_rate_limit.limit:
                        # add ratelimit record
                        rate_limit_log = RateLimitLog(
                            tenant_id=api_token.tenant_id,
                            subscription_plan=knowledge_rate_limit.subscription_plan,
                            operation="knowledge",
                        )
                        db.session.add(rate_limit_log)
                        db.session.commit()
                        raise Forbidden(
                            "Sorry, you have reached the knowledge base request rate limit of your subscription."
                        )
            return view(*args, **kwargs)

        return decorated

    return interceptor


def validate_dataset_token(view: Callable[Concatenate[T, P], R] | None = None):
    def decorator(view: Callable[Concatenate[T, P], R]):
        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs):
            # get url path dataset_id from positional args or kwargs
            # Flask passes URL path parameters as positional arguments
            dataset_id = None

            # First try to get from kwargs (explicit parameter)
            dataset_id = kwargs.get("dataset_id")

            # If not in kwargs, try to extract from positional args
            if not dataset_id and args:
                # For class methods: args[0] is self, args[1] is dataset_id (if exists)
                # Check if first arg is likely a class instance (has __dict__ or __class__)
                if len(args) > 1 and hasattr(args[0], "__dict__"):
                    # This is a class method, dataset_id should be in args[1]
                    potential_id = args[1]
                    # Validate it's a string-like UUID, not another object
                    try:
                        # Try to convert to string and check if it's a valid UUID format
                        str_id = str(potential_id)
                        # Basic check: UUIDs are 36 chars with hyphens
                        if len(str_id) == 36 and str_id.count("-") == 4:
                            dataset_id = str_id
                    except:
                        pass
                elif len(args) > 0:
                    # Not a class method, check if args[0] looks like a UUID
                    potential_id = args[0]
                    try:
                        str_id = str(potential_id)
                        if len(str_id) == 36 and str_id.count("-") == 4:
                            dataset_id = str_id
                    except:
                        pass

            # Validate dataset if dataset_id is provided
            if dataset_id:
                dataset_id = str(dataset_id)
                dataset = db.session.query(Dataset).where(Dataset.id == dataset_id).first()
                if not dataset:
                    raise NotFound("Dataset not found.")
                if not dataset.enable_api:
                    raise Forbidden("Dataset api access is not enabled.")
            api_token = validate_and_get_api_token("dataset")
            tenant_account_join = (
                db.session.query(Tenant, TenantAccountJoin)
                .where(Tenant.id == api_token.tenant_id)
                .where(TenantAccountJoin.tenant_id == Tenant.id)
                .where(TenantAccountJoin.role.in_(["owner"]))
                .where(Tenant.status == TenantStatus.NORMAL)
                .one_or_none()
            )  # TODO: only owner information is required, so only one is returned.
            if tenant_account_join:
                tenant, ta = tenant_account_join
                account = db.session.query(Account).where(Account.id == ta.account_id).first()
                # Login admin
                if account:
                    account.current_tenant = tenant
                    current_app.login_manager._update_request_context_with_user(account)  # type: ignore
                    user_logged_in.send(current_app._get_current_object(), user=current_user)  # type: ignore
                else:
                    raise Unauthorized("Tenant owner account does not exist.")
            else:
                raise Unauthorized("Tenant does not exist.")
            return view(api_token.tenant_id, *args, **kwargs)

        return decorated

    if view:
        return decorator(view)

    # if view is None, it means that the decorator is used without parentheses
    # use the decorator as a function for method_decorators
    return decorator


def validate_and_get_api_token(scope: str | None = None):
    """
    Validate and get API token.
    """
    auth_header = request.headers.get("Authorization")
    if auth_header is None or " " not in auth_header:
        raise Unauthorized("Authorization header must be provided and start with 'Bearer'")

    auth_scheme, auth_token = auth_header.split(None, 1)
    auth_scheme = auth_scheme.lower()

    if auth_scheme != "bearer":
        raise Unauthorized("Authorization scheme must be 'Bearer'")

    current_time = naive_utc_now()
    cutoff_time = current_time - timedelta(minutes=1)
    with Session(db.engine, expire_on_commit=False) as session:
        update_stmt = (
            update(ApiToken)
            .where(
                ApiToken.token == auth_token,
                (ApiToken.last_used_at.is_(None) | (ApiToken.last_used_at < cutoff_time)),
                ApiToken.type == scope,
            )
            .values(last_used_at=current_time)
            .returning(ApiToken)
        )
        result = session.execute(update_stmt)
        api_token = result.scalar_one_or_none()

        if not api_token:
            stmt = select(ApiToken).where(ApiToken.token == auth_token, ApiToken.type == scope)
            api_token = session.scalar(stmt)
            if not api_token:
                raise Unauthorized("Access token is invalid")
        else:
            session.commit()

    return api_token


def create_or_update_end_user_for_user_id(app_model: App, user_id: str | None = None) -> EndUser:
    """
    Create or update session terminal based on user ID.
    """
    if not user_id:
        user_id = DefaultEndUserSessionID.DEFAULT_SESSION_ID

    with Session(db.engine, expire_on_commit=False) as session:
        end_user = (
            session.query(EndUser)
            .where(
                EndUser.tenant_id == app_model.tenant_id,
                EndUser.app_id == app_model.id,
                EndUser.session_id == user_id,
                EndUser.type == "service_api",
            )
            .first()
        )

        if end_user is None:
            end_user = EndUser(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                type="service_api",
                is_anonymous=user_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID,
                session_id=user_id,
            )
            session.add(end_user)
            session.commit()

    return end_user


class DatasetApiResource(Resource):
    method_decorators = [validate_dataset_token]

    def get_dataset(self, dataset_id: str, tenant_id: str) -> Dataset:
        dataset = db.session.query(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id).first()

        if not dataset:
            raise NotFound("Dataset not found.")

        return dataset
