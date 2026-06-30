import io
from collections.abc import Mapping
from datetime import datetime
from typing import Any, Literal, TypedDict

from flask import request, send_file
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, RootModel
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.fields import BinaryFileResponse, SuccessResponse
from controllers.common.schema import (
    query_params_from_model,
    register_enum_models,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.workspace import plugin_permission_required
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    is_admin_or_owner_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
    with_current_user_id,
)
from core.helper.position_helper import is_filtered
from core.plugin.entities.bundle import PluginBundleDependency
from core.plugin.entities.parameters import PluginParameterOption
from core.plugin.entities.plugin import (
    PluginCategory,
    PluginDeclaration,
    PluginEntity,
    PluginInstallation,
    PluginInstallationSource,
)
from core.plugin.entities.plugin_daemon import PluginDecodeResponse, PluginInstallTask, PluginInstallTaskStartResponse
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.plugin.plugin_service import PluginService
from core.tools.builtin_tool.providers._positions import BuiltinToolProviderSort
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.tool_manager import ToolManager
from fields.base import ResponseModel
from graphon.model_runtime.utils.encoders import jsonable_encoder
from libs.helper import dump_response
from libs.login import login_required
from models.account import Account, TenantPluginAutoUpgradeStrategy, TenantPluginPermission
from models.provider_ids import ToolProviderID
from services.entities.model_provider_entities import ProviderEntityResponse
from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService
from services.plugin.plugin_parameter_service import PluginParameterService
from services.plugin.plugin_permission_service import PluginPermissionService
from services.tools.tools_transform_service import ToolTransformService


class AutoUpgradeSettingsResponse(TypedDict):
    strategy_setting: TenantPluginAutoUpgradeStrategy.StrategySetting
    upgrade_time_of_day: int
    upgrade_mode: TenantPluginAutoUpgradeStrategy.UpgradeMode
    exclude_plugins: list[str]
    include_plugins: list[str]


class ParserList(BaseModel):
    page: int = Field(default=1, ge=1, description="Page number")
    page_size: int = Field(default=256, ge=1, le=256, description="Page size (1-256)")


class PluginCategoryListQuery(BaseModel):
    page: int = Field(default=1, ge=1, description="Page number")
    page_size: int = Field(default=256, ge=1, le=256, description="Page size (1-256)")


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
    page: int = Field(default=1, ge=1, description="Page number")
    page_size: int = Field(default=256, ge=1, le=256, description="Page size (1-256)")


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
    install_permission: TenantPluginPermission.InstallPermission = TenantPluginPermission.InstallPermission.EVERYONE
    debug_permission: TenantPluginPermission.DebugPermission = TenantPluginPermission.DebugPermission.EVERYONE


class ParserDynamicOptions(BaseModel):
    plugin_id: str
    provider: str
    action: str
    parameter: str
    credential_id: str | None = None
    provider_type: Literal["tool", "trigger"]


class ParserDynamicOptionsWithCredentials(BaseModel):
    plugin_id: str
    provider: str
    action: str
    parameter: str
    credential_id: str
    credentials: Mapping[str, Any]


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


class PluginAutoUpgradeChangeResponse(ResponseModel):
    success: bool
    message: str | None = None


class PluginAutoUpgradeSettingsResponseModel(ResponseModel):
    strategy_setting: TenantPluginAutoUpgradeStrategy.StrategySetting
    upgrade_time_of_day: int
    upgrade_mode: TenantPluginAutoUpgradeStrategy.UpgradeMode
    exclude_plugins: list[str]
    include_plugins: list[str]


class PluginAutoUpgradeFetchResponse(ResponseModel):
    category: TenantPluginAutoUpgradeStrategy.PluginCategory
    auto_upgrade: PluginAutoUpgradeSettingsResponseModel


class PluginDeclarationResponse(ResponseModel):
    version: str
    author: str | None
    name: str
    description: I18nObject
    icon: str
    icon_dark: str | None = None
    label: I18nObject
    category: PluginCategory
    created_at: datetime
    resource: Mapping[str, Any]
    plugins: Mapping[str, list[str] | None]
    tags: list[str] = Field(default_factory=list)
    repo: str | None = None
    verified: bool = False
    tool: Mapping[str, Any] | None = None
    model: ProviderEntityResponse | None = None
    endpoint: Mapping[str, Any] | None = None
    agent_strategy: Mapping[str, Any] | None = None
    datasource: Mapping[str, Any] | None = None
    trigger: Mapping[str, Any] | None = None
    meta: Mapping[str, Any]


class ParserAutoUpgradeChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: TenantPluginAutoUpgradeStrategy.PluginCategory
    auto_upgrade: PluginAutoUpgradeSettingsPayload


class ParserAutoUpgradeFetch(BaseModel):
    category: TenantPluginAutoUpgradeStrategy.PluginCategory


class ParserExcludePlugin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plugin_id: str
    category: TenantPluginAutoUpgradeStrategy.PluginCategory


class ParserReadme(BaseModel):
    plugin_unique_identifier: str
    language: str = Field(default="en-US")


class PluginDebuggingKeyResponse(ResponseModel):
    key: str
    host: str
    port: int


class PluginCategoryInstalledPluginResponse(ResponseModel):
    id: str
    name: str
    tenant_id: str
    plugin_id: str
    plugin_unique_identifier: str
    endpoints_active: int
    endpoints_setups: int
    installation_id: str
    declaration: PluginDeclarationResponse
    runtime_type: str
    version: str
    created_at: datetime
    updated_at: datetime
    source: PluginInstallationSource
    checksum: str
    meta: Mapping[str, Any]


class PluginCategoryBuiltinToolResponse(ResponseModel):
    model_config = ConfigDict(extra="allow")

    author: str
    name: str
    label: I18nObject
    description: I18nObject
    parameters: list[Mapping[str, Any]] | None = None
    labels: list[str]
    output_schema: Mapping[str, object]


class PluginCategoryBuiltinToolProviderResponse(ResponseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    author: str
    name: str
    plugin_id: str | None
    plugin_unique_identifier: str | None
    description: I18nObject
    icon: str | Mapping[str, str]
    icon_dark: str | Mapping[str, str] | None
    label: I18nObject
    type: ToolProviderType
    team_credentials: Mapping[str, object]
    is_team_authorization: bool
    allow_delete: bool
    tools: list[PluginCategoryBuiltinToolResponse]
    labels: list[str]


class PluginCategoryListResponse(ResponseModel):
    plugins: list[PluginCategoryInstalledPluginResponse]
    builtin_tools: list[PluginCategoryBuiltinToolProviderResponse]
    has_more: bool


class PluginBundleUploadResponse(RootModel[list[PluginBundleDependency]]):
    pass


class PluginListResponse(ResponseModel):
    plugins: list[PluginEntity]
    total: int


class PluginVersionsResponse(ResponseModel):
    versions: Mapping[str, PluginService.LatestPluginCache | None]


class PluginInstallationsResponse(ResponseModel):
    plugins: list[PluginInstallation]


class PluginManifestResponse(ResponseModel):
    manifest: PluginDeclaration


class PluginTasksResponse(ResponseModel):
    tasks: list[PluginInstallTask]


class PluginTaskResponse(ResponseModel):
    task: PluginInstallTask


class PluginPermissionResponse(ResponseModel):
    install_permission: TenantPluginPermission.InstallPermission
    debug_permission: TenantPluginPermission.DebugPermission


class PluginDynamicOptionsResponse(ResponseModel):
    options: list[PluginParameterOption]


class PluginOperationSuccessResponse(ResponseModel):
    success: bool
    message: str | None = None


class PluginReadmeResponse(ResponseModel):
    readme: str


register_schema_models(
    console_ns,
    ParserList,
    PluginCategoryListQuery,
    PluginAutoUpgradeSettingsPayload,
    PluginPermissionSettingsPayload,
    ParserLatest,
    ParserIcon,
    ParserAsset,
    ParserGithubUpload,
    ParserPluginIdentifiers,
    ParserGithubInstall,
    ParserPluginIdentifierQuery,
    ParserTasks,
    ParserMarketplaceUpgrade,
    ParserGithubUpgrade,
    ParserUninstall,
    ParserPermissionChange,
    ParserDynamicOptions,
    ParserDynamicOptionsWithCredentials,
    ParserAutoUpgradeChange,
    ParserAutoUpgradeFetch,
    ParserExcludePlugin,
    ParserReadme,
)
register_response_schema_models(
    console_ns,
    PluginAutoUpgradeChangeResponse,
    PluginAutoUpgradeFetchResponse,
    PluginAutoUpgradeSettingsResponseModel,
    BinaryFileResponse,
    PluginCategoryBuiltinToolProviderResponse,
    PluginCategoryBuiltinToolResponse,
    PluginCategoryInstalledPluginResponse,
    PluginCategoryListResponse,
    PluginBundleUploadResponse,
    PluginDecodeResponse,
    PluginDebuggingKeyResponse,
    PluginDynamicOptionsResponse,
    PluginInstallationsResponse,
    PluginInstallTaskStartResponse,
    PluginListResponse,
    PluginManifestResponse,
    PluginOperationSuccessResponse,
    PluginPermissionResponse,
    PluginReadmeResponse,
    PluginTaskResponse,
    PluginTasksResponse,
    PluginVersionsResponse,
    SuccessResponse,
)

register_enum_models(
    console_ns,
    TenantPluginPermission.DebugPermission,
    TenantPluginAutoUpgradeStrategy.PluginCategory,
    TenantPluginAutoUpgradeStrategy.UpgradeMode,
    TenantPluginAutoUpgradeStrategy.StrategySetting,
    TenantPluginPermission.InstallPermission,
)


def _default_auto_upgrade_settings(
    tenant_id: str,
    category: TenantPluginAutoUpgradeStrategy.PluginCategory,
) -> AutoUpgradeSettingsResponse:
    return {
        "strategy_setting": PluginAutoUpgradeService.default_strategy_setting_for_category(category),
        "upgrade_time_of_day": PluginAutoUpgradeService.default_upgrade_time_of_day(tenant_id),
        "upgrade_mode": TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
        "exclude_plugins": [],
        "include_plugins": [],
    }


def _auto_upgrade_settings_to_dict(strategy: TenantPluginAutoUpgradeStrategy) -> AutoUpgradeSettingsResponse:
    return {
        "strategy_setting": strategy.strategy_setting,
        "upgrade_time_of_day": strategy.upgrade_time_of_day,
        "upgrade_mode": strategy.upgrade_mode,
        "exclude_plugins": strategy.exclude_plugins,
        "include_plugins": strategy.include_plugins,
    }


def _read_upload_content(file: FileStorage, max_size: int) -> bytes:
    """
    Read the uploaded file and validate its actual size before delegating to the plugin service.

    FileStorage.content_length is not reliable for multipart test uploads and may be zero even when
    content exists, so the controllers validate against the loaded bytes instead.
    """
    content = file.stream.read()
    if len(content) > max_size:
        raise ValueError("File size exceeds the maximum allowed size")

    return content


def _list_hardcoded_builtin_tool_providers(tenant_id: str) -> list[dict[str, Any]]:
    db_builtin_providers = {
        str(ToolProviderID(provider.provider)): provider
        for provider in ToolManager.list_default_builtin_providers(tenant_id)
    }
    builtin_providers = []

    for provider in ToolManager.list_hardcoded_providers():
        if is_filtered(
            include_set=dify_config.POSITION_TOOL_INCLUDES_SET,
            exclude_set=dify_config.POSITION_TOOL_EXCLUDES_SET,
            data=provider,
            name_func=lambda provider_controller: provider_controller.entity.identity.name,
        ):
            continue

        user_provider = ToolTransformService.builtin_provider_to_user_provider(
            provider_controller=provider,
            db_provider=db_builtin_providers.get(provider.entity.identity.name),
            decrypt_credentials=False,
        )
        ToolTransformService.repack_provider(tenant_id=tenant_id, provider=user_provider)
        builtin_providers.append(user_provider)

    return [provider.to_dict() for provider in BuiltinToolProviderSort.sort(builtin_providers)]


@console_ns.route("/workspaces/current/plugin/debugging-key")
class PluginDebuggingKeyApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[PluginDebuggingKeyResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_DEBUG, resource_required=False)
    @plugin_permission_required(debug_required=True)
    @with_current_tenant_id
    def get(self, tenant_id: str):
        try:
            return {
                "key": PluginService.get_debugging_key(tenant_id),
                "host": dify_config.PLUGIN_REMOTE_INSTALL_HOST,
                "port": dify_config.PLUGIN_REMOTE_INSTALL_PORT,
            }
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400


@console_ns.route("/workspaces/current/plugin/list")
class PluginListApi(Resource):
    @console_ns.doc(params=query_params_from_model(ParserList))
    @console_ns.response(200, "Success", console_ns.models[PluginListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user_id
    @with_current_tenant_id
    def get(self, tenant_id: str, user_id: str):
        args = ParserList.model_validate(request.args.to_dict(flat=True))
        try:
            plugins_with_total = PluginService.list_with_total(tenant_id, user_id, args.page, args.page_size)
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400

        return jsonable_encoder({"plugins": plugins_with_total.list, "total": plugins_with_total.total})


@console_ns.route("/workspaces/current/plugin/<string:category>/list")
class PluginCategoryListApi(Resource):
    @console_ns.doc(params=query_params_from_model(PluginCategoryListQuery))
    @console_ns.response(200, "Success", console_ns.models[PluginCategoryListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, category: str):
        args = PluginCategoryListQuery.model_validate(request.args.to_dict(flat=True))

        try:
            plugin_category = PluginCategory(category)
        except ValueError:
            return {"code": "invalid_param", "message": "invalid plugin category"}, 400

        try:
            plugins = PluginService.list_by_category(tenant_id, plugin_category, args.page, args.page_size)
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400

        builtin_tools = []
        if plugin_category == PluginCategory.Tool:
            builtin_tools = _list_hardcoded_builtin_tool_providers(tenant_id)

        return dump_response(
            PluginCategoryListResponse,
            {
                "plugins": jsonable_encoder(plugins.list),
                "builtin_tools": builtin_tools,
                "has_more": plugins.has_more,
            },
        )


@console_ns.route("/workspaces/current/plugin/list/latest-versions")
class PluginListLatestVersionsApi(Resource):
    @console_ns.expect(console_ns.models[ParserLatest.__name__])
    @console_ns.response(200, "Success", console_ns.models[PluginVersionsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        args = ParserLatest.model_validate(console_ns.payload)

        try:
            versions = PluginService.list_latest_versions(args.plugin_ids)
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400

        return jsonable_encoder({"versions": versions})


@console_ns.route("/workspaces/current/plugin/list/installations/ids")
class PluginListInstallationsFromIdsApi(Resource):
    @console_ns.expect(console_ns.models[ParserLatest.__name__])
    @console_ns.response(200, "Success", console_ns.models[PluginInstallationsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str):
        args = ParserLatest.model_validate(console_ns.payload)

        try:
            plugins = PluginService.list_installations_from_ids(tenant_id, args.plugin_ids)
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400

        return jsonable_encoder({"plugins": plugins})


@console_ns.route("/workspaces/current/plugin/icon")
class PluginIconApi(Resource):
    @console_ns.doc(params=query_params_from_model(ParserIcon))
    @console_ns.response(200, "Success", console_ns.models[BinaryFileResponse.__name__])
    @setup_required
    def get(self):
        args = ParserIcon.model_validate(request.args.to_dict(flat=True))

        try:
            icon_bytes, mimetype = PluginService.get_asset(args.tenant_id, args.filename)
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400

        icon_cache_max_age = dify_config.TOOL_ICON_CACHE_MAX_AGE
        return send_file(io.BytesIO(icon_bytes), mimetype=mimetype, max_age=icon_cache_max_age)


@console_ns.route("/workspaces/current/plugin/asset")
class PluginAssetApi(Resource):
    @console_ns.doc(params=query_params_from_model(ParserAsset))
    @console_ns.response(200, "Success", console_ns.models[BinaryFileResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        args = ParserAsset.model_validate(request.args.to_dict(flat=True))

        try:
            binary = PluginService.extract_asset(tenant_id, args.plugin_unique_identifier, args.file_name)
            return send_file(io.BytesIO(binary), mimetype="application/octet-stream")
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400


@console_ns.route("/workspaces/current/plugin/upload/pkg")
class PluginUploadFromPkgApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[PluginDecodeResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_INSTALL, resource_required=False)
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def post(self, tenant_id: str):
        file = request.files["pkg"]
        content = _read_upload_content(file, dify_config.PLUGIN_MAX_PACKAGE_SIZE)
        try:
            response = PluginService.upload_pkg(tenant_id, content)
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400

        return jsonable_encoder(response)


@console_ns.route("/workspaces/current/plugin/upload/github")
class PluginUploadFromGithubApi(Resource):
    @console_ns.expect(console_ns.models[ParserGithubUpload.__name__])
    @console_ns.response(200, "Success", console_ns.models[PluginDecodeResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_INSTALL, resource_required=False)
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def post(self, tenant_id: str):
        args = ParserGithubUpload.model_validate(console_ns.payload)

        try:
            response = PluginService.upload_pkg_from_github(tenant_id, args.repo, args.version, args.package)
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400

        return jsonable_encoder(response)


@console_ns.route("/workspaces/current/plugin/upload/bundle")
class PluginUploadFromBundleApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[PluginBundleUploadResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_INSTALL, resource_required=False)
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def post(self, tenant_id: str):
        file = request.files["bundle"]
        content = _read_upload_content(file, dify_config.PLUGIN_MAX_BUNDLE_SIZE)
        try:
            response = PluginService.upload_bundle(tenant_id, content)
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder(response)


@console_ns.route("/workspaces/current/plugin/install/pkg")
class PluginInstallFromPkgApi(Resource):
    @console_ns.expect(console_ns.models[ParserPluginIdentifiers.__name__])
    @console_ns.response(200, "Success", console_ns.models[PluginInstallTaskStartResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_INSTALL, resource_required=False)
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def post(self, tenant_id: str):
        args = ParserPluginIdentifiers.model_validate(console_ns.payload)

        try:
            response = PluginService.install_from_local_pkg(tenant_id, args.plugin_unique_identifiers)
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400

        return jsonable_encoder(response)


@console_ns.route("/workspaces/current/plugin/install/github")
class PluginInstallFromGithubApi(Resource):
    @console_ns.expect(console_ns.models[ParserGithubInstall.__name__])
    @console_ns.response(200, "Success", console_ns.models[PluginInstallTaskStartResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_INSTALL, resource_required=False)
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def post(self, tenant_id: str):
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
            return {"code": "plugin_error", "message": e.description}, 400

        return jsonable_encoder(response)


@console_ns.route("/workspaces/current/plugin/install/marketplace")
class PluginInstallFromMarketplaceApi(Resource):
    @console_ns.expect(console_ns.models[ParserPluginIdentifiers.__name__])
    @console_ns.response(200, "Success", console_ns.models[PluginInstallTaskStartResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_INSTALL, resource_required=False)
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def post(self, tenant_id: str):
        args = ParserPluginIdentifiers.model_validate(console_ns.payload)

        try:
            response = PluginService.install_from_marketplace_pkg(tenant_id, args.plugin_unique_identifiers)
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400

        return jsonable_encoder(response)


@console_ns.route("/workspaces/current/plugin/marketplace/pkg")
class PluginFetchMarketplacePkgApi(Resource):
    @console_ns.doc(params=query_params_from_model(ParserPluginIdentifierQuery))
    @console_ns.response(200, "Success", console_ns.models[PluginManifestResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_INSTALL, resource_required=False)
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def get(self, tenant_id: str):
        args = ParserPluginIdentifierQuery.model_validate(request.args.to_dict(flat=True))

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
            return {"code": "plugin_error", "message": e.description}, 400


@console_ns.route("/workspaces/current/plugin/fetch-manifest")
class PluginFetchManifestApi(Resource):
    @console_ns.doc(params=query_params_from_model(ParserPluginIdentifierQuery))
    @console_ns.response(200, "Success", console_ns.models[PluginManifestResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_INSTALL, resource_required=False)
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def get(self, tenant_id: str):
        args = ParserPluginIdentifierQuery.model_validate(request.args.to_dict(flat=True))

        try:
            return jsonable_encoder(
                {"manifest": PluginService.fetch_plugin_manifest(tenant_id, args.plugin_unique_identifier).model_dump()}
            )
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400


@console_ns.route("/workspaces/current/plugin/tasks")
class PluginFetchInstallTasksApi(Resource):
    @console_ns.doc(params=query_params_from_model(ParserTasks))
    @console_ns.response(200, "Success", console_ns.models[PluginTasksResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def get(self, tenant_id: str):
        args = ParserTasks.model_validate(request.args.to_dict(flat=True))

        try:
            return jsonable_encoder({"tasks": PluginService.fetch_install_tasks(tenant_id, args.page, args.page_size)})
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400


@console_ns.route("/workspaces/current/plugin/tasks/<task_id>")
class PluginFetchInstallTaskApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[PluginTaskResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def get(self, tenant_id: str, task_id: str):
        try:
            return jsonable_encoder({"task": PluginService.fetch_install_task(tenant_id, task_id)})
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400


@console_ns.route("/workspaces/current/plugin/tasks/<task_id>/delete")
class PluginDeleteInstallTaskApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SuccessResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def post(self, tenant_id: str, task_id: str):
        try:
            return {"success": PluginService.delete_install_task(tenant_id, task_id)}
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400


@console_ns.route("/workspaces/current/plugin/tasks/delete_all")
class PluginDeleteAllInstallTaskItemsApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SuccessResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def post(self, tenant_id: str):
        try:
            return {"success": PluginService.delete_all_install_task_items(tenant_id)}
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400


@console_ns.route("/workspaces/current/plugin/tasks/<task_id>/delete/<path:identifier>")
class PluginDeleteInstallTaskItemApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SuccessResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def post(self, tenant_id: str, task_id: str, identifier: str):
        try:
            return {"success": PluginService.delete_install_task_item(tenant_id, task_id, identifier)}
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400


@console_ns.route("/workspaces/current/plugin/upgrade/marketplace")
class PluginUpgradeFromMarketplaceApi(Resource):
    @console_ns.expect(console_ns.models[ParserMarketplaceUpgrade.__name__])
    @console_ns.response(200, "Success", console_ns.models[PluginInstallTaskStartResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_MODEL_CONFIG, resource_required=False)
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def post(self, tenant_id: str):
        args = ParserMarketplaceUpgrade.model_validate(console_ns.payload)

        try:
            return jsonable_encoder(
                PluginService.upgrade_plugin_with_marketplace(
                    tenant_id, args.original_plugin_unique_identifier, args.new_plugin_unique_identifier
                )
            )
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400


@console_ns.route("/workspaces/current/plugin/upgrade/github")
class PluginUpgradeFromGithubApi(Resource):
    @console_ns.expect(console_ns.models[ParserGithubUpgrade.__name__])
    @console_ns.response(200, "Success", console_ns.models[PluginInstallTaskStartResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_MODEL_CONFIG, resource_required=False)
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def post(self, tenant_id: str):
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
            return {"code": "plugin_error", "message": e.description}, 400


@console_ns.route("/workspaces/current/plugin/uninstall")
class PluginUninstallApi(Resource):
    @console_ns.expect(console_ns.models[ParserUninstall.__name__])
    @console_ns.response(200, "Success", console_ns.models[SuccessResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_DELETE, resource_required=False)
    @plugin_permission_required(install_required=True)
    @with_current_tenant_id
    def post(self, tenant_id: str):
        args = ParserUninstall.model_validate(console_ns.payload)

        try:
            return {"success": PluginService.uninstall(tenant_id, args.plugin_installation_id)}
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400


@console_ns.route("/workspaces/current/plugin/permission/change")
class PluginChangePermissionApi(Resource):
    @console_ns.expect(console_ns.models[ParserPermissionChange.__name__])
    @console_ns.response(200, "Success", console_ns.models[SuccessResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account):
        if not user.is_admin_or_owner:
            raise Forbidden()

        args = ParserPermissionChange.model_validate(console_ns.payload)

        set_permission_result = PluginPermissionService.change_permission(
            tenant_id, args.install_permission, args.debug_permission
        )
        if not set_permission_result:
            return jsonable_encoder({"success": False, "message": "Failed to set permission"})

        return jsonable_encoder({"success": True})


@console_ns.route("/workspaces/current/plugin/permission/fetch")
class PluginFetchPermissionApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[PluginPermissionResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
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
    @console_ns.doc(params=query_params_from_model(ParserDynamicOptions))
    @console_ns.response(200, "Success", console_ns.models[PluginDynamicOptionsResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_MODEL_CONFIG, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, current_user: Account):
        args = ParserDynamicOptions.model_validate(request.args.to_dict(flat=True))

        try:
            options = PluginParameterService.get_dynamic_select_options(
                tenant_id=tenant_id,
                user_id=current_user.id,
                plugin_id=args.plugin_id,
                provider=args.provider,
                action=args.action,
                parameter=args.parameter,
                credential_id=args.credential_id,
                provider_type=args.provider_type,
            )
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400

        return jsonable_encoder({"options": options})


@console_ns.route("/workspaces/current/plugin/parameters/dynamic-options-with-credentials")
class PluginFetchDynamicSelectOptionsWithCredentialsApi(Resource):
    @console_ns.expect(console_ns.models[ParserDynamicOptionsWithCredentials.__name__])
    @console_ns.response(200, "Success", console_ns.models[PluginDynamicOptionsResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, current_user: Account):
        """Fetch dynamic options using credentials directly (for edit mode)."""
        args = ParserDynamicOptionsWithCredentials.model_validate(console_ns.payload)

        try:
            options = PluginParameterService.get_dynamic_select_options_with_credentials(
                tenant_id=tenant_id,
                user_id=current_user.id,
                plugin_id=args.plugin_id,
                provider=args.provider,
                action=args.action,
                parameter=args.parameter,
                credential_id=args.credential_id,
                credentials=args.credentials,
            )
        except PluginDaemonClientSideError as e:
            return {"code": "plugin_error", "message": e.description}, 400

        return jsonable_encoder({"options": options})


@console_ns.route("/workspaces/current/plugin/auto-upgrade/change")
class PluginChangeAutoUpgradeApi(Resource):
    @console_ns.expect(console_ns.models[ParserAutoUpgradeChange.__name__])
    @console_ns.response(200, "Success", console_ns.models[PluginAutoUpgradeChangeResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account):
        if not dify_config.RBAC_ENABLED and not user.is_admin_or_owner:
            raise Forbidden()

        args = ParserAutoUpgradeChange.model_validate(console_ns.payload)

        auto_upgrade = args.auto_upgrade
        set_auto_upgrade_strategy_result = PluginAutoUpgradeService.change_strategy(
            tenant_id,
            auto_upgrade.strategy_setting,
            auto_upgrade.upgrade_time_of_day,
            auto_upgrade.upgrade_mode,
            auto_upgrade.exclude_plugins,
            auto_upgrade.include_plugins,
            category=args.category,
        )
        if not set_auto_upgrade_strategy_result:
            return jsonable_encoder({"success": False, "message": "Failed to set auto upgrade strategy"})

        return jsonable_encoder({"success": True})


@console_ns.route("/workspaces/current/plugin/auto-upgrade/fetch")
class PluginFetchAutoUpgradeApi(Resource):
    @console_ns.doc(params=query_params_from_model(ParserAutoUpgradeFetch))
    @console_ns.response(200, "Success", console_ns.models[PluginAutoUpgradeFetchResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        args = ParserAutoUpgradeFetch.model_validate(request.args.to_dict(flat=True))
        auto_upgrade = PluginAutoUpgradeService.get_strategy(tenant_id, args.category)
        auto_upgrade_dict = (
            _auto_upgrade_settings_to_dict(auto_upgrade)
            if auto_upgrade
            else _default_auto_upgrade_settings(tenant_id, args.category)
        )

        return jsonable_encoder(
            {
                "category": args.category,
                "auto_upgrade": auto_upgrade_dict,
            }
        )


@console_ns.route("/workspaces/current/plugin/auto-upgrade/exclude")
class PluginAutoUpgradeExcludePluginApi(Resource):
    @console_ns.expect(console_ns.models[ParserExcludePlugin.__name__])
    @console_ns.response(200, "Success", console_ns.models[SuccessResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @with_current_tenant_id
    def post(self, tenant_id: str):
        # exclude one single plugin
        args = ParserExcludePlugin.model_validate(console_ns.payload)

        return jsonable_encoder(
            {"success": PluginAutoUpgradeService.exclude_plugin(tenant_id, args.plugin_id, args.category)}
        )


@console_ns.route("/workspaces/current/plugin/readme")
class PluginReadmeApi(Resource):
    @console_ns.doc(params=query_params_from_model(ParserReadme))
    @console_ns.response(200, "Success", console_ns.models[PluginReadmeResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        args = ParserReadme.model_validate(request.args.to_dict(flat=True))
        return jsonable_encoder(
            {"readme": PluginService.fetch_plugin_readme(tenant_id, args.plugin_unique_identifier, args.language)}
        )
