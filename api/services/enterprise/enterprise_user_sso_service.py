import logging

from models.account import Account, AccountStatus
from services.account_service import AccountService, TenantService
from services.enterprise.base import EnterpriseRequest

logger = logging.getLogger(__name__)


class EnterpriseUserSSOService:

    @classmethod
    def get_sso_saml_login(cls) -> str:
        return EnterpriseRequest.send_request('GET', '/sso/user/saml/login')

    @classmethod
    def post_sso_saml_acs(cls, saml_response: str) -> str:
        response = EnterpriseRequest.send_request('POST', '/sso/user/saml/acs', json={'SAMLResponse': saml_response})
        if 'email' not in response or response['email'] is None or response['email'] == '':
            logger.exception(response)
            raise Exception('email not found in SAML response: ' + str(response))

        return cls.login_with_email(response.get('email'))

    @classmethod
    def get_sso_oidc_login(cls):
        return EnterpriseRequest.send_request('GET', '/sso/user/oidc/login')

    @classmethod
    def get_sso_oidc_callback(cls, args: dict):
        state_from_query = args['state']
        code_from_query = args['code']
        state_from_cookies = args['user-oidc-state']

        if state_from_cookies != state_from_query:
            raise Exception('invalid state or code')

        response = EnterpriseRequest.send_request('GET', '/sso/user/oidc/callback', params={'code': code_from_query})
        if 'email' not in response or response['email'] is None or response['email'] == '':
            logger.exception(response)
            raise Exception('email not found in OIDC response: ' + str(response))

        return cls.login_with_email(response.get('email'))

    @classmethod
    def login_with_email(cls, email: str) -> str:
        account = Account.query.filter_by(email=email).first()
        if account is None:
            raise Exception('account not found, please contact system admin to invite you to join in a workspace')

        if account.status == AccountStatus.BANNED:
            raise Exception('account is banned, please contact system admin')

        tenants = TenantService.get_join_tenants(account)
        if len(tenants) == 0:
            raise Exception("workspace not found, please contact system admin to invite you to join in a workspace")

        token = AccountService.get_account_jwt_token(account)

        return token
