import flask_restx
from flask_restx import Resource, fields, marshal_with
from flask_restx._http import HTTPStatus
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from extensions.ext_database import db
from libs.helper import TimestampField
from libs.login import current_account_with_tenant, login_required
from models.dataset import Dataset
from models.model import ApiToken, App

from . import api, console_ns
from .wraps import account_initialization_required, edit_permission_required, setup_required

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


class BaseApiKeyListResource(Resource):
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
        _, current_tenant_id = current_account_with_tenant()

        _get_resource(resource_id, current_tenant_id, self.resource_model)
        keys = db.session.scalars(
            select(ApiToken).where(
                ApiToken.type == self.resource_type, getattr(ApiToken, self.resource_id_field) == resource_id
            )
        ).all()
        return {"items": keys}

    @marshal_with(api_key_fields)
    @edit_permission_required
    def post(self, resource_id):
        assert self.resource_id_field is not None, "resource_id_field must be set"
        resource_id = str(resource_id)
        _, current_tenant_id = current_account_with_tenant()
        _get_resource(resource_id, current_tenant_id, self.resource_model)
        current_key_count = (
            db.session.query(ApiToken)
            .where(ApiToken.type == self.resource_type, getattr(ApiToken, self.resource_id_field) == resource_id)
            .count()
        )

        if current_key_count >= self.max_keys:
            flask_restx.abort(
                HTTPStatus.BAD_REQUEST,
                message=f"Cannot create more than {self.max_keys} API keys for this resource type.",
                custom="max_keys_exceeded",
            )

        key = ApiToken.generate_api_key(self.token_prefix or "", 24)
        api_token = ApiToken()
        setattr(api_token, self.resource_id_field, resource_id)
        api_token.tenant_id = current_tenant_id
        api_token.token = key
        api_token.type = self.resource_type
        db.session.add(api_token)
        db.session.commit()
        return api_token, 201


class BaseApiKeyResource(Resource):
    method_decorators = [account_initialization_required, login_required, setup_required]

    resource_type: str | None = None
    resource_model: type | None = None
    resource_id_field: str | None = None

    def delete(self, resource_id, api_key_id):
        assert self.resource_id_field is not None, "resource_id_field must be set"
        resource_id = str(resource_id)
        api_key_id = str(api_key_id)
        current_user, current_tenant_id = current_account_with_tenant()
        _get_resource(resource_id, current_tenant_id, self.resource_model)

        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        key = (
            db.session.query(ApiToken)
            .where(
                getattr(ApiToken, self.resource_id_field) == resource_id,
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

    resource_type = "app"
    resource_model = App
    resource_id_field = "app_id"


@console_ns.route("/datasets/<uuid:resource_id>/api-keys")
class DatasetApiKeyListResource(BaseApiKeyListResource):
    @api.doc("get_dataset_api_keys")
    @api.doc(description="Get all API keys for a dataset")
    @api.doc(params={"resource_id": "Dataset ID"})
    @api.response(200, "Success", api_key_list)
    def get(self, resource_id):
        """Get all API keys for a dataset"""
        return super().get(resource_id)

    @api.doc("create_dataset_api_key")
    @api.doc(description="Create a new API key for a dataset")
    @api.doc(params={"resource_id": "Dataset ID"})
    @api.response(201, "API key created successfully", api_key_fields)
    @api.response(400, "Maximum keys exceeded")
    def post(self, resource_id):
        """Create a new API key for a dataset"""
        return super().post(resource_id)

    resource_type = "dataset"
    resource_model = Dataset
    resource_id_field = "dataset_id"
    token_prefix = "ds-"


@console_ns.route("/datasets/<uuid:resource_id>/api-keys/<uuid:api_key_id>")
class DatasetApiKeyResource(BaseApiKeyResource):
    @api.doc("delete_dataset_api_key")
    @api.doc(description="Delete an API key for a dataset")
    @api.doc(params={"resource_id": "Dataset ID", "api_key_id": "API key ID"})
    @api.response(204, "API key deleted successfully")
    def delete(self, resource_id, api_key_id):
        """Delete an API key for a dataset"""
        return super().delete(resource_id, api_key_id)

    resource_type = "dataset"
    resource_model = Dataset
    resource_id_field = "dataset_id"
