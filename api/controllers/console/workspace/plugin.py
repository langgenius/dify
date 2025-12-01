import io
from typing import Literal

from flask import request, send_file
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.console import console_ns
from controllers.console.workspace import plugin_permission_required
from controllers.console.wraps import account_initialization_required, is_admin_or_owner_required, setup_required
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.impl.exc import PluginDaemonClientSideError
from libs.login import current_account_with_tenant, login_required
from models.account import TenantPluginAutoUpgradeStrategy, TenantPluginPermission
from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService
from services.plugin.plugin_parameter_service import PluginParameterService
from services.plugin.plugin_permission_service import PluginPermissionService
from services.plugin.plugin_service import PluginService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


def reg(cls: type[BaseModel]):
    console_ns.schema_model(cls.__name__, cls.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


@console_ns.route("/workspaces/current/plugin/debugging-key")
class PluginDebuggingKeyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(debug_required=True)
    def get(self):
        _, tenant_id = current_account_with_tenant()

        try:
            return {
                "key": PluginService.get_debugging_key(tenant_id),
                "host": dify_config.PLUGIN_REMOTE_INSTALL_HOST,
                "port": dify_config.PLUGIN_REMOTE_INSTALL_PORT,
            }
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


class ParserList(BaseModel):
    page: int = Field(default=1)
    page_size: int = Field(default=256)


reg(ParserList)


@console_ns.route("/workspaces/current/plugin/list")
class PluginListApi(Resource):
    @console_ns.expect(console_ns.models[ParserList.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, tenant_id = current_account_with_tenant()
        args = ParserList.model_validate(request.args.to_dict(flat=True))  # type: ignore
        try:
            plugins_with_total = PluginService.list_with_total(tenant_id, args.page, args.page_size)
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder({"plugins": plugins_with_total.list, "total": plugins_with_total.total})


class ParserLatest(BaseModel):
    plugin_ids: list[str]


class ParserIcon(BaseModel):
    tenant_id: str
    filename: str


class ParserAsset(BaseModel):
    plugin_unique_identifier: str
    file_name: str


class ParserGithubUpload(BaseModel):
    repo: str
    version: str
    package: str


class ParserPluginIdentifiers(BaseModel):
    plugin_unique_identifiers: list[str]


class ParserGithubInstall(BaseModel):
    plugin_unique_identifier: str
    repo: str
    version: str
    package: str


class ParserPluginIdentifierQuery(BaseModel):
    plugin_unique_identifier: str


class ParserTasks(BaseModel):
    page: int
    page_size: int


class ParserMarketplaceUpgrade(BaseModel):
    original_plugin_unique_identifier: str
    new_plugin_unique_identifier: str


class ParserGithubUpgrade(BaseModel):
    original_plugin_unique_identifier: str
    new_plugin_unique_identifier: str
    repo: str
    version: str
    package: str


class ParserUninstall(BaseModel):
    plugin_installation_id: str


class ParserPermissionChange(BaseModel):
    install_permission: TenantPluginPermission.InstallPermission
    debug_permission: TenantPluginPermission.DebugPermission


class ParserDynamicOptions(BaseModel):
    plugin_id: str
    provider: str
    action: str
    parameter: str
    credential_id: str | None = None
    provider_type: Literal["tool", "trigger"]


class PluginPermissionSettingsPayload(BaseModel):
    install_permission: TenantPluginPermission.InstallPermission = TenantPluginPermission.InstallPermission.EVERYONE
    debug_permission: TenantPluginPermission.DebugPermission = TenantPluginPermission.DebugPermission.EVERYONE


class PluginAutoUpgradeSettingsPayload(BaseModel):
    strategy_setting: TenantPluginAutoUpgradeStrategy.StrategySetting = (
        TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY
    )
    upgrade_time_of_day: int = 0
    upgrade_mode: TenantPluginAutoUpgradeStrategy.UpgradeMode = TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE
    exclude_plugins: list[str] = Field(default_factory=list)
    include_plugins: list[str] = Field(default_factory=list)


class ParserPreferencesChange(BaseModel):
    permission: PluginPermissionSettingsPayload
    auto_upgrade: PluginAutoUpgradeSettingsPayload


class ParserExcludePlugin(BaseModel):
    plugin_id: str


class ParserReadme(BaseModel):
    plugin_unique_identifier: str
    language: str = Field(default="en-US")


reg(ParserLatest)
reg(ParserIcon)
reg(ParserAsset)
reg(ParserGithubUpload)
reg(ParserPluginIdentifiers)
reg(ParserGithubInstall)
reg(ParserPluginIdentifierQuery)
reg(ParserTasks)
reg(ParserMarketplaceUpgrade)
reg(ParserGithubUpgrade)
reg(ParserUninstall)
reg(ParserPermissionChange)
reg(ParserDynamicOptions)
reg(ParserPreferencesChange)
reg(ParserExcludePlugin)
reg(ParserReadme)


@console_ns.route("/workspaces/current/plugin/list/latest-versions")
class PluginListLatestVersionsApi(Resource):
    @console_ns.expect(console_ns.models[ParserLatest.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        args = ParserLatest.model_validate(console_ns.payload)

        try:
            versions = PluginService.list_latest_versions(args.plugin_ids)
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder({"versions": versions})


@console_ns.route("/workspaces/current/plugin/list/installations/ids")
class PluginListInstallationsFromIdsApi(Resource):
    @console_ns.expect(console_ns.models[ParserLatest.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        _, tenant_id = current_account_with_tenant()

        args = ParserLatest.model_validate(console_ns.payload)

        try:
            plugins = PluginService.list_installations_from_ids(tenant_id, args.plugin_ids)
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder({"plugins": plugins})


@console_ns.route("/workspaces/current/plugin/icon")
class PluginIconApi(Resource):
    @console_ns.expect(console_ns.models[ParserIcon.__name__])
    @setup_required
    def get(self):
        args = ParserIcon.model_validate(request.args.to_dict(flat=True))  # type: ignore

        try:
            icon_bytes, mimetype = PluginService.get_asset(args.tenant_id, args.filename)
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        icon_cache_max_age = dify_config.TOOL_ICON_CACHE_MAX_AGE
        return send_file(io.BytesIO(icon_bytes), mimetype=mimetype, max_age=icon_cache_max_age)


@console_ns.route("/workspaces/current/plugin/asset")
class PluginAssetApi(Resource):
    @console_ns.expect(console_ns.models[ParserAsset.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        args = ParserAsset.model_validate(request.args.to_dict(flat=True))  # type: ignore

        _, tenant_id = current_account_with_tenant()
        try:
            binary = PluginService.extract_asset(tenant_id, args.plugin_unique_identifier, args.file_name)
            return send_file(io.BytesIO(binary), mimetype="application/octet-stream")
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


@console_ns.route("/workspaces/current/plugin/upload/pkg")
class PluginUploadFromPkgApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        _, tenant_id = current_account_with_tenant()

        file = request.files["pkg"]

        # check file size
        if file.content_length > dify_config.PLUGIN_MAX_PACKAGE_SIZE:
            raise ValueError("File size exceeds the maximum allowed size")

        content = file.read()
        try:
            response = PluginService.upload_pkg(tenant_id, content)
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder(response)


@console_ns.route("/workspaces/current/plugin/upload/github")
class PluginUploadFromGithubApi(Resource):
    @console_ns.expect(console_ns.models[ParserGithubUpload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        _, tenant_id = current_account_with_tenant()

        args = ParserGithubUpload.model_validate(console_ns.payload)

        try:
            response = PluginService.upload_pkg_from_github(tenant_id, args.repo, args.version, args.package)
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder(response)


@console_ns.route("/workspaces/current/plugin/upload/bundle")
class PluginUploadFromBundleApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        _, tenant_id = current_account_with_tenant()

        file = request.files["bundle"]

        # check file size
        if file.content_length > dify_config.PLUGIN_MAX_BUNDLE_SIZE:
            raise ValueError("File size exceeds the maximum allowed size")

        content = file.read()
        try:
            response = PluginService.upload_bundle(tenant_id, content)
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder(response)


@console_ns.route("/workspaces/current/plugin/install/pkg")
class PluginInstallFromPkgApi(Resource):
    @console_ns.expect(console_ns.models[ParserPluginIdentifiers.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        _, tenant_id = current_account_with_tenant()
        args = ParserPluginIdentifiers.model_validate(console_ns.payload)

        try:
            response = PluginService.install_from_local_pkg(tenant_id, args.plugin_unique_identifiers)
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder(response)


@console_ns.route("/workspaces/current/plugin/install/github")
class PluginInstallFromGithubApi(Resource):
    @console_ns.expect(console_ns.models[ParserGithubInstall.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        _, tenant_id = current_account_with_tenant()

        args = ParserGithubInstall.model_validate(console_ns.payload)

        try:
            response = PluginService.install_from_github(
                tenant_id,
                args.plugin_unique_identifier,
                args.repo,
                args.version,
                args.package,
            )
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder(response)


@console_ns.route("/workspaces/current/plugin/install/marketplace")
class PluginInstallFromMarketplaceApi(Resource):
    @console_ns.expect(console_ns.models[ParserPluginIdentifiers.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        _, tenant_id = current_account_with_tenant()

        args = ParserPluginIdentifiers.model_validate(console_ns.payload)

        try:
            response = PluginService.install_from_marketplace_pkg(tenant_id, args.plugin_unique_identifiers)
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder(response)


@console_ns.route("/workspaces/current/plugin/marketplace/pkg")
class PluginFetchMarketplacePkgApi(Resource):
    @console_ns.expect(console_ns.models[ParserPluginIdentifierQuery.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def get(self):
        _, tenant_id = current_account_with_tenant()
        args = ParserPluginIdentifierQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        try:
            return jsonable_encoder(
                {
                    "manifest": PluginService.fetch_marketplace_pkg(
                        tenant_id,
                        args.plugin_unique_identifier,
                    )
                }
            )
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


@console_ns.route("/workspaces/current/plugin/fetch-manifest")
class PluginFetchManifestApi(Resource):
    @console_ns.expect(console_ns.models[ParserPluginIdentifierQuery.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def get(self):
        _, tenant_id = current_account_with_tenant()

        args = ParserPluginIdentifierQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        try:
            return jsonable_encoder(
                {"manifest": PluginService.fetch_plugin_manifest(tenant_id, args.plugin_unique_identifier).model_dump()}
            )
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


@console_ns.route("/workspaces/current/plugin/tasks")
class PluginFetchInstallTasksApi(Resource):
    @console_ns.expect(console_ns.models[ParserTasks.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def get(self):
        _, tenant_id = current_account_with_tenant()

        args = ParserTasks.model_validate(request.args.to_dict(flat=True))  # type: ignore

        try:
            return jsonable_encoder({"tasks": PluginService.fetch_install_tasks(tenant_id, args.page, args.page_size)})
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


@console_ns.route("/workspaces/current/plugin/tasks/<task_id>")
class PluginFetchInstallTaskApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def get(self, task_id: str):
        _, tenant_id = current_account_with_tenant()

        try:
            return jsonable_encoder({"task": PluginService.fetch_install_task(tenant_id, task_id)})
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


@console_ns.route("/workspaces/current/plugin/tasks/<task_id>/delete")
class PluginDeleteInstallTaskApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self, task_id: str):
        _, tenant_id = current_account_with_tenant()

        try:
            return {"success": PluginService.delete_install_task(tenant_id, task_id)}
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


@console_ns.route("/workspaces/current/plugin/tasks/delete_all")
class PluginDeleteAllInstallTaskItemsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        _, tenant_id = current_account_with_tenant()

        try:
            return {"success": PluginService.delete_all_install_task_items(tenant_id)}
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


@console_ns.route("/workspaces/current/plugin/tasks/<task_id>/delete/<path:identifier>")
class PluginDeleteInstallTaskItemApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self, task_id: str, identifier: str):
        _, tenant_id = current_account_with_tenant()

        try:
            return {"success": PluginService.delete_install_task_item(tenant_id, task_id, identifier)}
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


@console_ns.route("/workspaces/current/plugin/upgrade/marketplace")
class PluginUpgradeFromMarketplaceApi(Resource):
    @console_ns.expect(console_ns.models[ParserMarketplaceUpgrade.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        _, tenant_id = current_account_with_tenant()

        args = ParserMarketplaceUpgrade.model_validate(console_ns.payload)

        try:
            return jsonable_encoder(
                PluginService.upgrade_plugin_with_marketplace(
                    tenant_id, args.original_plugin_unique_identifier, args.new_plugin_unique_identifier
                )
            )
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


@console_ns.route("/workspaces/current/plugin/upgrade/github")
class PluginUpgradeFromGithubApi(Resource):
    @console_ns.expect(console_ns.models[ParserGithubUpgrade.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        _, tenant_id = current_account_with_tenant()

        args = ParserGithubUpgrade.model_validate(console_ns.payload)

        try:
            return jsonable_encoder(
                PluginService.upgrade_plugin_with_github(
                    tenant_id,
                    args.original_plugin_unique_identifier,
                    args.new_plugin_unique_identifier,
                    args.repo,
                    args.version,
                    args.package,
                )
            )
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


@console_ns.route("/workspaces/current/plugin/uninstall")
class PluginUninstallApi(Resource):
    @console_ns.expect(console_ns.models[ParserUninstall.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        args = ParserUninstall.model_validate(console_ns.payload)

        _, tenant_id = current_account_with_tenant()

        try:
            return {"success": PluginService.uninstall(tenant_id, args.plugin_installation_id)}
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


@console_ns.route("/workspaces/current/plugin/permission/change")
class PluginChangePermissionApi(Resource):
    @console_ns.expect(console_ns.models[ParserPermissionChange.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        current_user, current_tenant_id = current_account_with_tenant()
        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        args = ParserPermissionChange.model_validate(console_ns.payload)

        tenant_id = current_tenant_id

        return {
            "success": PluginPermissionService.change_permission(
                tenant_id, args.install_permission, args.debug_permission
            )
        }


@console_ns.route("/workspaces/current/plugin/permission/fetch")
class PluginFetchPermissionApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, tenant_id = current_account_with_tenant()

        permission = PluginPermissionService.get_permission(tenant_id)
        if not permission:
            return jsonable_encoder(
                {
                    "install_permission": TenantPluginPermission.InstallPermission.EVERYONE,
                    "debug_permission": TenantPluginPermission.DebugPermission.EVERYONE,
                }
            )

        return jsonable_encoder(
            {
                "install_permission": permission.install_permission,
                "debug_permission": permission.debug_permission,
            }
        )


@console_ns.route("/workspaces/current/plugin/parameters/dynamic-options")
class PluginFetchDynamicSelectOptionsApi(Resource):
    @console_ns.expect(console_ns.models[ParserDynamicOptions.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def get(self):
        current_user, tenant_id = current_account_with_tenant()
        user_id = current_user.id

        args = ParserDynamicOptions.model_validate(request.args.to_dict(flat=True))  # type: ignore

        try:
            options = PluginParameterService.get_dynamic_select_options(
                tenant_id=tenant_id,
                user_id=user_id,
                plugin_id=args.plugin_id,
                provider=args.provider,
                action=args.action,
                parameter=args.parameter,
                credential_id=args.credential_id,
                provider_type=args.provider_type,
            )
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder({"options": options})


@console_ns.route("/workspaces/current/plugin/preferences/change")
class PluginChangePreferencesApi(Resource):
    @console_ns.expect(console_ns.models[ParserPreferencesChange.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()
        if not user.is_admin_or_owner:
            raise Forbidden()

        args = ParserPreferencesChange.model_validate(console_ns.payload)

        permission = args.permission

        install_permission = permission.install_permission
        debug_permission = permission.debug_permission

        auto_upgrade = args.auto_upgrade

        strategy_setting = auto_upgrade.strategy_setting
        upgrade_time_of_day = auto_upgrade.upgrade_time_of_day
        upgrade_mode = auto_upgrade.upgrade_mode
        exclude_plugins = auto_upgrade.exclude_plugins
        include_plugins = auto_upgrade.include_plugins

        # set permission
        set_permission_result = PluginPermissionService.change_permission(
            tenant_id,
            install_permission,
            debug_permission,
        )
        if not set_permission_result:
            return jsonable_encoder({"success": False, "message": "Failed to set permission"})

        # set auto upgrade strategy
        set_auto_upgrade_strategy_result = PluginAutoUpgradeService.change_strategy(
            tenant_id,
            strategy_setting,
            upgrade_time_of_day,
            upgrade_mode,
            exclude_plugins,
            include_plugins,
        )
        if not set_auto_upgrade_strategy_result:
            return jsonable_encoder({"success": False, "message": "Failed to set auto upgrade strategy"})

        return jsonable_encoder({"success": True})


@console_ns.route("/workspaces/current/plugin/preferences/fetch")
class PluginFetchPreferencesApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, tenant_id = current_account_with_tenant()

        permission = PluginPermissionService.get_permission(tenant_id)
        permission_dict = {
            "install_permission": TenantPluginPermission.InstallPermission.EVERYONE,
            "debug_permission": TenantPluginPermission.DebugPermission.EVERYONE,
        }

        if permission:
            permission_dict["install_permission"] = permission.install_permission
            permission_dict["debug_permission"] = permission.debug_permission

        auto_upgrade = PluginAutoUpgradeService.get_strategy(tenant_id)
        auto_upgrade_dict = {
            "strategy_setting": TenantPluginAutoUpgradeStrategy.StrategySetting.DISABLED,
            "upgrade_time_of_day": 0,
            "upgrade_mode": TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
            "exclude_plugins": [],
            "include_plugins": [],
        }

        if auto_upgrade:
            auto_upgrade_dict = {
                "strategy_setting": auto_upgrade.strategy_setting,
                "upgrade_time_of_day": auto_upgrade.upgrade_time_of_day,
                "upgrade_mode": auto_upgrade.upgrade_mode,
                "exclude_plugins": auto_upgrade.exclude_plugins,
                "include_plugins": auto_upgrade.include_plugins,
            }

        return jsonable_encoder({"permission": permission_dict, "auto_upgrade": auto_upgrade_dict})


@console_ns.route("/workspaces/current/plugin/preferences/autoupgrade/exclude")
class PluginAutoUpgradeExcludePluginApi(Resource):
    @console_ns.expect(console_ns.models[ParserExcludePlugin.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        # exclude one single plugin
        _, tenant_id = current_account_with_tenant()

        args = ParserExcludePlugin.model_validate(console_ns.payload)

        return jsonable_encoder({"success": PluginAutoUpgradeService.exclude_plugin(tenant_id, args.plugin_id)})


@console_ns.route("/workspaces/current/plugin/readme")
class PluginReadmeApi(Resource):
    @console_ns.expect(console_ns.models[ParserReadme.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, tenant_id = current_account_with_tenant()
        args = ParserReadme.model_validate(request.args.to_dict(flat=True))  # type: ignore
        return jsonable_encoder(
            {"readme": PluginService.fetch_plugin_readme(tenant_id, args.plugin_unique_identifier, args.language)}
        )
