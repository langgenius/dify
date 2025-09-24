import flask_restx
from flask_login import current_user
from flask_restx import Resource, fields, marshal_with
from flask_restx._http import HTTPStatus
from sqlalchemy import Column, select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from extensions.ext_database import db
from libs.helper import TimestampField
from libs.login import login_required
from models.model import ApiToken, App

from . import api, console_ns
from .wraps import account_initialization_required, setup_required

# Field mapping for ApiToken attributes to avoid getattr reflection
API_TOKEN_RESOURCE_FIELD_MAP: dict[str, Column] = {
    "app_id": ApiToken.app_id,
    # Note: ApiToken model does not have dataset_id field
    # Dataset API keys are managed by tenant_id in a separate implementation
}


class ApiTokenResourceFieldMixin:
    """Mixin class providing safe field mapping for ApiToken resources."""

    resource_id_field: str | None = None

    def _get_resource_field(self):
        """
        Get the ApiToken field for the current resource type.

        Replaces getattr(ApiToken, self.resource_id_field) with safer dictionary lookup.

        Returns:
            The ApiToken field for querying

        Raises:
            ValueError: If resource_id_field is not supported
        """
        if self.resource_id_field is None:
            raise ValueError("resource_id_field must be set")

        if self.resource_id_field not in API_TOKEN_RESOURCE_FIELD_MAP:
            raise ValueError(
                f"Unsupported resource_id_field: {self.resource_id_field}. "
                f"Supported fields: {list(API_TOKEN_RESOURCE_FIELD_MAP.keys())}"
            )

        return API_TOKEN_RESOURCE_FIELD_MAP[self.resource_id_field]


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
        flask_restx.abort(HTTPStatus.NOT_FOUND, message=f"{resource_model.__name__} not found.")

    return resource


class BaseApiKeyListResource(Resource, ApiTokenResourceFieldMixin):
    method_decorators = [account_initialization_required, login_required, setup_required]

    resource_type: str | None = None
    resource_model: type | None = None
    resource_id_field: str | None = None
    token_prefix: str | None = None
    max_keys = 10

    @marshal_with(api_key_list)
    def get(self, resource_id):
        assert self.resource_id_field is not None, "resource_id_field must be set"
        resource_id = str(resource_id)
        _get_resource(resource_id, current_user.current_tenant_id, self.resource_model)
        resource_field = self._get_resource_field()
        keys = db.session.scalars(
            select(ApiToken).where(ApiToken.type == self.resource_type, resource_field == resource_id)
        ).all()
        return {"items": keys}

    @marshal_with(api_key_fields)
    def post(self, resource_id):
        assert self.resource_id_field is not None, "resource_id_field must be set"
        resource_id = str(resource_id)
        _get_resource(resource_id, current_user.current_tenant_id, self.resource_model)
        if not current_user.is_editor:
            raise Forbidden()

        resource_field = self._get_resource_field()
        current_key_count = (
            db.session.query(ApiToken).where(ApiToken.type == self.resource_type, resource_field == resource_id).count()
        )

        if current_key_count >= self.max_keys:
            flask_restx.abort(
                HTTPStatus.BAD_REQUEST,
                message=f"Cannot create more than {self.max_keys} API keys for this resource type.",
                custom="max_keys_exceeded",
            )

        key = ApiToken.generate_api_key(self.token_prefix or "", 24)
        api_token = ApiToken()

        # Use safe field mapping instead of setattr reflection
        # resource_field already validated in _get_resource_field() call above
        if self.resource_id_field == "app_id":
            api_token.app_id = resource_id
        else:
            # This should not happen due to validation in _get_resource_field
            raise ValueError(f"Unsupported resource_id_field for setattr: {self.resource_id_field}")

        api_token.tenant_id = current_user.current_tenant_id
        api_token.token = key
        api_token.type = self.resource_type
        db.session.add(api_token)
        db.session.commit()
        return api_token, 201


class BaseApiKeyResource(Resource, ApiTokenResourceFieldMixin):
    method_decorators = [account_initialization_required, login_required, setup_required]

    resource_type: str | None = None
    resource_model: type | None = None
    resource_id_field: str | None = None

    def delete(self, resource_id, api_key_id):
        assert self.resource_id_field is not None, "resource_id_field must be set"
        resource_id = str(resource_id)
        api_key_id = str(api_key_id)
        _get_resource(resource_id, current_user.current_tenant_id, self.resource_model)

        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        resource_field = self._get_resource_field()
        key = (
            db.session.query(ApiToken)
            .where(
                resource_field == resource_id,
                ApiToken.type == self.resource_type,
                ApiToken.id == api_key_id,
            )
            .first()
        )

        if key is None:
            flask_restx.abort(HTTPStatus.NOT_FOUND, message="API key not found")

        db.session.query(ApiToken).where(ApiToken.id == api_key_id).delete()
        db.session.commit()

        return {"result": "success"}, 204


@console_ns.route("/apps/<uuid:resource_id>/api-keys")
class AppApiKeyListResource(BaseApiKeyListResource):
    @api.doc("get_app_api_keys")
    @api.doc(description="Get all API keys for an app")
    @api.doc(params={"resource_id": "App ID"})
    @api.response(200, "Success", api_key_list)
    def get(self, resource_id):
        """Get all API keys for an app"""
        return super().get(resource_id)

    @api.doc("create_app_api_key")
    @api.doc(description="Create a new API key for an app")
    @api.doc(params={"resource_id": "App ID"})
    @api.response(201, "API key created successfully", api_key_fields)
    @api.response(400, "Maximum keys exceeded")
    def post(self, resource_id):
        """Create a new API key for an app"""
        return super().post(resource_id)

    def after_request(self, resp):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        return resp

    resource_type = "app"
    resource_model = App
    resource_id_field = "app_id"
    token_prefix = "app-"


@console_ns.route("/apps/<uuid:resource_id>/api-keys/<uuid:api_key_id>")
class AppApiKeyResource(BaseApiKeyResource):
    @api.doc("delete_app_api_key")
    @api.doc(description="Delete an API key for an app")
    @api.doc(params={"resource_id": "App ID", "api_key_id": "API key ID"})
    @api.response(204, "API key deleted successfully")
    def delete(self, resource_id, api_key_id):
        """Delete an API key for an app"""
        return super().delete(resource_id, api_key_id)

    def after_request(self, resp):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        return resp

    resource_type = "app"
    resource_model = App
    resource_id_field = "app_id"
