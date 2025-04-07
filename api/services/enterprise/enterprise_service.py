from pydantic import BaseModel, Field

from services.enterprise.base import EnterpriseRequest


class WebAppSettings(BaseModel):
    access_mode: str = Field(
        description="Access mode for the web app. Can be 'public' or 'private'",
        default="private",
        alias="access_mode",
    )


class EnterpriseService:
    @classmethod
    def get_info(cls):
        return EnterpriseRequest.send_request("GET", "/info")

    @classmethod
    def is_user_allowed_to_access_webapp(cls, user_id: str, app_id=None, app_code=None) -> bool:
        if not app_id and not app_code:
            raise ValueError("Either app_id or app_code must be provided.")

        return EnterpriseRequest.send_request(
            "GET", f"/web-app/allowed?appId={app_id}&appCode={app_code}&userId={user_id}"
        )

    @classmethod
    def get_web_app_settings(cls, app_code: str = None, app_id: str = None):
        if not app_code and not app_id:
            raise ValueError("Either app_code or app_id must be provided.")
        data = EnterpriseRequest.send_request("GET", f"/web-app/settings?appCode={app_code}&appId={app_id}")
        if not data:
            raise ValueError("No data found.")
        return WebAppSettings(**data)
