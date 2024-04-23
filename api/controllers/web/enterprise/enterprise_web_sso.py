from flask import current_app, redirect
from flask_restful import Resource, reqparse

from controllers.web import api
from services.enterprise.enterprise_web_sso_service import EnterpriseWebSSOService


class EnterpriseWebSSOSamlLogin(Resource):

    def get(self):
        return EnterpriseWebSSOService.get_sso_saml_login()


class EnterpriseWebSSOSamlAcs(Resource):

    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('SAMLResponse', type=str, required=True, location='form')
        args = parser.parse_args()
        saml_response = args['SAMLResponse']

        try:
            token = EnterpriseWebSSOService.post_sso_saml_acs(saml_response)
            return redirect(f'{current_app.config.get("APP_WEB_URL")}/webapp-sso?web_sso_token={token}')
        except Exception as e:
            return redirect(f'{current_app.config.get("APP_WEB_URL")}/webapp-sso?message={str(e)}')


class EnterpriseWebSSOOidcLogin(Resource):

    def get(self):
        return EnterpriseWebSSOService.get_sso_oidc_login()


class EnterpriseWebSSOOidcCallback(Resource):

    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument('code', type=str, required=True, location='args')
        args = parser.parse_args()

        try:
            token = EnterpriseWebSSOService.get_sso_oidc_callback(args)
            return redirect(f'{current_app.config.get("APP_WEB_URL")}/webapp-sso?web_sso_token={token}')
        except Exception as e:
            return redirect(f'{current_app.config.get("APP_WEB_URL")}/webapp-sso?message={str(e)}')


api.add_resource(EnterpriseWebSSOSamlLogin, '/enterprise/sso/saml/login')
api.add_resource(EnterpriseWebSSOSamlAcs, '/enterprise/sso/saml/acs')
api.add_resource(EnterpriseWebSSOOidcLogin, '/enterprise/sso/oidc/login')
api.add_resource(EnterpriseWebSSOOidcCallback, '/enterprise/sso/oidc/callback')
