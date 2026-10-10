"""Plugins in one workspace: find them on the marketplace, install, check the install, upgrade, remove."""

from __future__ import annotations

from collections.abc import Generator, Sequence
from contextlib import contextmanager
from http import HTTPStatus
from typing import Final

import httpx
from flask_restx import Resource
from werkzeug.exceptions import BadRequest

from configs import dify_config
from controllers.common.rbac import RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint, op_of
from controllers.openapi._errors import (
    MarketplaceDisabled,
    MarketplaceUnavailable,
    PluginInstallForbidden,
    PluginNotInstalled,
    PluginServiceUnavailable,
)
from controllers.openapi._i18n import localized
from controllers.openapi._models import (
    Hint,
    MarketplacePluginListResponse,
    MarketplacePluginQuery,
    MarketplacePluginRow,
    PluginDeleteResponse,
    PluginInstallPayload,
    PluginListQuery,
    PluginListResponse,
    PluginProvides,
    PluginRow,
    PluginTaskItem,
    PluginTaskResponse,
    PluginTaskStartResponse,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import (
    WORKSPACE_READ_GUARDS,
    CheckPluginInstallSetting,
    Requirement,
    workspace_write_guards,
)
from controllers.openapi.model_providers import ModelProviderApi
from controllers.openapi.tool_providers import ToolProviderApi
from core.helper.marketplace import MarketplaceSearchUnavailableError, search_plugins
from core.plugin.entities.plugin import PluginEntity
from core.plugin.entities.plugin_daemon import PluginInstallTaskStatus
from core.plugin.impl.exc import PluginDaemonClientSideError, PluginDaemonInternalError
from core.plugin.plugin_service import PluginService
from services.errors.plugin import PluginInstallationForbiddenError

_IN_FLIGHT: Final = frozenset({PluginInstallTaskStatus.Pending, PluginInstallTaskStatus.Running})

_TASK_READ: Final = (*WORKSPACE_READ_GUARDS, CheckPluginInstallSetting())


def _write(permission: RBACPermission) -> tuple[Requirement, ...]:
    return workspace_write_guards(permission, roles=None, extra=(CheckPluginInstallSetting(),))


@contextmanager
def _plugin_errors() -> Generator[None, None, None]:
    try:
        yield
    except PluginInstallationForbiddenError as error:
        raise PluginInstallForbidden(str(error)) from error
    except PluginDaemonClientSideError as error:
        raise BadRequest(error.description) from error
    except PluginDaemonInternalError as error:
        raise PluginServiceUnavailable() from error
    except httpx.HTTPError as error:
        # The daemon client wraps its own transport errors, so a raw httpx error comes from the marketplace.
        raise MarketplaceUnavailable() from error


def _require_marketplace() -> None:
    if not dify_config.MARKETPLACE_ENABLED:
        raise MarketplaceDisabled()


def provides_of(plugin: PluginEntity) -> PluginProvides:
    declaration = plugin.declaration
    return PluginProvides(
        model_provider=f"{plugin.plugin_id}/{declaration.model.provider}" if declaration.model else None,
        tool_provider=f"{plugin.plugin_id}/{declaration.tool.identity.name}" if declaration.tool else None,
    )


def _installed_by_id(workspace_id: str) -> dict[str, PluginEntity]:
    with _plugin_errors():
        return {plugin.plugin_id: plugin for plugin in PluginService.list(workspace_id)}


def _installed(workspace_id: str, plugin_id: str) -> PluginEntity:
    plugin = _installed_by_id(workspace_id).get(plugin_id)
    if plugin is None:
        raise PluginNotInstalled(f"Plugin {plugin_id} is not installed.")
    return plugin


def _task_hint(workspace_id: str, task_id: str) -> Hint:
    return Hint(
        summary="Check again until success or failed",
        op=op_of(PluginTaskApi.get),
        input={"workspace_id": workspace_id, "task_id": task_id},
    )


def _start_response(
    workspace_id: str, task_id: str, all_installed: bool, plugin_ids: Sequence[str]
) -> PluginTaskStartResponse:
    hints = _provider_hints(workspace_id, plugin_ids) if all_installed else [_task_hint(workspace_id, task_id)]
    return PluginTaskStartResponse(task_id=task_id, all_installed=all_installed, hints=hints)


def _plugin_id_of(identifier: str) -> str:
    return identifier.split(":", 1)[0]


def _provider_hints(workspace_id: str, plugin_ids: Sequence[str]) -> list[Hint]:
    installed = _installed_by_id(workspace_id)
    hints: list[Hint] = []
    for plugin_id in plugin_ids:
        plugin = installed.get(plugin_id)
        if plugin is None:
            continue
        provides = provides_of(plugin)
        if provides.model_provider:
            hints.append(
                Hint(
                    summary="Set a credential for the new model provider",
                    op=op_of(ModelProviderApi.get),
                    input={"workspace_id": workspace_id, "provider": provides.model_provider},
                )
            )
        if provides.tool_provider:
            hints.append(
                Hint(
                    summary="Set a credential for the new tools",
                    op=op_of(ToolProviderApi.get),
                    input={"workspace_id": workspace_id, "provider": provides.tool_provider},
                )
            )
    return hints


@openapi_ns.route("/workspaces/<string:workspace_id>/marketplace/plugins")
class MarketplacePluginsApi(Resource):
    @endpoint(
        op="get.marketplace.plugin",
        kind=Kind.LIST,
        summary="Search the marketplace for plugins to install; each hit says if it is installed here",
        examples=(
            Example(title="Find model plugins for OpenAI", input={"query": "openai", "category": "model"}),
            Example(title="Most installed tool plugins", input={"category": "tool"}),
        ),
        requirements=WORKSPACE_READ_GUARDS,
        query=MarketplacePluginQuery,
        returns=(HTTPStatus.OK, MarketplacePluginListResponse, "Marketplace plugins"),
    )
    def get(self, ctx: Context, workspace_id: str, *, query: MarketplacePluginQuery):
        _require_marketplace()
        try:
            page = search_plugins(
                query=query.query,
                category=query.category.value if query.category else "",
                page=query.page,
                page_size=query.limit,
            )
        except MarketplaceSearchUnavailableError as error:
            raise MarketplaceUnavailable() from error
        installed = _installed_by_id(ctx.workspace.id)
        language = ctx.account.interface_language
        rows = [
            MarketplacePluginRow(
                plugin_id=item.plugin_id,
                identifier=item.latest_package_identifier,
                version=item.latest_version,
                category=item.category,
                label=localized(item.label, language),
                brief=localized(item.brief, language),
                authorized_category=item.verification.authorized_category if item.verification else None,
                install_count=item.install_count,
                installed=item.plugin_id in installed,
                installed_version=installed[item.plugin_id].version if item.plugin_id in installed else None,
            )
            for item in page.plugins
        ]
        return MarketplacePluginListResponse.build(page=query.page, limit=query.limit, total=page.total, items=rows)


@openapi_ns.route("/workspaces/<string:workspace_id>/plugins")
class PluginsApi(Resource):
    @endpoint(
        op="get.plugin",
        kind=Kind.OBJECT,
        summary="Plugins installed in the workspace, with the provider ids each one adds",
        examples=(Example(title="Installed model plugins", input={"category": "model"}),),
        requirements=WORKSPACE_READ_GUARDS,
        query=PluginListQuery,
        returns=(HTTPStatus.OK, PluginListResponse, "Installed plugins"),
    )
    def get(self, ctx: Context, workspace_id: str, *, query: PluginListQuery):
        with _plugin_errors():
            plugins = [
                plugin
                for plugin in PluginService.list(ctx.workspace.id)
                if query.category is None or plugin.declaration.category == query.category
            ]
            latest = PluginService.list_latest_versions([plugin.plugin_id for plugin in plugins])
        language = ctx.account.interface_language
        return PluginListResponse(
            data=[
                PluginRow(
                    plugin_id=plugin.plugin_id,
                    identifier=plugin.plugin_unique_identifier,
                    version=plugin.version,
                    latest_version=newest.version if (newest := latest.get(plugin.plugin_id)) else None,
                    category=str(plugin.declaration.category),
                    label=localized(plugin.declaration.label, language),
                    source=str(plugin.source),
                    provides=provides_of(plugin),
                )
                for plugin in plugins
            ]
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/plugins:install")
class PluginInstallApi(Resource):
    @endpoint(
        op="install.plugin",
        kind=Kind.OBJECT,
        summary="Start installing marketplace plugins; finishes in the background, check describe.plugin.task",
        examples=(Example(title="Install one plugin", input={"identifiers": ["langgenius/openai:0.2.1@<sha256>"]}),),
        requirements=_write(RBACPermission.PLUGIN_INSTALL),
        body=PluginInstallPayload,
        returns=(HTTPStatus.OK, PluginTaskStartResponse, "Install started"),
    )
    def post(self, ctx: Context, workspace_id: str, *, body: PluginInstallPayload):
        _require_marketplace()
        with _plugin_errors():
            started = PluginService.install_from_marketplace_pkg(ctx.workspace.id, body.identifiers)
        plugin_ids = [_plugin_id_of(identifier) for identifier in body.identifiers]
        return _start_response(ctx.workspace.id, started.task_id, started.all_installed, plugin_ids)


@openapi_ns.route("/workspaces/<string:workspace_id>/plugin-tasks/<string:task_id>")
class PluginTaskApi(Resource):
    @endpoint(
        op="describe.plugin.task",
        kind=Kind.OBJECT,
        summary="Progress of a plugin install or upgrade; check again while pending or running",
        examples=(Example(title="Check an install", input={"task_id": "<task_id>"}),),
        requirements=_TASK_READ,
        returns=(HTTPStatus.OK, PluginTaskResponse, "Install task"),
    )
    def get(self, ctx: Context, workspace_id: str, task_id: str):
        with _plugin_errors():
            task = PluginService.fetch_install_task(ctx.workspace.id, task_id)
        if task.status in _IN_FLIGHT:
            hints = [_task_hint(ctx.workspace.id, task_id)]
        elif task.status == PluginInstallTaskStatus.Success:
            hints = _provider_hints(ctx.workspace.id, [plugin.plugin_id for plugin in task.plugins])
        else:
            hints = []
        return PluginTaskResponse(
            task_id=task_id,
            status=str(task.status),
            plugins=[
                PluginTaskItem(
                    plugin_id=plugin.plugin_id,
                    identifier=plugin.plugin_unique_identifier,
                    status=str(plugin.status),
                    message=plugin.message,
                )
                for plugin in task.plugins
            ],
            hints=hints,
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/plugins/<path:plugin_id>")
class PluginApi(Resource):
    @endpoint(
        op="delete.plugin",
        kind=Kind.OBJECT,
        summary="Uninstall a plugin from the workspace",
        examples=(Example(title="Uninstall OpenAI", input={"plugin_id": "langgenius/openai"}),),
        requirements=_write(RBACPermission.PLUGIN_DELETE),
        returns=(HTTPStatus.OK, PluginDeleteResponse, "Plugin uninstalled"),
    )
    def delete(self, ctx: Context, workspace_id: str, plugin_id: str):
        plugin = _installed(ctx.workspace.id, plugin_id)
        with _plugin_errors():
            uninstalled = PluginService.uninstall(ctx.workspace.id, plugin.installation_id)
        if not uninstalled:
            raise PluginServiceUnavailable()
        return PluginDeleteResponse(plugin_id=plugin_id, deleted=True)
