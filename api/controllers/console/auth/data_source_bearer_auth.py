import logging

import requests
from flask import current_app, redirect, request
from flask_login import current_user
from flask_restful import Resource, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import api
from libs.login import login_required
from libs.oauth_data_source import NotionOAuth
from services.auth.api_key_auth_service import ApiKeyAuthService

from ..setup import setup_required
from ..wraps import account_initialization_required


class ApiKeyAuthDataSource(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        # The role of the current user in the table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        data_source_api_key_bindings = ApiKeyAuthService.get_provider_auth_list(current_user.tenant_id)
        if data_source_api_key_bindings:
            return {
                'settings': [data_source_api_key_binding.to_dict() for data_source_api_key_binding in
                             data_source_api_key_bindings]}
        return {'settings': []}


class ApiKeyAuthDataSourceBinding(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        # The role of the current user in the table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        parser = reqparse.RequestParser()
        parser.add_argument('category', type=str, required=True, nullable=False, location='json')
        parser.add_argument('provider', type=str, required=True, nullable=False, location='json')
        parser.add_argument('credential', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()
        data_source_api_key_binding = ApiKeyAuthService.create_provider_auth(current_user.tenant_id, args)


api.add_resource(ApiKeyAuthDataSource, '/api-key-auth/data-source')
api.add_resource(ApiKeyAuthDataSourceBinding, '/api-key-auth/data-source/binding')
