from collections.abc import Callable
from functools import wraps

from flask import current_app, request
from flask_login import user_logged_in
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from extensions.ext_database import db
from libs.login import current_user
from models.account import Tenant
from models.enums import EndUserType
from models.model import DefaultEndUserSessionID, EndUser


class TenantUserPayload(BaseModel):
    tenant_id: str
    user_id: str


def get_user(tenant_id: str, user_id: str | None) -> EndUser:
    """
    Get current user.

    NOTE: user_id is not trusted, it could be maliciously set to any value.
    As a result, it could only be considered as an end user id. Even when a
    concrete end-user ID is supplied, lookups must stay tenant-scoped so one
    tenant cannot bind another tenant's user record into the plugin request
    context.
    """
    if not user_id:
        user_id = DefaultEndUserSessionID.DEFAULT_SESSION_ID
    is_anonymous = user_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID
    try:
        with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
            user_model = None

            if is_anonymous:
                user_model = session.scalar(
                    select(EndUser)
                    .where(
                        EndUser.session_id == user_id,
                        EndUser.tenant_id == tenant_id,
                    )
                    .limit(1)
                )
            else:
                # Try id first (preserves the original "explicit end-user
                # id → that specific user" semantics for callers that pass
                # a known EndUser.id). Fall back to session_id so daemon-
                # supplied session UUIDs dedup against the row created on
                # the first Reverse Invocation call — without this, an
                # id-only lookup never matched (create writes user_id to
                # session_id, id is auto-generated) and a fresh EndUser
                # was created per call, breaking multi-turn chat
                # continuation (see #36736).
                user_model = session.scalar(
                    select(EndUser)
                    .where(
                        EndUser.id == user_id,
                        EndUser.tenant_id == tenant_id,
                    )
                    .limit(1)
                )
                if user_model is None:
                    user_model = session.scalar(
                        select(EndUser)
                        .where(
                            EndUser.session_id == user_id,
                            EndUser.tenant_id == tenant_id,
                        )
                        .limit(1)
                    )

            if not user_model:
                user_model = EndUser(
                    tenant_id=tenant_id,
                    type=EndUserType.SERVICE_API,
                    is_anonymous=is_anonymous,
                    session_id=user_id,
                )
                session.add(user_model)
                session.flush()
                session.refresh(user_model)

    except Exception:
        raise ValueError("user not found")

    return user_model


def get_user_tenant[**P, R](view_func: Callable[P, R]) -> Callable[P, R]:
    @wraps(view_func)
    def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
        payload = TenantUserPayload.model_validate(request.get_json(silent=True) or {})

        user_id = payload.user_id
        tenant_id = payload.tenant_id

        if not tenant_id:
            raise ValueError("tenant_id is required")

        if not user_id:
            user_id = DefaultEndUserSessionID.DEFAULT_SESSION_ID

        tenant_model = db.session.get(Tenant, tenant_id)

        if not tenant_model:
            raise ValueError("tenant not found")

        kwargs["tenant_model"] = tenant_model

        user = get_user(tenant_id, user_id)
        kwargs["user_model"] = user

        current_app.login_manager._update_request_context_with_user(user)  # type: ignore
        user_logged_in.send(current_app._get_current_object(), user=current_user)  # type: ignore

        return view_func(*args, **kwargs)

    return decorated_view


def plugin_data[**P, R](
    *,
    payload_type: type[BaseModel],
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    def decorator(view_func: Callable[P, R]) -> Callable[P, R]:
        @wraps(view_func)
        def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
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

    return decorator
