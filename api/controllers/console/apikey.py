"""Console transport adapters for resource-scoped API key management."""

from collections.abc import Generator
from contextlib import contextmanager
from uuid import UUID

import flask_restx
from flask_restx import Resource

from controllers.common.rbac import AgentBehindApp, DatasetId, PlainApp, RBACCheck
from controllers.common.schema import register_response_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission
from extensions.ext_application_services import application_services
from fields.api_key_fields import ApiKeyItem, ApiKeyList, build_masked_api_key_list
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.agent.errors import AgentAccessNotReadyError
from services.app.api_key_service import AppApiKeyNotReadyError
from services.auth.api_key_contracts import (
    ApiKeyLimitExceededError,
    ApiKeyNotFoundError,
    ApiKeyResourceNotFoundError,
)
from services.errors.account import NoPermissionError
from services.knowledge.api_key_service import UnknownDatasetIdsError

API_KEY_EDIT_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR})
API_KEY_DELETE_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})

register_response_schema_models(console_ns, ApiKeyItem, ApiKeyList)


@contextmanager
def api_key_errors() -> Generator[None]:
    """Translate application failures without changing the Console error contract."""
    try:
        yield
    except (ApiKeyResourceNotFoundError, ApiKeyNotFoundError) as error:
        flask_restx.abort(404, message=str(error))
    except ApiKeyLimitExceededError as error:
        flask_restx.abort(400, message=str(error), custom="max_keys_exceeded")
    except UnknownDatasetIdsError as error:
        flask_restx.abort(400, message=str(error))
    except NoPermissionError as error:
        flask_restx.abort(403, message=str(error))
    except AppApiKeyNotReadyError as error:
        raise AgentAccessNotReadyError from error


@console_ns.route("/apps/<uuid:resource_id>/api-keys")
class AppApiKeyListResource(Resource):
    @console_ns.doc("get_app_api_keys")
    @console_ns.doc(description="Get all API keys for an app")
    @console_ns.doc(params={"resource_id": "App ID"})
    @console_ns.response(200, "API keys retrieved successfully", console_ns.models[ApiKeyList.__name__])
    @console_account_admission(
        allowed_roles=API_KEY_EDIT_ROLES,
        rbac_checks=[
            RBACCheck(RBACPermission.APP_RELEASE_AND_VERSION, PlainApp("resource_id")),
            RBACCheck(RBACPermission.AGENT_ACCESS_POINT_VIEW, AgentBehindApp("resource_id")),
        ],
    )
    def get(self, request_context: RequestContext, resource_id: UUID) -> dict[str, object]:
        with api_key_errors():
            keys = application_services().app_api_keys.list_keys(request_context, str(resource_id))
        return dump_response(ApiKeyList, {"data": keys})

    @console_ns.doc("create_app_api_key")
    @console_ns.doc(description="Create a new API key for an app")
    @console_ns.doc(params={"resource_id": "App ID"})
    @console_ns.response(201, "API key created successfully", console_ns.models[ApiKeyItem.__name__])
    @console_ns.response(400, "Maximum keys exceeded")
    @console_account_admission(
        allowed_roles=API_KEY_EDIT_ROLES,
        rbac_checks=[
            RBACCheck(RBACPermission.APP_RELEASE_AND_VERSION, PlainApp("resource_id")),
            RBACCheck(RBACPermission.AGENT_ACCESS_POINT_MANAGE, AgentBehindApp("resource_id")),
        ],
    )
    def post(self, request_context: RequestContext, resource_id: UUID) -> tuple[dict[str, object], int]:
        with api_key_errors():
            key = application_services().app_api_keys.create_key(request_context, str(resource_id))
        return dump_response(ApiKeyItem, key), 201


@console_ns.route("/apps/<uuid:resource_id>/api-keys/<uuid:api_key_id>")
class AppApiKeyResource(Resource):
    @console_ns.doc("delete_app_api_key")
    @console_ns.doc(description="Delete an API key for an app")
    @console_ns.doc(params={"resource_id": "App ID", "api_key_id": "API key ID"})
    @console_ns.response(204, "API key deleted successfully")
    @console_account_admission(
        allowed_roles=API_KEY_DELETE_ROLES,
        rbac_checks=[
            RBACCheck(RBACPermission.APP_RELEASE_AND_VERSION, PlainApp("resource_id")),
            RBACCheck(RBACPermission.AGENT_ACCESS_POINT_MANAGE, AgentBehindApp("resource_id")),
        ],
    )
    def delete(self, request_context: RequestContext, resource_id: UUID, api_key_id: UUID) -> tuple[str, int]:
        with api_key_errors():
            application_services().app_api_keys.delete_key(request_context, str(resource_id), str(api_key_id))
        return "", 204


@console_ns.route("/datasets/<uuid:resource_id>/api-keys")
class DatasetApiKeyListResource(Resource):
    @console_ns.doc("get_dataset_api_keys")
    @console_ns.doc(description="Get all API keys for a dataset")
    @console_ns.doc(params={"resource_id": "Dataset ID"})
    @console_ns.response(200, "API keys retrieved successfully", console_ns.models[ApiKeyList.__name__])
    @console_account_admission(
        allowed_roles=API_KEY_EDIT_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.DATASET_API_KEY_MANAGE, DatasetId("resource_id"))],
    )
    def get(self, request_context: RequestContext, resource_id: UUID) -> dict[str, object]:
        with api_key_errors():
            keys = application_services().dataset_api_keys.list_keys(request_context, str(resource_id))
        return dump_response(ApiKeyList, build_masked_api_key_list(keys))

    @console_ns.doc("create_dataset_api_key")
    @console_ns.doc(description="Create a new API key for a dataset")
    @console_ns.doc(params={"resource_id": "Dataset ID"})
    @console_ns.response(201, "API key created successfully", console_ns.models[ApiKeyItem.__name__])
    @console_ns.response(400, "Maximum keys exceeded")
    @console_account_admission(
        allowed_roles=API_KEY_EDIT_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.DATASET_API_KEY_MANAGE, DatasetId("resource_id"))],
    )
    def post(self, request_context: RequestContext, resource_id: UUID) -> tuple[dict[str, object], int]:
        with api_key_errors():
            key = application_services().dataset_api_keys.create_key(request_context, str(resource_id))
        return dump_response(ApiKeyItem, key), 201


@console_ns.route("/datasets/<uuid:resource_id>/api-keys/<uuid:api_key_id>")
class DatasetApiKeyResource(Resource):
    @console_ns.doc("delete_dataset_api_key")
    @console_ns.doc(description="Delete an API key for a dataset")
    @console_ns.doc(params={"resource_id": "Dataset ID", "api_key_id": "API key ID"})
    @console_ns.response(204, "API key deleted successfully")
    @console_account_admission(
        allowed_roles=API_KEY_DELETE_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.DATASET_API_KEY_MANAGE, DatasetId("resource_id"))],
    )
    def delete(self, request_context: RequestContext, resource_id: UUID, api_key_id: UUID) -> tuple[str, int]:
        with api_key_errors():
            application_services().dataset_api_keys.delete_key(request_context, str(resource_id), str(api_key_id))
        return "", 204
