"""Application service for building the public Web app runtime bootstrap."""

import json
from collections.abc import Mapping
from typing import NamedTuple, Protocol, cast

from configs import dify_config
from services.app_definition_query_service import AppSiteConfiguration
from services.feature_service import FeatureService
from services.file_service import FileService


class WebAppRuntimeRecord(NamedTuple):
    app_id: str
    tenant_id: str
    enable_site: bool
    site: AppSiteConfiguration
    plan: str
    tenant_status: str
    # Keep this lazy: workspaces without custom branding never parsed this legacy field.
    tenant_custom_config_json: str | None


class WebAppBootstrap(NamedTuple):
    app_id: str
    mode: str
    enable_site: bool
    site: Mapping[str, str | bool | None]
    plan: str
    can_replace_logo: bool
    custom_config: Mapping[str, str | bool | None] | None


class WebAppRuntimeQuery(Protocol):
    def get_runtime_record(self, app_id: str) -> WebAppRuntimeRecord | None: ...

    def resolve_compatible_app_mode(self, app_id: str) -> str | None: ...


class WebAppRuntimeUnavailableError(ValueError):
    """Raised when the admitted Web app can no longer be bootstrapped."""


_ARCHIVED_TENANT_STATUS = "archive"


class WebAppRuntimeQueryService:
    def __init__(
        self,
        *,
        runtime: WebAppRuntimeQuery,
        file_service: FileService,
    ) -> None:
        self._runtime = runtime
        self._file_service = file_service

    def get_bootstrap(self, app_id: str) -> WebAppBootstrap:
        record = self._runtime.get_runtime_record(app_id)
        if record is None or record.tenant_status == _ARCHIVED_TENANT_STATUS:
            raise WebAppRuntimeUnavailableError("Site not found")

        features = FeatureService.get_features(record.tenant_id, exclude_vector_space=True)
        mode = self._runtime.resolve_compatible_app_mode(app_id)
        if mode is None:
            raise WebAppRuntimeUnavailableError("Site not found")
        site_icon_url = (
            self._file_service.get_icon_url(record.site.icon, record.tenant_id)
            if record.site.icon_type == "image" and record.site.icon
            else None
        )

        site = cast(dict[str, str | bool | None], record.site._asdict())
        site["icon_url"] = site_icon_url
        if features.billing.enabled and not features.webapp_copyright_enabled:
            site["copyright"] = None
            site["input_placeholder"] = None

        custom_config = None
        if features.can_replace_logo:
            tenant_custom_config = (
                cast(Mapping[str, str | bool | None], json.loads(record.tenant_custom_config_json))
                if record.tenant_custom_config_json
                else {}
            )
            replace_webapp_logo = (
                f"{dify_config.FILES_URL}/files/workspaces/{record.tenant_id}/webapp-logo"
                if tenant_custom_config.get("replace_webapp_logo")
                else None
            )
            custom_config = {
                "remove_webapp_brand": tenant_custom_config.get("remove_webapp_brand", False),
                "replace_webapp_logo": replace_webapp_logo,
            }

        return WebAppBootstrap(
            app_id=record.app_id,
            mode=mode,
            enable_site=record.enable_site,
            site=site,
            plan=record.plan,
            can_replace_logo=features.can_replace_logo,
            custom_config=custom_config,
        )
