import logging
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from configs import dify_config
from services.enterprise.base import EnterpriseRequest

logger = logging.getLogger(__name__)

DEFAULT_WORKSPACE_JOIN_TIMEOUT_SECONDS = 1.0


class WebAppSettings(BaseModel):
    access_mode: str = Field(
        description="Access mode for the web app. Can be 'public', 'private', 'private_all', 'sso_verified'",
        default="private",
        alias="accessMode",
    )


class WorkspacePermission(BaseModel):
    workspace_id: str = Field(
        description="The ID of the workspace.",
        alias="workspaceId",
    )
    allow_member_invite: bool = Field(
        description="Whether to allow members to invite new members to the workspace.",
        default=False,
        alias="allowMemberInvite",
    )
    allow_owner_transfer: bool = Field(
        description="Whether to allow owners to transfer ownership of the workspace.",
        default=False,
        alias="allowOwnerTransfer",
    )


class DefaultWorkspaceJoinResult(BaseModel):
    """
    Result of ensuring an account is a member of the enterprise default workspace.

    - joined=True is idempotent (already a member also returns True)
    - joined=False means enterprise default workspace is not configured or invalid/archived
    """

    workspace_id: str = Field(default="", alias="workspaceId")
    joined: bool
    message: str

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def _check_workspace_id_when_joined(self) -> "DefaultWorkspaceJoinResult":
        if self.joined and not self.workspace_id:
            raise ValueError("workspace_id must be non-empty when joined is True")
        return self


def try_join_default_workspace(account_id: str) -> None:
    """
    Enterprise-only side-effect: ensure account is a member of the default workspace.

    This is a best-effort integration. Failures must not block user registration.
    """

    if not dify_config.ENTERPRISE_ENABLED:
        return

    try:
        result = EnterpriseService.join_default_workspace(account_id=account_id)
        if result.joined:
            logger.info(
                "Joined enterprise default workspace for account %s (workspace_id=%s)",
                account_id,
                result.workspace_id,
            )
        else:
            logger.info(
                "Skipped joining enterprise default workspace for account %s (message=%s)",
                account_id,
                result.message,
            )
    except Exception:
        logger.warning("Failed to join enterprise default workspace for account %s", account_id, exc_info=True)


class EnterpriseService:
    @classmethod
    def get_info(cls):
        return EnterpriseRequest.send_request("GET", "/info")

    @classmethod
    def get_workspace_info(cls, tenant_id: str):
        return EnterpriseRequest.send_request("GET", f"/workspace/{tenant_id}/info")

    @classmethod
    def join_default_workspace(cls, *, account_id: str) -> DefaultWorkspaceJoinResult:
        """
        Call enterprise inner API to add an account to the default workspace.

        NOTE: EnterpriseRequest.base_url is expected to already include the `/inner/api` prefix,
        so the endpoint here is `/default-workspace/members`.
        """

        # Ensure we are sending a UUID-shaped string (enterprise side validates too).
        try:
            uuid.UUID(account_id)
        except ValueError as e:
            raise ValueError(f"account_id must be a valid UUID: {account_id}") from e

        data = EnterpriseRequest.send_request(
            "POST",
            "/default-workspace/members",
            json={"account_id": account_id},
            timeout=DEFAULT_WORKSPACE_JOIN_TIMEOUT_SECONDS,
            raise_for_status=True,
        )
        if not isinstance(data, dict):
            raise ValueError("Invalid response format from enterprise default workspace API")
        if "joined" not in data or "message" not in data:
            raise ValueError("Invalid response payload from enterprise default workspace API")
        return DefaultWorkspaceJoinResult.model_validate(data)

    @classmethod
    def get_app_sso_settings_last_update_time(cls) -> datetime:
        data = EnterpriseRequest.send_request("GET", "/sso/app/last-update-time")
        if not data:
            raise ValueError("No data found.")
        try:
            # parse the UTC timestamp from the response
            return datetime.fromisoformat(data)
        except ValueError as e:
            raise ValueError(f"Invalid date format: {data}") from e

    @classmethod
    def get_workspace_sso_settings_last_update_time(cls) -> datetime:
        data = EnterpriseRequest.send_request("GET", "/sso/workspace/last-update-time")
        if not data:
            raise ValueError("No data found.")
        try:
            # parse the UTC timestamp from the response
            return datetime.fromisoformat(data)
        except ValueError as e:
            raise ValueError(f"Invalid date format: {data}") from e

    class WorkspacePermissionService:
        @classmethod
        def get_permission(cls, workspace_id: str):
            if not workspace_id:
                raise ValueError("workspace_id must be provided.")
            data = EnterpriseRequest.send_request("GET", f"/workspaces/{workspace_id}/permission")
            if not data or "permission" not in data:
                raise ValueError("No data found.")
            return WorkspacePermission.model_validate(data["permission"])

    class WebAppAuth:
        @classmethod
        def is_user_allowed_to_access_webapp(cls, user_id: str, app_id: str):
            params = {"userId": user_id, "appId": app_id}
            data = EnterpriseRequest.send_request("GET", "/webapp/permission", params=params)

            return data.get("result", False)

        @classmethod
        def batch_is_user_allowed_to_access_webapps(cls, user_id: str, app_ids: list[str]):
            if not app_ids:
                return {}
            body = {"userId": user_id, "appIds": app_ids}
            data = EnterpriseRequest.send_request("POST", "/webapp/permission/batch", json=body)
            if not data:
                raise ValueError("No data found.")
            return data.get("permissions", {})

        @classmethod
        def get_app_access_mode_by_id(cls, app_id: str) -> WebAppSettings:
            if not app_id:
                raise ValueError("app_id must be provided.")
            params = {"appId": app_id}
            data = EnterpriseRequest.send_request("GET", "/webapp/access-mode/id", params=params)
            if not data:
                raise ValueError("No data found.")
            return WebAppSettings.model_validate(data)

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

            params = {"appId": app_id}
            EnterpriseRequest.send_request("DELETE", "/webapp/clean", params=params)
