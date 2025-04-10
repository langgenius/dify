from services.enterprise.base import EnterpriseRequest


class EnterpriseService:
    @classmethod
    def get_info(cls, tenant_id=None):
        return EnterpriseRequest.send_request("GET", "/info", tenant_id=tenant_id)

    @classmethod
    def get_app_web_sso_enabled(cls, app_code):
        return EnterpriseRequest.send_request("GET", f"/app-sso-setting?appCode={app_code}")
