"""Console RBAC resources endpoints."""

from collections.abc import Mapping
from dataclasses import dataclass

from flask_restx import Resource
from pydantic import BaseModel

from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import rbac_language
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.workspace.rbac.schemas import (
    _AccessControlLanguageQuery,
    _DeleteMemberBindingsRequest,
    _ReplaceBindingsRequest,
    _ResourceAccessScopeRequest,
    _ResourceUserAccessPoliciesQuery,
    pagination_options,
)
from extensions.ext_application_services import application_services
from libs.helper import dump_response
from machinery.context import RequestContext
from services.rbac import contracts as dto


@dataclass(frozen=True)
class _ResourceAccessRoutes:
    resource_type: dto.RBACResourceType
    class_prefix: str
    matrix_model: type[BaseModel]

    @property
    def url_segment(self) -> str:
        return self.resource_type.route.segment

    @property
    def id_param(self) -> str:
        return self.resource_type.route.id_param


@dataclass(frozen=True)
class _ResourceAccessApis:
    catalog: type[Resource]
    matrix: type[Resource]
    whitelist: type[Resource]
    whitelist_config: type[Resource]
    user_access_policies: type[Resource]
    user_access_policy_assignment: type[Resource]
    role_bindings: type[Resource]
    member_bindings: type[Resource]
    workspace_matrix: type[Resource]
    workspace_role_bindings: type[Resource]
    workspace_bindings: type[Resource]
    workspace_member_bindings: type[Resource]


_RESOURCE_ACCESS_ROUTES = (
    _ResourceAccessRoutes(dto.RBACResourceType.APP, "App", dto.AppAccessMatrix),
    _ResourceAccessRoutes(dto.RBACResourceType.DATASET, "Dataset", dto.DatasetAccessMatrix),
    _ResourceAccessRoutes(dto.RBACResourceType.AGENT, "Agent", dto.AgentAccessMatrix),
)


def _build_resource_access_apis(spec: _ResourceAccessRoutes) -> _ResourceAccessApis:
    id_param = spec.id_param
    resource_prefix = f"/workspaces/current/rbac/{spec.url_segment}/<uuid:{id_param}>"
    workspace_prefix = f"/workspaces/current/rbac/workspace/{spec.url_segment}"

    def resource_id(path_params: Mapping[str, object]) -> str:
        return str(path_params[id_param])

    def register(resource: type[Resource], name: str, url: str) -> type[Resource]:
        resource.__name__ = name
        resource.__qualname__ = name
        console_ns.route(url)(resource)
        return resource

    class CatalogApi(Resource):
        @console_account_admission()
        @console_ns.response(200, "Success", console_ns.models[dto.PermissionCatalogResponse.__name__])
        def get(self, context: RequestContext):
            return dump_response(
                dto.PermissionCatalogResponse,
                application_services().rbac.resources.catalog(context, spec.resource_type, language=rbac_language()),
            )

    class MatrixApi(Resource):
        @console_account_admission()
        @console_ns.doc_query(_AccessControlLanguageQuery)
        @console_ns.response(200, "Success", console_ns.models[spec.matrix_model.__name__])
        def get(self, context: RequestContext, **path_params):
            result = application_services().rbac.resources.matrix(
                context, spec.resource_type, resource_id(path_params), language=rbac_language()
            )
            return dump_response(spec.matrix_model, result)

    class WhitelistApi(Resource):
        @console_account_admission()
        @console_ns.response(200, "Success", console_ns.models[dto.ResourceWhitelist.__name__])
        def get(self, context: RequestContext, **path_params):
            return dump_response(
                dto.ResourceWhitelist,
                application_services().rbac.resources.whitelist(
                    context, spec.resource_type, resource_id(path_params), language=rbac_language()
                ),
            )

        @console_account_admission()
        @console_ns.expect_model(_ResourceAccessScopeRequest)
        @console_ns.response(200, "Success", console_ns.models[dto.ResourceWhitelist.__name__])
        def put(self, context: RequestContext, **path_params):
            target_id = resource_id(path_params)
            scope = _ResourceAccessScopeRequest.model_validate(console_ns.payload or {})
            result = application_services().rbac.resources.replace_whitelist(
                context,
                spec.resource_type,
                target_id,
                dto.ReplaceMemberBindings(
                    automatic_include_workspace_members=scope.automatic_include_workspace_members
                ),
                language=rbac_language(),
            )
            return dump_response(dto.ResourceWhitelist, result)

    class WhitelistConfigApi(Resource):
        @console_account_admission()
        @console_ns.response(200, "Success", console_ns.models[dto.ResourceWhitelistConfig.__name__])
        def get(self, context: RequestContext, **path_params):
            return dump_response(
                dto.ResourceWhitelistConfig,
                application_services().rbac.resources.whitelist_config(
                    context, spec.resource_type, resource_id(path_params), language=rbac_language()
                ),
            )

    class UserAccessPoliciesApi(Resource):
        @console_account_admission()
        @console_ns.doc_query(_ResourceUserAccessPoliciesQuery)
        @console_ns.response(200, "Success", console_ns.models[dto.ResourceUserAccessPoliciesResponse.__name__])
        def get(self, context: RequestContext, **path_params):
            target_id = resource_id(path_params)
            options = pagination_options()
            result = application_services().rbac.resources.user_access_policies(
                context, spec.resource_type, target_id, options=options, language=rbac_language()
            )
            return dump_response(dto.ResourceUserAccessPoliciesResponse, result)

    class UserAccessPolicyAssignmentApi(Resource):
        @console_account_admission()
        @console_ns.expect_model(dto.ReplaceUserAccessPolicies)
        @console_ns.response(200, "Success", console_ns.models[dto.ReplaceUserAccessPoliciesResponse.__name__])
        def put(self, context: RequestContext, target_account_id, **path_params):
            payload = dto.ReplaceUserAccessPolicies.model_validate(console_ns.payload or {})
            return dump_response(
                dto.ReplaceUserAccessPoliciesResponse,
                application_services().rbac.resources.replace_user_access_policies(
                    context,
                    spec.resource_type,
                    resource_id(path_params),
                    str(target_account_id),
                    payload,
                    language=rbac_language(),
                ),
            )

    class RoleBindingsApi(Resource):
        @console_account_admission()
        @console_ns.response(200, "Success", console_ns.models[dto.RoleBindingsResponse.__name__])
        def get(self, context: RequestContext, policy_id, **path_params):
            return dump_response(
                dto.RoleBindingsResponse,
                application_services().rbac.resources.list_role_bindings(
                    context, spec.resource_type, resource_id(path_params), str(policy_id), language=rbac_language()
                ),
            )

    class MemberBindingsApi(Resource):
        @console_account_admission()
        @console_ns.response(200, "Success", console_ns.models[dto.MemberBindingsResponse.__name__])
        def get(self, context: RequestContext, policy_id, **path_params):
            return dump_response(
                dto.MemberBindingsResponse,
                application_services().rbac.resources.list_member_bindings(
                    context, spec.resource_type, resource_id(path_params), str(policy_id), language=rbac_language()
                ),
            )

        @console_account_admission()
        @console_ns.expect_model(_DeleteMemberBindingsRequest)
        @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
        def delete(self, context: RequestContext, policy_id, **path_params):
            body = _DeleteMemberBindingsRequest.model_validate(console_ns.payload or {})
            application_services().rbac.resources.delete_member_bindings(
                context,
                spec.resource_type,
                resource_id(path_params),
                str(policy_id),
                dto.DeleteMemberBindings(account_ids=body.account_ids),
                language=rbac_language(),
            )
            return dump_response(SimpleResultResponse, {"result": "success"})

    class WorkspaceMatrixApi(Resource):
        @console_account_admission()
        @console_ns.response(200, "Success", console_ns.models[dto.WorkspaceAccessMatrix.__name__])
        def get(self, context: RequestContext):
            result = application_services().rbac.resources.workspace_matrix(
                context, spec.resource_type, pagination_options(), language=rbac_language()
            )
            return dump_response(dto.WorkspaceAccessMatrix, result)

    class WorkspaceRoleBindingsApi(Resource):
        @console_account_admission()
        @console_ns.response(200, "Success", console_ns.models[dto.RoleBindingsResponse.__name__])
        def get(self, context: RequestContext, policy_id):
            return dump_response(
                dto.RoleBindingsResponse,
                application_services().rbac.resources.workspace_role_bindings(
                    context, spec.resource_type, str(policy_id), language=rbac_language()
                ),
            )

    class WorkspaceBindingsApi(Resource):
        @console_account_admission()
        @console_ns.expect_model(_ReplaceBindingsRequest)
        @console_ns.response(200, "Success", console_ns.models[dto.AccessMatrixItem.__name__])
        def put(self, context: RequestContext, policy_id):
            body = _ReplaceBindingsRequest.model_validate(console_ns.payload or {})
            return dump_response(
                dto.AccessMatrixItem,
                application_services().rbac.resources.replace_workspace_bindings(
                    context,
                    spec.resource_type,
                    str(policy_id),
                    dto.ReplaceBindings(role_ids=list(body.role_ids), account_ids=list(body.account_ids)),
                    language=rbac_language(),
                ),
            )

    class WorkspaceMemberBindingsApi(Resource):
        @console_account_admission()
        @console_ns.response(200, "Success", console_ns.models[dto.MemberBindingsResponse.__name__])
        def get(self, context: RequestContext, policy_id):
            return dump_response(
                dto.MemberBindingsResponse,
                application_services().rbac.resources.workspace_member_bindings(
                    context, spec.resource_type, str(policy_id), language=rbac_language()
                ),
            )

    prefix = spec.class_prefix
    return _ResourceAccessApis(
        catalog=register(
            CatalogApi,
            f"RBAC{prefix}CatalogApi",
            f"/workspaces/current/rbac/role-permissions/catalog/{spec.resource_type.value}",
        ),
        matrix=register(MatrixApi, f"RBAC{prefix}MatrixApi", f"{resource_prefix}/access-policy"),
        whitelist=register(WhitelistApi, f"RBAC{prefix}WhitelistApi", f"{resource_prefix}/whitelist"),
        whitelist_config=register(
            WhitelistConfigApi, f"RBAC{prefix}WhitelistConfigApi", f"{resource_prefix}/whitelist_config"
        ),
        user_access_policies=register(
            UserAccessPoliciesApi, f"RBAC{prefix}UserAccessPoliciesApi", f"{resource_prefix}/user-access-policies"
        ),
        user_access_policy_assignment=register(
            UserAccessPolicyAssignmentApi,
            f"RBAC{prefix}UserAccessPolicyAssignmentApi",
            f"{resource_prefix}/users/<uuid:target_account_id>/access-policies",
        ),
        role_bindings=register(
            RoleBindingsApi,
            f"RBAC{prefix}RoleBindingsApi",
            f"{resource_prefix}/access-policies/<uuid:policy_id>/role-bindings",
        ),
        member_bindings=register(
            MemberBindingsApi,
            f"RBAC{prefix}MemberBindingsApi",
            f"{resource_prefix}/access-policies/<string:policy_id>/member-bindings",
        ),
        workspace_matrix=register(
            WorkspaceMatrixApi, f"RBACWorkspace{prefix}MatrixApi", f"{workspace_prefix}/access-policy"
        ),
        workspace_role_bindings=register(
            WorkspaceRoleBindingsApi,
            f"RBACWorkspace{prefix}RoleBindingsApi",
            f"{workspace_prefix}/access-policies/<uuid:policy_id>/role-bindings",
        ),
        workspace_bindings=register(
            WorkspaceBindingsApi,
            f"RBACWorkspace{prefix}BindingsApi",
            f"{workspace_prefix}/access-policies/<uuid:policy_id>/bindings",
        ),
        workspace_member_bindings=register(
            WorkspaceMemberBindingsApi,
            f"RBACWorkspace{prefix}MemberBindingsApi",
            f"{workspace_prefix}/access-policies/<uuid:policy_id>/member-bindings",
        ),
    )


_RESOURCE_ACCESS_APIS = {spec.resource_type: _build_resource_access_apis(spec) for spec in _RESOURCE_ACCESS_ROUTES}
