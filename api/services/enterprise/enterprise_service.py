from services.enterprise.base import EnterpriseRequest


class EnterpriseService:

    @classmethod
    def get_info(cls):
        return EnterpriseRequest.send_request("GET", "/inner/api/info")

    @classmethod
    def update_web_sso_exclude_apps(cls, app_id_list, user_id):
        return EnterpriseRequest.send_request(
            "PATCH", "/inner/api/web-sso-exclude-apps", json={"app_id_list": app_id_list, "user_id": user_id}
        )
