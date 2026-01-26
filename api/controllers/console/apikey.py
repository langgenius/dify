from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from controllers.fastopenapi import console_router
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models.dataset import Dataset
from models.model import ApiToken, App

from .wraps import account_initialization_required, edit_permission_required, setup_required

MAX_KEYS = 10
APP_RESOURCE_TYPE = "app"
DATASET_RESOURCE_TYPE = "dataset"
APP_TOKEN_PREFIX = "app-"
DATASET_TOKEN_PREFIX = "ds-"
APP_RESOURCE_ID_FIELD = "app_id"
DATASET_RESOURCE_ID_FIELD = "dataset_id"


class ResponseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="ignore")


def _to_timestamp(value: datetime | int | None) -> int | None:
    if isinstance(value, datetime):
        return int(value.timestamp())
    return value


class ApiKeyItem(ResponseModel):
    id: str = Field(description="API key id")
    type: str = Field(description="API key type")
    token: str = Field(description="API token")
    last_used_at: int | None = Field(default=None, description="Last used timestamp")
    created_at: int = Field(description="Creation timestamp")

    @field_validator("last_used_at", "created_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


class ApiKeyListResponse(ResponseModel):
    data: list[ApiKeyItem] = Field(description="API key list")


class DeleteResponse(ResponseModel):
    result: str = Field(description="Operation result", examples=["success"])


def _get_resource(resource_id: str, tenant_id: str, resource_model: type[App] | type[Dataset]):
    if resource_model == App:
        with Session(db.engine) as session:
            resource = session.execute(select(App).filter_by(id=resource_id, tenant_id=tenant_id)).scalar_one_or_none()
    else:
        with Session(db.engine) as session:
            resource = session.execute(
                select(Dataset).filter_by(id=resource_id, tenant_id=tenant_id)
            ).scalar_one_or_none()

    if resource is None:
        raise NotFound(description=f"{resource_model.__name__} not found.")

    return resource


def _build_api_key_item(api_token: ApiToken) -> ApiKeyItem:
    return ApiKeyItem.model_validate(api_token, from_attributes=True)


def _build_api_key_list(api_tokens: Sequence[ApiToken]) -> ApiKeyListResponse:
    items = [_build_api_key_item(api_token) for api_token in api_tokens]
    return ApiKeyListResponse(data=items)


def _list_api_keys(resource_id: str, resource_type: str, resource_id_field: str) -> Sequence[ApiToken]:
    return db.session.scalars(
        select(ApiToken).where(ApiToken.type == resource_type, getattr(ApiToken, resource_id_field) == resource_id)
    ).all()


def _create_api_key(
    resource_id: str,
    *,
    resource_type: str,
    resource_id_field: str,
    token_prefix: str,
    tenant_id: str,
) -> ApiToken:
    current_key_count = (
        db.session.query(ApiToken)
        .where(ApiToken.type == resource_type, getattr(ApiToken, resource_id_field) == resource_id)
        .count()
    )

    if current_key_count >= MAX_KEYS:
        raise BadRequest(description=f"Cannot create more than {MAX_KEYS} API keys for this resource type.")

    key = ApiToken.generate_api_key(token_prefix, 24)
    api_token = ApiToken()
    setattr(api_token, resource_id_field, resource_id)
    api_token.tenant_id = tenant_id
    api_token.token = key
    api_token.type = resource_type
    db.session.add(api_token)
    db.session.commit()
    return api_token


def _delete_api_key(
    resource_id: str,
    api_key_id: str,
    *,
    resource_type: str,
    resource_id_field: str,
) -> None:
    key = (
        db.session.query(ApiToken)
        .where(
            getattr(ApiToken, resource_id_field) == resource_id,
            ApiToken.type == resource_type,
            ApiToken.id == api_key_id,
        )
        .first()
    )

    if key is None:
        raise NotFound(description="API key not found")

    db.session.query(ApiToken).where(ApiToken.id == api_key_id).delete()
    db.session.commit()


@console_router.get(
    "/apps/<uuid:resource_id>/api-keys",
    response_model=ApiKeyListResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
def get_app_api_keys(resource_id: UUID) -> ApiKeyListResponse:
    """Get all API keys for an app."""
    resource_id_value = str(resource_id)
    _, current_tenant_id = current_account_with_tenant()

    _get_resource(resource_id_value, current_tenant_id, App)
    keys = _list_api_keys(resource_id_value, APP_RESOURCE_TYPE, APP_RESOURCE_ID_FIELD)
    return _build_api_key_list(keys)


@console_router.post(
    "/apps/<uuid:resource_id>/api-keys",
    response_model=ApiKeyItem,
    tags=["console"],
    status_code=201,
)
@setup_required
@login_required
@account_initialization_required
@edit_permission_required
def create_app_api_key(resource_id: UUID) -> ApiKeyItem:
    """Create a new API key for an app."""
    resource_id_value = str(resource_id)
    _, current_tenant_id = current_account_with_tenant()

    _get_resource(resource_id_value, current_tenant_id, App)
    api_token = _create_api_key(
        resource_id_value,
        resource_type=APP_RESOURCE_TYPE,
        resource_id_field=APP_RESOURCE_ID_FIELD,
        token_prefix=APP_TOKEN_PREFIX,
        tenant_id=current_tenant_id,
    )
    return _build_api_key_item(api_token)


@console_router.delete(
    "/apps/<uuid:resource_id>/api-keys/<uuid:api_key_id>",
    response_model=DeleteResponse,
    tags=["console"],
    status_code=204,
)
@setup_required
@login_required
@account_initialization_required
def delete_app_api_key(resource_id: UUID, api_key_id: UUID) -> DeleteResponse:
    """Delete an API key for an app."""
    resource_id_value = str(resource_id)
    api_key_id_value = str(api_key_id)
    current_user, current_tenant_id = current_account_with_tenant()

    _get_resource(resource_id_value, current_tenant_id, App)
    if not current_user.is_admin_or_owner:
        raise Forbidden()

    _delete_api_key(
        resource_id_value,
        api_key_id_value,
        resource_type=APP_RESOURCE_TYPE,
        resource_id_field=APP_RESOURCE_ID_FIELD,
    )
    return DeleteResponse(result="success")


@console_router.get(
    "/datasets/<uuid:resource_id>/api-keys",
    response_model=ApiKeyListResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
def get_dataset_api_keys(resource_id: UUID) -> ApiKeyListResponse:
    """Get all API keys for a dataset."""
    resource_id_value = str(resource_id)
    _, current_tenant_id = current_account_with_tenant()

    _get_resource(resource_id_value, current_tenant_id, Dataset)
    keys = _list_api_keys(resource_id_value, DATASET_RESOURCE_TYPE, DATASET_RESOURCE_ID_FIELD)
    return _build_api_key_list(keys)


@console_router.post(
    "/datasets/<uuid:resource_id>/api-keys",
    response_model=ApiKeyItem,
    tags=["console"],
    status_code=201,
)
@setup_required
@login_required
@account_initialization_required
@edit_permission_required
def create_dataset_api_key(resource_id: UUID) -> ApiKeyItem:
    """Create a new API key for a dataset."""
    resource_id_value = str(resource_id)
    _, current_tenant_id = current_account_with_tenant()

    _get_resource(resource_id_value, current_tenant_id, Dataset)
    api_token = _create_api_key(
        resource_id_value,
        resource_type=DATASET_RESOURCE_TYPE,
        resource_id_field=DATASET_RESOURCE_ID_FIELD,
        token_prefix=DATASET_TOKEN_PREFIX,
        tenant_id=current_tenant_id,
    )
    return _build_api_key_item(api_token)


@console_router.delete(
    "/datasets/<uuid:resource_id>/api-keys/<uuid:api_key_id>",
    response_model=DeleteResponse,
    tags=["console"],
    status_code=204,
)
@setup_required
@login_required
@account_initialization_required
def delete_dataset_api_key(resource_id: UUID, api_key_id: UUID) -> DeleteResponse:
    """Delete an API key for a dataset."""
    resource_id_value = str(resource_id)
    api_key_id_value = str(api_key_id)
    current_user, current_tenant_id = current_account_with_tenant()

    _get_resource(resource_id_value, current_tenant_id, Dataset)
    if not current_user.is_admin_or_owner:
        raise Forbidden()

    _delete_api_key(
        resource_id_value,
        api_key_id_value,
        resource_type=DATASET_RESOURCE_TYPE,
        resource_id_field=DATASET_RESOURCE_ID_FIELD,
    )
    return DeleteResponse(result="success")
