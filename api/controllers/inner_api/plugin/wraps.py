from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar, cast

from flask import current_app, request
from flask_login import user_logged_in
from flask_restx import reqparse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from extensions.ext_database import db
from libs.login import current_user
from models.account import Tenant
from models.model import DefaultEndUserSessionID, EndUser

P = ParamSpec("P")
R = TypeVar("R")


def get_user(tenant_id: str, user_id: str | None) -> EndUser:
    """
    Get current user

    NOTE: user_id is not trusted, it could be maliciously set to any value.
    As a result, it could only be considered as an end user id.
    """
    if not user_id:
        user_id = DefaultEndUserSessionID.DEFAULT_SESSION_ID
    is_anonymous = user_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID
    try:
        with Session(db.engine) as session:
            user_model = None

            if is_anonymous:
                user_model = (
                    session.query(EndUser)
                    .where(
                        EndUser.session_id == user_id,
                        EndUser.tenant_id == tenant_id,
                    )
                    .first()
                )
            else:
                user_model = (
                    session.query(EndUser)
                    .where(
                        EndUser.id == user_id,
                        EndUser.tenant_id == tenant_id,
                    )
                    .first()
                )

            if not user_model:
                user_model = EndUser(
                    tenant_id=tenant_id,
                    type="service_api",
                    is_anonymous=is_anonymous,
                    session_id=user_id,
                )
                session.add(user_model)
                session.commit()
                session.refresh(user_model)

    except Exception:
        raise ValueError("user not found")

    return user_model


def get_user_tenant(view: Callable[P, R] | None = None):
    def decorator(view_func: Callable[P, R]):
        @wraps(view_func)
        def decorated_view(*args: P.args, **kwargs: P.kwargs):
            # fetch json body
            parser = (
                reqparse.RequestParser()
                .add_argument("tenant_id", type=str, required=True, location="json")
                .add_argument("user_id", type=str, required=True, location="json")
            )

            p = parser.parse_args()

            user_id = cast(str, p.get("user_id"))
            tenant_id = cast(str, p.get("tenant_id"))

            if not tenant_id:
                raise ValueError("tenant_id is required")

            if not user_id:
                user_id = DefaultEndUserSessionID.DEFAULT_SESSION_ID

            try:
                tenant_model = (
                    db.session.query(Tenant)
                    .where(
                        Tenant.id == tenant_id,
                    )
                    .first()
                )
            except Exception:
                raise ValueError("tenant not found")

            if not tenant_model:
                raise ValueError("tenant not found")

            kwargs["tenant_model"] = tenant_model

            user = get_user(tenant_id, user_id)
            kwargs["user_model"] = user

            current_app.login_manager._update_request_context_with_user(user)  # type: ignore
            user_logged_in.send(current_app._get_current_object(), user=current_user)  # type: ignore

            return view_func(*args, **kwargs)

        return decorated_view

    if view is None:
        return decorator
    else:
        return decorator(view)


def plugin_data(view: Callable[P, R] | None = None, *, payload_type: type[BaseModel]):
    def decorator(view_func: Callable[P, R]):
        def decorated_view(*args: P.args, **kwargs: P.kwargs):
            try:
                data = request.get_json()
            except Exception:
                raise ValueError("invalid json")

            try:
                payload = payload_type.model_validate(data)
            except Exception as e:
                raise ValueError(f"invalid payload: {str(e)}")

            kwargs["payload"] = payload
            return view_func(*args, **kwargs)

        return decorated_view

    if view is None:
        return decorator
    else:
        return decorator(view)
