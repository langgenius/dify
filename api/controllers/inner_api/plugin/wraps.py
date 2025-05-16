from collections.abc import Callable
from functools import wraps
from typing import Optional

from flask import request
from flask_restful import reqparse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from extensions.ext_database import db
from models.account import Account, Tenant
from models.model import EndUser
from services.account_service import AccountService


def get_user(tenant_id: str, user_id: str | None) -> Account | EndUser:
    try:
        with Session(db.engine) as session:
            if not user_id:
                user_id = "DEFAULT-USER"

            if user_id == "DEFAULT-USER":
                user_model = session.query(EndUser).filter(EndUser.session_id == "DEFAULT-USER").first()
                if not user_model:
                    user_model = EndUser(
                        tenant_id=tenant_id,
                        type="service_api",
                        is_anonymous=True if user_id == "DEFAULT-USER" else False,
                        session_id=user_id,
                    )
                    session.add(user_model)
                    session.commit()
            else:
                user_model = AccountService.load_user(user_id)
                if not user_model:
                    user_model = session.query(EndUser).filter(EndUser.id == user_id).first()
                if not user_model:
                    raise ValueError("user not found")
    except Exception:
        raise ValueError("user not found")

    return user_model


def get_user_tenant(view: Optional[Callable] = None):
    def decorator(view_func):
        @wraps(view_func)
        def decorated_view(*args, **kwargs):
            # fetch json body
            parser = reqparse.RequestParser()
            parser.add_argument("tenant_id", type=str, required=True, location="json")
            parser.add_argument("user_id", type=str, required=True, location="json")

            kwargs = parser.parse_args()

            user_id = kwargs.get("user_id")
            tenant_id = kwargs.get("tenant_id")

            if not tenant_id:
                raise ValueError("tenant_id is required")

            if not user_id:
                user_id = "DEFAULT-USER"

            del kwargs["tenant_id"]
            del kwargs["user_id"]

            try:
                tenant_model = (
                    db.session.query(Tenant)
                    .filter(
                        Tenant.id == tenant_id,
                    )
                    .first()
                )
            except Exception:
                raise ValueError("tenant not found")

            if not tenant_model:
                raise ValueError("tenant not found")

            kwargs["tenant_model"] = tenant_model
            kwargs["user_model"] = get_user(tenant_id, user_id)

            return view_func(*args, **kwargs)

        return decorated_view

    if view is None:
        return decorator
    else:
        return decorator(view)


def plugin_data(view: Optional[Callable] = None, *, payload_type: type[BaseModel]):
    def decorator(view_func):
        def decorated_view(*args, **kwargs):
            try:
                data = request.get_json()
            except Exception:
                raise ValueError("invalid json")

            try:
                payload = payload_type(**data)
            except Exception as e:
                raise ValueError(f"invalid payload: {str(e)}")

            kwargs["payload"] = payload
            return view_func(*args, **kwargs)

        return decorated_view

    if view is None:
        return decorator
    else:
        return decorator(view)
