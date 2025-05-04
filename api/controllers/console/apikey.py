from typing import Any

import flask_restful
from flask_login import current_user
from flask_restful import Resource, fields, marshal_with
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from extensions.ext_database import db
from libs.helper import TimestampField
from libs.login import login_required
from models.dataset import Dataset
from models.model import ApiToken, App

from . import api
from .wraps import account_initialization_required, setup_required

api_key_fields = {
    "id": fields.String,
    "type": fields.String,
    "token": fields.String,
    "last_used_at": TimestampField,
    "created_at": TimestampField,
}

api_key_list = {"data": fields.List(fields.Nested(api_key_fields), attribute="items")}


def _get_resource(resource_id, tenant_id, resource_model):
    if resource_model == App:
        with Session(db.engine) as session:
            resource = session.execute(
                select(resource_model).filter_by(id=resource_id, tenant_id=tenant_id)
            ).scalar_one_or_none()
    else:
        with Session(db.engine) as session:
            resource = session.execute(
                select(resource_model).filter_by(id=resource_id, tenant_id=tenant_id)
            ).scalar_one_or_none()

    if resource is None:
        flask_restful.abort(404, message=f"{resource_model.__name__} not found.")

    return resource


class BaseApiKeyListResource(Resource):
    method_decorators = [account_initialization_required, login_required, setup_required]

    resource_type: str | None = None
    resource_model: Any = None
    resource_id_field: str | None = None
    token_prefix: str | None = None
    max_keys = 10

    @marshal_with(api_key_list)
    def get(self, resource_id):
        assert self.resource_id_field is not None, "resource_id_field must be set"
        resource_id = str(resource_id)
        _get_resource(resource_id, current_user.current_tenant_id, self.resource_model)
        keys = (
            db.session.query(ApiToken)
            .filter(ApiToken.type == self.resource_type, getattr(ApiToken, self.resource_id_field) == resource_id)
            .all()
        )
        return {"items": keys}

    @marshal_with(api_key_fields)
    def post(self, resource_id):
        assert self.resource_id_field is not None, "resource_id_field must be set"
        resource_id = str(resource_id)
        _get_resource(resource_id, current_user.current_tenant_id, self.resource_model)
        if not current_user.is_editor:
            raise Forbidden()

        current_key_count = (
            db.session.query(ApiToken)
            .filter(ApiToken.type == self.resource_type, getattr(ApiToken, self.resource_id_field) == resource_id)
            .count()
        )

        if current_key_count >= self.max_keys:
            flask_restful.abort(
                400,
                message=f"Cannot create more than {self.max_keys} API keys for this resource type.",
                code="max_keys_exceeded",
            )

        key = ApiToken.generate_api_key(self.token_prefix, 24)
        api_token = ApiToken()
        setattr(api_token, self.resource_id_field, resource_id)
        api_token.tenant_id = current_user.current_tenant_id
        api_token.token = key
        api_token.type = self.resource_type
        db.session.add(api_token)
        db.session.commit()
        return api_token, 201


class BaseApiKeyResource(Resource):
    method_decorators = [account_initialization_required, login_required, setup_required]

    resource_type: str | None = None
    resource_model: Any = None
    resource_id_field: str | None = None

    def delete(self, resource_id, api_key_id):
        assert self.resource_id_field is not None, "resource_id_field must be set"
        resource_id = str(resource_id)
        api_key_id = str(api_key_id)
        _get_resource(resource_id, current_user.current_tenant_id, self.resource_model)

        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        key = (
            db.session.query(ApiToken)
            .filter(
                getattr(ApiToken, self.resource_id_field) == resource_id,
                ApiToken.type == self.resource_type,
                ApiToken.id == api_key_id,
            )
            .first()
        )

        if key is None:
            flask_restful.abort(404, message="API key not found")

        db.session.query(ApiToken).filter(ApiToken.id == api_key_id).delete()
        db.session.commit()

        return {"result": "success"}, 204


class AppApiKeyListResource(BaseApiKeyListResource):
    def after_request(self, resp):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        return resp

    resource_type = "app"
    resource_model = App
    resource_id_field = "app_id"
    token_prefix = "app-"


class AppApiKeyResource(BaseApiKeyResource):
    def after_request(self, resp):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        return resp

    resource_type = "app"
    resource_model = App
    resource_id_field = "app_id"


class DatasetApiKeyListResource(BaseApiKeyListResource):
    def after_request(self, resp):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        return resp

    resource_type = "dataset"
    resource_model = Dataset
    resource_id_field = "dataset_id"
    token_prefix = "ds-"


class DatasetApiKeyResource(BaseApiKeyResource):
    def after_request(self, resp):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        return resp

    resource_type = "dataset"
    resource_model = Dataset
    resource_id_field = "dataset_id"


api.add_resource(AppApiKeyListResource, "/apps/<uuid:resource_id>/api-keys")
api.add_resource(AppApiKeyResource, "/apps/<uuid:resource_id>/api-keys/<uuid:api_key_id>")
api.add_resource(DatasetApiKeyListResource, "/datasets/<uuid:resource_id>/api-keys")
api.add_resource(DatasetApiKeyResource, "/datasets/<uuid:resource_id>/api-keys/<uuid:api_key_id>")
