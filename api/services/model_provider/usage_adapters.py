"""Adapters for the model-usage lookup."""

from collections.abc import Mapping
from typing import override

from configs import dify_config
from machinery.context import RequestContext
from models.provider_ids import ModelProviderID
from services.app.access import resolve_app_access_filter
from services.model_provider.usage_query import AppVisibility, ModelProviderIdentity


class PluginModelProviderIdentity(ModelProviderIdentity):
    """Canonicalize provider IDs with the plugin provider-ID rules, including legacy short names."""

    @override
    def canonical_provider_id(self, provider: str) -> str | None:
        if not provider:
            return None
        try:
            return str(ModelProviderID(provider))
        except ValueError:
            return None


class ConsoleAppVisibility(AppVisibility):
    """Apply the Console app-list visibility: every app without RBAC, the RBAC app-access filter with it."""

    @override
    def visible_app_ids(self, request_context: RequestContext, maintainers: Mapping[str, str | None]) -> set[str]:
        if not dify_config.RBAC_ENABLED:
            return set(maintainers)
        account_id = request_context.account_id
        access = resolve_app_access_filter(request_context.active_workspace_id, account_id)
        return {
            app_id
            for app_id, maintainer in maintainers.items()
            if access.is_app_accessible(app_id, maintainer, account_id)
        }
