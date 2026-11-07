"""Resolve detached app dependencies after the repository Session has closed.

This is configuration availability, not an execution probe: it never invokes a
model, tool, or external Knowledge endpoint. Caches live only for one list
request, so repairing a dependency is reflected by the next request.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import replace

from core.entities.model_entities import ModelStatus
from core.entities.provider_configuration import ProviderConfigurations
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from core.plugin.impl.plugin import PluginInstaller
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.errors import ToolNotFoundError, ToolProviderNotFoundError
from core.tools.tool_manager import ToolManager
from graphon.model_runtime.entities.model_entities import ModelType
from services.entities.app_entities import (
    AppAvailabilityIssue,
    AppAvailabilityIssueType,
    AppAvailabilityStatus,
    AppModelDependency,
    AppPluginDependency,
    AppRecord,
    AppToolDependency,
)

logger = logging.getLogger(__name__)


class AppAvailabilityService:
    """Stateless factory for request-scoped evaluations."""

    @staticmethod
    def for_tenant(tenant_id: str) -> AppAvailabilityEvaluation:
        return AppAvailabilityEvaluation(tenant_id)


class AppAvailabilityEvaluation:
    def __init__(self, tenant_id: str) -> None:
        self._tenant_id = tenant_id
        self._configurations: ProviderConfigurations | None = None
        self._configurations_failed = False
        self._model_cache: dict[tuple[str, str, str], str | None] = {}
        self._tool_cache: dict[tuple[str, str, str | None, bool], str | None] = {}
        self._plugin_cache: dict[str, str | None] = {}

    def evaluate_many(self, apps: Sequence[AppRecord]) -> list[AppRecord]:
        return [self._evaluate(app) for app in apps]

    def _evaluate(self, app: AppRecord) -> AppRecord:
        plan = app.availability_plan
        if plan is None:
            return app
        issues = list(plan.reasons)
        for dependency in plan.dependencies:
            if isinstance(dependency, AppModelDependency):
                reason = self._model_reason(dependency)
                issue = AppAvailabilityIssue(
                    AppAvailabilityIssueType.MODEL,
                    reason or "",
                    dependency.resource_id,
                    dependency.provider,
                    dependency.model,
                )
            elif isinstance(dependency, AppToolDependency):
                reason = self._tool_reason(dependency)
                issue = AppAvailabilityIssue(
                    AppAvailabilityIssueType.TOOL, reason or "", dependency.resource_id, dependency.provider_id
                )
            else:
                reason = self._plugin_reason(dependency)
                issue = AppAvailabilityIssue(
                    AppAvailabilityIssueType.TOOL, reason or "", dependency.resource_id, dependency.plugin_id
                )
            if reason is not None:
                issues.append(issue)
        return replace(
            app,
            availability=AppAvailabilityStatus.UNAVAILABLE if issues else AppAvailabilityStatus.AVAILABLE,
            availability_source=plan.source,
            availability_reasons=tuple(dict.fromkeys(issues)),
            availability_plan=None,
        )

    def _model_reason(self, dependency: AppModelDependency) -> str | None:
        key = (dependency.provider, dependency.model_type, dependency.model)
        if key in self._model_cache:
            return self._model_cache[key]
        reason = None
        try:
            if self._configurations is None and not self._configurations_failed:
                try:
                    self._configurations = create_plugin_provider_manager(tenant_id=self._tenant_id).get_configurations(
                        self._tenant_id
                    )
                except Exception:
                    self._configurations_failed = True
                    raise
            if self._configurations_failed:
                reason = "evaluation-failed"
            else:
                provider = self._configurations.get(dependency.provider) if self._configurations else None
                model = (
                    provider.get_provider_model(model_type=ModelType(dependency.model_type), model=dependency.model)
                    if provider
                    else None
                )
                if model is None:
                    reason = "missing"
                elif model.status != ModelStatus.ACTIVE:
                    reason = model.status.value
        except Exception:
            logger.exception("Could not resolve app model dependency, tenant_id=%s", self._tenant_id)
            reason = "evaluation-failed"
        self._model_cache[key] = reason
        return reason

    def _tool_reason(self, dependency: AppToolDependency) -> str | None:
        key = (
            dependency.provider_type,
            dependency.provider_id,
            dependency.tool_name,
            dependency.credential_exists,
        )
        if key in self._tool_cache:
            return self._tool_cache[key]
        reason = None
        try:
            provider = (
                ToolManager.get_builtin_provider(dependency.provider_id, self._tenant_id)
                if dependency.provider_type == ToolProviderType.BUILT_IN
                else ToolManager.get_plugin_provider(dependency.provider_id, self._tenant_id)
            )
            if dependency.tool_name:
                try:
                    tool = provider.get_tool(dependency.tool_name)
                except ValueError:
                    # PluginToolProviderController uses ValueError for a tool
                    # removed from an otherwise installed provider.
                    tool = None
                if tool is None:
                    reason = "missing"
            elif not provider.get_tools():
                reason = "missing"
            if (
                reason is None
                and dependency.provider_type == ToolProviderType.BUILT_IN
                and provider.need_credentials
                and not dependency.credential_exists
            ):
                reason = "no-configure"
        except (ToolProviderNotFoundError, ToolNotFoundError, KeyError):
            reason = "missing"
        except Exception:
            logger.exception("Could not resolve app tool dependency, tenant_id=%s", self._tenant_id)
            reason = "evaluation-failed"
        self._tool_cache[key] = reason
        return reason

    def _plugin_reason(self, dependency: AppPluginDependency) -> str | None:
        if dependency.plugin_id not in self._plugin_cache:
            try:
                installed = PluginInstaller().fetch_plugin_installation_by_ids(self._tenant_id, [dependency.plugin_id])
                self._plugin_cache[dependency.plugin_id] = None if installed else "missing"
            except Exception:
                logger.exception("Could not resolve app plugin dependency, tenant_id=%s", self._tenant_id)
                self._plugin_cache[dependency.plugin_id] = "evaluation-failed"
        return self._plugin_cache[dependency.plugin_id]
