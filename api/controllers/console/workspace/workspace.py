# -*- coding:utf-8 -*-
import logging

from flask import request
from flask_login import current_user
from core.login.login import login_required
from flask_restful import Resource, fields, marshal_with, reqparse, marshal, inputs
from flask_restful.inputs import int_range

from controllers.console import api
from controllers.console.admin import admin_required
from controllers.console.setup import setup_required
from controllers.console.error import AccountNotLinkTenantError
from controllers.console.wraps import account_initialization_required
from libs.helper import TimestampField
from extensions.ext_database import db
from models.account import Tenant
from services.account_service import TenantService
from services.workspace_service import WorkspaceService

provider_fields = {
    'provider_name': fields.String,
    'provider_type': fields.String,
    'is_valid': fields.Boolean,
    'token_is_set': fields.Boolean,
}

tenant_fields = {
    'id': fields.String,
    'name': fields.String,
    'plan': fields.String,
    'status': fields.String,
    'created_at': TimestampField,
    'role': fields.String,
    'providers': fields.List(fields.Nested(provider_fields)),
    'in_trial': fields.Boolean,
    'trial_end_reason': fields.String,
}

tenants_fields = {
    'id': fields.String,
    'name': fields.String,
    'plan': fields.String,
    'status': fields.String,
    'created_at': TimestampField,
    'current': fields.Boolean
}

workspace_fields = {
    'id': fields.String,
    'name': fields.String,
    'status': fields.String,
    'created_at': TimestampField
}


class TenantListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        tenants = TenantService.get_join_tenants(current_user)

        for tenant in tenants:
            if tenant.id == current_user.current_tenant_id:
                tenant.current = True  # Set current=True for current tenant
        return {'workspaces': marshal(tenants, tenants_fields)}, 200


class WorkspaceListApi(Resource):
    @setup_required
    @admin_required
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument('page', type=inputs.int_range(1, 99999), required=False, default=1, location='args')
        parser.add_argument('limit', type=inputs.int_range(1, 100), required=False, default=20, location='args')
        args = parser.parse_args()

        tenants = db.session.query(Tenant).order_by(Tenant.created_at.desc())\
            .paginate(page=args['page'], per_page=args['limit'])

        has_more = False
        if len(tenants.items) == args['limit']:
            current_page_first_tenant = tenants[-1]
            rest_count = db.session.query(Tenant).filter(
                Tenant.created_at < current_page_first_tenant.created_at,
                Tenant.id != current_page_first_tenant.id
            ).count()

            if rest_count > 0:
                has_more = True
        total = db.session.query(Tenant).count()
        return {
            'data': marshal(tenants.items, workspace_fields),
            'has_more': has_more,
            'limit': args['limit'],
            'page': args['page'],
            'total': total
                }, 200


class TenantApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(tenant_fields)
    def get(self):
        if request.path == '/info':
            logging.warning('Deprecated URL /info was used.')

        tenant = current_user.current_tenant

        return WorkspaceService.get_tenant_info(tenant), 200


class SwitchWorkspaceApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('tenant_id', type=str, required=True, location='json')
        args = parser.parse_args()

        # check if tenant_id is valid, 403 if not
        try:
            TenantService.switch_tenant(current_user, args['tenant_id'])
        except Exception:
            raise AccountNotLinkTenantError("Account not link tenant")

        new_tenant = db.session.query(Tenant).get(args['tenant_id'])  # Get new tenant

        return {'result': 'success', 'new_tenant': marshal(WorkspaceService.get_tenant_info(new_tenant), tenant_fields)}


api.add_resource(TenantListApi, '/workspaces')  # GET for getting all tenants
api.add_resource(WorkspaceListApi, '/all-workspaces')  # GET for getting all tenants
api.add_resource(TenantApi, '/workspaces/current', endpoint='workspaces_current')  # GET for getting current tenant info
api.add_resource(TenantApi, '/info', endpoint='info')  # Deprecated
api.add_resource(SwitchWorkspaceApi, '/workspaces/switch')  # POST for switching tenant
