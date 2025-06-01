from pydantic import BaseModel, Field

from services.enterprise.base import EnterpriseRequest


class WebAppSettings(BaseModel):
    access_mode: str = Field(
        description="Access mode for the web app. Can be 'public' or 'private'",
        default="private",
        alias="accessMode",
    )


class EnterpriseService:
    @classmethod
    def get_info(cls):
        return EnterpriseRequest.send_request("GET", "/info")

    @classmethod
    def get_workspace_info(cls, tenant_id: str):
        return EnterpriseRequest.send_request("GET", f"/workspace/{tenant_id}/info")

    class WebAppAuth:
        @classmethod
        def is_user_allowed_to_access_webapp(cls, user_id: str, app_code: str):
            params = {"userId": user_id, "appCode": app_code}
            data = EnterpriseRequest.send_request("GET", "/webapp/permission", params=params)

            return data.get("result", False)

        @classmethod
        def get_app_access_mode_by_id(cls, app_id: str) -> WebAppSettings:
            if not app_id:
                raise ValueError("app_id must be provided.")
            params = {"appId": app_id}
            data = EnterpriseRequest.send_request("GET", "/webapp/access-mode/id", params=params)
            if not data:
                raise ValueError("No data found.")
            return WebAppSettings(**data)

        @classmethod
        def batch_get_app_access_mode_by_id(cls, app_ids: list[str]) -> dict[str, WebAppSettings]:
            if not app_ids:
                return {}
            body = {"appIds": app_ids}
            data: dict[str, str] = EnterpriseRequest.send_request("POST", "/webapp/access-mode/batch/id", json=body)
            if not data:
                raise ValueError("No data found.")

            if not isinstance(data["accessModes"], dict):
                raise ValueError("Invalid data format.")

            ret = {}
            for key, value in data["accessModes"].items():
                curr = WebAppSettings()
                curr.access_mode = value
                ret[key] = curr

            return ret

        @classmethod
        def get_app_access_mode_by_code(cls, app_code: str) -> WebAppSettings:
            if not app_code:
                raise ValueError("app_code must be provided.")
            params = {"appCode": app_code}
            data = EnterpriseRequest.send_request("GET", "/webapp/access-mode/code", params=params)
            if not data:
                raise ValueError("No data found.")
            return WebAppSettings(**data)

        @classmethod
        def update_app_access_mode(cls, app_id: str, access_mode: str):
            if not app_id:
                raise ValueError("app_id must be provided.")
            if access_mode not in ["public", "private", "private_all"]:
                raise ValueError("access_mode must be either 'public', 'private', or 'private_all'")

            data = {"appId": app_id, "accessMode": access_mode}

            response = EnterpriseRequest.send_request("POST", "/webapp/access-mode", json=data)

            return response.get("result", False)

        @classmethod
        def cleanup_webapp(cls, app_id: str):
            if not app_id:
                raise ValueError("app_id must be provided.")

            body = {"appId": app_id}
            EnterpriseRequest.send_request("DELETE", "/webapp/clean", json=body)
