from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from enum import Enum
from functools import wraps
from typing import Optional

from flask import current_app, request
from flask_login import user_logged_in  # type: ignore
from flask_restful import Resource  # type: ignore
from pydantic import BaseModel  # type: ignore
from sqlalchemy import select, update  # type: ignore
from sqlalchemy.orm import Session  # type: ignore
from werkzeug.exceptions import Forbidden, Unauthorized

from configs import dify_config
from extensions.ext_database import db
from libs.login import _get_user
from libs.passport import PassportService
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountJoinRole, TenantStatus
from models.model import ApiToken, App, EndUser
from services.account_service import AccountService
from services.end_user_service import EndUserService
from services.feature_service import FeatureService


class WhereisUserArg(Enum):
    """
    Enum for whereis_user_arg.
    """

    QUERY = "query"
    JSON = "json"
    FORM = "form"


class FetchUserArg(BaseModel):
    fetch_from: WhereisUserArg
    required: bool = False


def validate_user_token_and_extract_info(view: Optional[Callable] = None):
    def decorator(view_func):
        @wraps(view_func)
        def decorated_view(*args, **kwargs):
            # Extract user info from Bearer token
            auth_header = request.headers.get("Authorization")
            if auth_header is None or " " not in auth_header:
                raise Unauthorized("Authorization header must be provided and start with 'Bearer'")

            auth_scheme, auth_token = auth_header.split(None, 1)
            auth_scheme = auth_scheme.lower()

            if auth_scheme != "bearer":
                raise Unauthorized("Authorization scheme must be 'Bearer'")

            # Decode the JWT token to extract user info
            try:
                decoded = PassportService().verify(auth_token)
                user_id = decoded.get("user_id")
            except Exception as e:
                raise Unauthorized(f"Failed to extract user_id from token: {str(e)}")

            if not user_id:
                raise Unauthorized("Invalid token: missing user_id")

            account = AccountService.load_user(user_id)
            if account is None:
                raise Unauthorized("Invalid token: user not found")
            if account.status != AccountStatus.ACTIVE:
                raise Unauthorized("Invalid token: account is not active")
            if account.current_role != TenantAccountJoinRole.END_USER.value:
                raise Unauthorized("Invalid token: account is not end user")

            app_id = request.headers.get("X-App-Id")
            if not app_id:
                app_id = dify_config.DEFAULT_APP_ID

            app_model = db.session.query(App).filter(App.id == app_id).first()

            if not app_model:
                raise Forbidden("The app no longer exists.")

            if app_model.status != "normal":
                raise Forbidden("The app's status is abnormal.")

            if not app_model.enable_api:
                raise Forbidden("The app's API service has been disabled.")

            tenant = db.session.query(Tenant).filter(Tenant.id == app_model.tenant_id).first()
            if tenant is None:
                raise ValueError("Tenant does not exist.")
            if tenant.status == TenantStatus.ARCHIVE:
                raise Forbidden("The workspace's status is archived.")

            kwargs["app_model"] = app_model

            kwargs["end_user"] = create_or_update_end_user_for_user_id(app_model, account.id)

            return view_func(*args, **kwargs)

        return decorated_view

    if view is None:
        return decorator
    else:
        return decorator(view)


def cloud_edition_billing_resource_check(resource: str, api_token_type: str):
    def interceptor(view):
        def decorated(*args, **kwargs):
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
    def interceptor(view):
        @wraps(view)
        def decorated(*args, **kwargs):
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


def validate_dataset_token(view=None):
    def decorator(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            api_token = validate_and_get_api_token("dataset")
            tenant_account_join = (
                db.session.query(Tenant, TenantAccountJoin)
                .filter(Tenant.id == api_token.tenant_id)
                .filter(TenantAccountJoin.tenant_id == Tenant.id)
                .filter(TenantAccountJoin.role.in_(["owner"]))
                .filter(Tenant.status == TenantStatus.NORMAL)
                .one_or_none()
            )  # TODO: only owner information is required, so only one is returned.
            if tenant_account_join:
                tenant, ta = tenant_account_join
                account = Account.query.filter_by(id=ta.account_id).first()
                # Login admin
                if account:
                    account.current_tenant = tenant
                    current_app.login_manager._update_request_context_with_user(account)  # type: ignore
                    user_logged_in.send(current_app._get_current_object(), user=_get_user())  # type: ignore
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

    current_time = datetime.now(UTC).replace(tzinfo=None)
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


def create_or_update_end_user_for_user_id(app_model: App, user_id: Optional[str] = None) -> EndUser:
    """
    Create or update session terminal based on user ID.
    """
    if not user_id:
        user_id = "DEFAULT-USER"

    # Use EndUserService to get or create end user with organization awareness
    return EndUserService.get_or_create_end_user(app_model, user_id)


class DatasetApiResource(Resource):
    method_decorators = [validate_dataset_token]
