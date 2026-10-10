"""Console RBAC policies endpoints."""

from flask import request
from flask_restx import Resource

from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import RBACCheck, Workspace, rbac_language
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.workspace.rbac.schemas import (
    _AccessPolicyCreateRequest,
    _AccessPolicyList,
    _AccessPolicyUpdateRequest,
    pagination_options,
)
from controllers.console.wraps import RBACPermission
from extensions.ext_application_services import application_services
from libs.helper import dump_response
from machinery.context import RequestContext
from services.rbac import contracts as dto


@console_ns.route("/workspaces/current/rbac/access-policies")
class RBACAccessPoliciesApi(Resource):
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())])
    @console_ns.response(200, "Success", console_ns.models[_AccessPolicyList.__name__])
    def get(self, context: RequestContext):
        resource_type = request.args.get("resource_type") or None
        return dump_response(
            _AccessPolicyList,
            application_services().rbac.policies.list(
                context, resource_type=resource_type, options=pagination_options(), language=rbac_language()
            ),
        )

    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())])
    @console_ns.expect_model(_AccessPolicyCreateRequest)
    @console_ns.response(201, "Policy created", console_ns.models[dto.AccessPolicy.__name__])
    def post(self, context: RequestContext):
        request = _AccessPolicyCreateRequest.model_validate(console_ns.payload or {})
        policy = application_services().rbac.policies.create(
            context,
            dto.AccessPolicyCreate(
                name=request.name,
                resource_type=request.resource_type,
                description=request.description,
                permission_keys=list(request.permission_keys),
            ),
            language=rbac_language(),
        )
        return (dump_response(dto.AccessPolicy, policy), 201)


@console_ns.route("/workspaces/current/rbac/access-policies/<uuid:policy_id>")
class RBACAccessPolicyItemApi(Resource):
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())])
    @console_ns.response(200, "Success", console_ns.models[dto.AccessPolicy.__name__])
    def get(self, context: RequestContext, policy_id):
        return dump_response(
            dto.AccessPolicy,
            application_services().rbac.policies.get(context, str(policy_id), language=rbac_language()),
        )

    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())])
    @console_ns.expect_model(_AccessPolicyUpdateRequest)
    @console_ns.response(200, "Success", console_ns.models[dto.AccessPolicy.__name__])
    def put(self, context: RequestContext, policy_id):
        request = _AccessPolicyUpdateRequest.model_validate(console_ns.payload or {})
        policy = application_services().rbac.policies.update(
            context,
            str(policy_id),
            dto.AccessPolicyUpdate(
                name=request.name, description=request.description, permission_keys=list(request.permission_keys)
            ),
            language=rbac_language(),
        )
        return dump_response(dto.AccessPolicy, policy)

    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    def delete(self, context: RequestContext, policy_id):
        application_services().rbac.policies.delete(context, str(policy_id), language=rbac_language())
        return dump_response(SimpleResultResponse, {"result": "success"})


@console_ns.route("/workspaces/current/rbac/access-policies/<uuid:policy_id>/copy")
class RBACAccessPolicyCopyApi(Resource):
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())])
    @console_ns.response(201, "Policy copied", console_ns.models[dto.AccessPolicy.__name__])
    def post(self, context: RequestContext, policy_id):
        policy = application_services().rbac.policies.copy(context, str(policy_id), language=rbac_language())
        return (dump_response(dto.AccessPolicy, policy), 201)


@console_ns.route("/workspaces/current/rbac/access-policy-bindings/<uuid:binding_id>/lock")
class RBACAccessPolicyBindingLockApi(Resource):
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())])
    @console_ns.response(200, "Success", console_ns.models[dto.AccessPolicyBindingState.__name__])
    def put(self, context: RequestContext, binding_id):
        return dump_response(
            dto.AccessPolicyBindingState,
            application_services().rbac.policies.lock(context, str(binding_id), language=rbac_language()),
        )


@console_ns.route("/workspaces/current/rbac/access-policy-bindings/<uuid:binding_id>/unlock")
class RBACAccessPolicyBindingUnlockApi(Resource):
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())])
    @console_ns.response(200, "Success", console_ns.models[dto.AccessPolicyBindingState.__name__])
    def put(self, context: RequestContext, binding_id):
        return dump_response(
            dto.AccessPolicyBindingState,
            application_services().rbac.policies.unlock(context, str(binding_id), language=rbac_language()),
        )
