from services.enterprise.base import EnterpriseRequest


class EnterpriseService:
    @classmethod
    def get_info(cls):
        return EnterpriseRequest.send_request("GET", "/info")

    @classmethod
    def get_app_web_sso_enabled(cls, app_code):
        return EnterpriseRequest.send_request("GET", f"/app-sso-setting?appCode={app_code}")
