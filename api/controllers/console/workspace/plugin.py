import io

from flask import request, send_file
from flask_login import current_user  # type: ignore
from flask_restful import Resource, reqparse  # type: ignore
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.console import api
from controllers.console.workspace import plugin_permission_required
from controllers.console.wraps import account_initialization_required, setup_required
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.manager.exc import PluginDaemonClientSideError
from libs.login import login_required
from models.account import TenantPluginPermission
from services.plugin.plugin_permission_service import PluginPermissionService
from services.plugin.plugin_service import PluginService


class PluginDebuggingKeyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(debug_required=True)
    def get(self):
        tenant_id = current_user.current_tenant_id

        try:
            return {
                "key": PluginService.get_debugging_key(tenant_id),
                "host": dify_config.PLUGIN_REMOTE_INSTALL_HOST,
                "port": dify_config.PLUGIN_REMOTE_INSTALL_PORT,
            }
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


class PluginListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        tenant_id = current_user.current_tenant_id
        try:
            plugins = PluginService.list(tenant_id)
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder({"plugins": plugins})


class PluginListInstallationsFromIdsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("plugin_ids", type=list, required=True, location="json")
        args = parser.parse_args()

        try:
            plugins = PluginService.list_installations_from_ids(tenant_id, args["plugin_ids"])
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder({"plugins": plugins})


class PluginIconApi(Resource):
    @setup_required
    def get(self):
        req = reqparse.RequestParser()
        req.add_argument("tenant_id", type=str, required=True, location="args")
        req.add_argument("filename", type=str, required=True, location="args")
        args = req.parse_args()

        try:
            icon_bytes, mimetype = PluginService.get_asset(args["tenant_id"], args["filename"])
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        icon_cache_max_age = dify_config.TOOL_ICON_CACHE_MAX_AGE
        return send_file(io.BytesIO(icon_bytes), mimetype=mimetype, max_age=icon_cache_max_age)


class PluginUploadFromPkgApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        tenant_id = current_user.current_tenant_id

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


class PluginUploadFromGithubApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("repo", type=str, required=True, location="json")
        parser.add_argument("version", type=str, required=True, location="json")
        parser.add_argument("package", type=str, required=True, location="json")
        args = parser.parse_args()

        try:
            response = PluginService.upload_pkg_from_github(tenant_id, args["repo"], args["version"], args["package"])
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder(response)


class PluginUploadFromBundleApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        tenant_id = current_user.current_tenant_id

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


class PluginInstallFromPkgApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("plugin_unique_identifiers", type=list, required=True, location="json")
        args = parser.parse_args()

        # check if all plugin_unique_identifiers are valid string
        for plugin_unique_identifier in args["plugin_unique_identifiers"]:
            if not isinstance(plugin_unique_identifier, str):
                raise ValueError("Invalid plugin unique identifier")

        try:
            response = PluginService.install_from_local_pkg(tenant_id, args["plugin_unique_identifiers"])
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder(response)


class PluginInstallFromGithubApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("repo", type=str, required=True, location="json")
        parser.add_argument("version", type=str, required=True, location="json")
        parser.add_argument("package", type=str, required=True, location="json")
        parser.add_argument("plugin_unique_identifier", type=str, required=True, location="json")
        args = parser.parse_args()

        try:
            response = PluginService.install_from_github(
                tenant_id,
                args["plugin_unique_identifier"],
                args["repo"],
                args["version"],
                args["package"],
            )
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder(response)


class PluginInstallFromMarketplaceApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(install_required=True)
    def post(self):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("plugin_unique_identifiers", type=list, required=True, location="json")
        args = parser.parse_args()

        # check if all plugin_unique_identifiers are valid string
        for plugin_unique_identifier in args["plugin_unique_identifiers"]:
            if not isinstance(plugin_unique_identifier, str):
                raise ValueError("Invalid plugin unique identifier")

        try:
            response = PluginService.install_from_marketplace_pkg(tenant_id, args["plugin_unique_identifiers"])
        except PluginDaemonClientSideError as e:
            raise ValueError(e)

        return jsonable_encoder(response)


class PluginFetchManifestApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(debug_required=True)
    def get(self):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("plugin_unique_identifier", type=str, required=True, location="args")
        args = parser.parse_args()

        try:
            return jsonable_encoder(
                {
                    "manifest": PluginService.fetch_plugin_manifest(
                        tenant_id, args["plugin_unique_identifier"]
                    ).model_dump()
                }
            )
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


class PluginFetchInstallTasksApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(debug_required=True)
    def get(self):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("page", type=int, required=True, location="args")
        parser.add_argument("page_size", type=int, required=True, location="args")
        args = parser.parse_args()

        try:
            return jsonable_encoder(
                {"tasks": PluginService.fetch_install_tasks(tenant_id, args["page"], args["page_size"])}
            )
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


class PluginFetchInstallTaskApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(debug_required=True)
    def get(self, task_id: str):
        tenant_id = current_user.current_tenant_id

        try:
            return jsonable_encoder({"task": PluginService.fetch_install_task(tenant_id, task_id)})
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


class PluginDeleteInstallTaskApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(debug_required=True)
    def post(self, task_id: str):
        tenant_id = current_user.current_tenant_id

        try:
            return {"success": PluginService.delete_install_task(tenant_id, task_id)}
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


class PluginDeleteAllInstallTaskItemsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(debug_required=True)
    def post(self):
        tenant_id = current_user.current_tenant_id

        try:
            return {"success": PluginService.delete_all_install_task_items(tenant_id)}
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


class PluginDeleteInstallTaskItemApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(debug_required=True)
    def post(self, task_id: str, identifier: str):
        tenant_id = current_user.current_tenant_id

        try:
            return {"success": PluginService.delete_install_task_item(tenant_id, task_id, identifier)}
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


class PluginUpgradeFromMarketplaceApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(debug_required=True)
    def post(self):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("original_plugin_unique_identifier", type=str, required=True, location="json")
        parser.add_argument("new_plugin_unique_identifier", type=str, required=True, location="json")
        args = parser.parse_args()

        try:
            return jsonable_encoder(
                PluginService.upgrade_plugin_with_marketplace(
                    tenant_id, args["original_plugin_unique_identifier"], args["new_plugin_unique_identifier"]
                )
            )
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


class PluginUpgradeFromGithubApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(debug_required=True)
    def post(self):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("original_plugin_unique_identifier", type=str, required=True, location="json")
        parser.add_argument("new_plugin_unique_identifier", type=str, required=True, location="json")
        parser.add_argument("repo", type=str, required=True, location="json")
        parser.add_argument("version", type=str, required=True, location="json")
        parser.add_argument("package", type=str, required=True, location="json")
        args = parser.parse_args()

        try:
            return jsonable_encoder(
                PluginService.upgrade_plugin_with_github(
                    tenant_id,
                    args["original_plugin_unique_identifier"],
                    args["new_plugin_unique_identifier"],
                    args["repo"],
                    args["version"],
                    args["package"],
                )
            )
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


class PluginUninstallApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @plugin_permission_required(debug_required=True)
    def post(self):
        req = reqparse.RequestParser()
        req.add_argument("plugin_installation_id", type=str, required=True, location="json")
        args = req.parse_args()

        tenant_id = current_user.current_tenant_id

        try:
            return {"success": PluginService.uninstall(tenant_id, args["plugin_installation_id"])}
        except PluginDaemonClientSideError as e:
            raise ValueError(e)


class PluginChangePermissionApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        req = reqparse.RequestParser()
        req.add_argument("install_permission", type=str, required=True, location="json")
        req.add_argument("debug_permission", type=str, required=True, location="json")
        args = req.parse_args()

        install_permission = TenantPluginPermission.InstallPermission(args["install_permission"])
        debug_permission = TenantPluginPermission.DebugPermission(args["debug_permission"])

        tenant_id = user.current_tenant_id

        return {"success": PluginPermissionService.change_permission(tenant_id, install_permission, debug_permission)}


class PluginFetchPermissionApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        tenant_id = current_user.current_tenant_id

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


api.add_resource(PluginDebuggingKeyApi, "/workspaces/current/plugin/debugging-key")
api.add_resource(PluginListApi, "/workspaces/current/plugin/list")
api.add_resource(PluginListInstallationsFromIdsApi, "/workspaces/current/plugin/list/installations/ids")
api.add_resource(PluginIconApi, "/workspaces/current/plugin/icon")
api.add_resource(PluginUploadFromPkgApi, "/workspaces/current/plugin/upload/pkg")
api.add_resource(PluginUploadFromGithubApi, "/workspaces/current/plugin/upload/github")
api.add_resource(PluginUploadFromBundleApi, "/workspaces/current/plugin/upload/bundle")
api.add_resource(PluginInstallFromPkgApi, "/workspaces/current/plugin/install/pkg")
api.add_resource(PluginInstallFromGithubApi, "/workspaces/current/plugin/install/github")
api.add_resource(PluginUpgradeFromMarketplaceApi, "/workspaces/current/plugin/upgrade/marketplace")
api.add_resource(PluginUpgradeFromGithubApi, "/workspaces/current/plugin/upgrade/github")
api.add_resource(PluginInstallFromMarketplaceApi, "/workspaces/current/plugin/install/marketplace")
api.add_resource(PluginFetchManifestApi, "/workspaces/current/plugin/fetch-manifest")
api.add_resource(PluginFetchInstallTasksApi, "/workspaces/current/plugin/tasks")
api.add_resource(PluginFetchInstallTaskApi, "/workspaces/current/plugin/tasks/<task_id>")
api.add_resource(PluginDeleteInstallTaskApi, "/workspaces/current/plugin/tasks/<task_id>/delete")
api.add_resource(PluginDeleteAllInstallTaskItemsApi, "/workspaces/current/plugin/tasks/delete_all")
api.add_resource(PluginDeleteInstallTaskItemApi, "/workspaces/current/plugin/tasks/<task_id>/delete/<path:identifier>")
api.add_resource(PluginUninstallApi, "/workspaces/current/plugin/uninstall")

api.add_resource(PluginChangePermissionApi, "/workspaces/current/plugin/permission/change")
api.add_resource(PluginFetchPermissionApi, "/workspaces/current/plugin/permission/fetch")
