from flask import current_app, redirect
from flask_restful import Resource, reqparse

from controllers.console import api
from controllers.console.setup import setup_required
from services.enterprise.enterprise_sso_service import EnterpriseSSOService


class EnterpriseSSOSamlLogin(Resource):

    @setup_required
    def get(self):
        return EnterpriseSSOService.get_sso_saml_login()


class EnterpriseSSOSamlAcs(Resource):

    @setup_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('SAMLResponse', type=str, required=True, location='form')
        args = parser.parse_args()
        saml_response = args['SAMLResponse']

        try:
            token = EnterpriseSSOService.post_sso_saml_acs(saml_response)
            return redirect(f'{current_app.config.get("CONSOLE_WEB_URL")}/signin?console_token={token}')
        except Exception as e:
            return redirect(f'{current_app.config.get("CONSOLE_WEB_URL")}/signin?message={str(e)}')


class EnterpriseSSOOidcLogin(Resource):

    @setup_required
    def get(self):
        return EnterpriseSSOService.get_sso_oidc_login()


class EnterpriseSSOOidcCallback(Resource):

    @setup_required
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument('state', type=str, required=True, location='args')
        parser.add_argument('code', type=str, required=True, location='args')
        parser.add_argument('oidc-state', type=str, required=True, location='cookies')
        args = parser.parse_args()

        try:
            token = EnterpriseSSOService.get_sso_oidc_callback(args)
            return redirect(f'{current_app.config.get("CONSOLE_WEB_URL")}/signin?console_token={token}')
        except Exception as e:
            return redirect(f'{current_app.config.get("CONSOLE_WEB_URL")}/signin?message={str(e)}')


api.add_resource(EnterpriseSSOSamlLogin, '/enterprise/sso/saml/login')
api.add_resource(EnterpriseSSOSamlAcs, '/enterprise/sso/saml/acs')
api.add_resource(EnterpriseSSOOidcLogin, '/enterprise/sso/oidc/login')
api.add_resource(EnterpriseSSOOidcCallback, '/enterprise/sso/oidc/callback')
