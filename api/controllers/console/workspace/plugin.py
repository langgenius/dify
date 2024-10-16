import io

from flask import request, send_file
from flask_login import current_user
from flask_restful import Resource, reqparse
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.model_runtime.utils.encoders import jsonable_encoder
from libs.login import login_required
from services.plugin.plugin_service import PluginService


class PluginDebuggingKeyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = user.current_tenant_id

        return {
            "key": PluginService.get_debugging_key(tenant_id),
            "host": dify_config.PLUGIN_REMOTE_INSTALL_HOST,
            "port": dify_config.PLUGIN_REMOTE_INSTALL_PORT,
        }


class PluginListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user
        tenant_id = user.current_tenant_id
        plugins = PluginService.list(tenant_id)
        return jsonable_encoder({"plugins": plugins})


class PluginIconApi(Resource):
    @setup_required
    def get(self):
        req = reqparse.RequestParser()
        req.add_argument("tenant_id", type=str, required=True, location="args")
        req.add_argument("filename", type=str, required=True, location="args")
        args = req.parse_args()

        icon_bytes, mimetype = PluginService.get_asset(args["tenant_id"], args["filename"])

        icon_cache_max_age = dify_config.TOOL_ICON_CACHE_MAX_AGE
        return send_file(io.BytesIO(icon_bytes), mimetype=mimetype, max_age=icon_cache_max_age)


class PluginUploadPkgApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = user.current_tenant_id
        file = request.files["pkg"]
        content = file.read()
        return {"plugin_unique_identifier": PluginService.upload_pkg(tenant_id, content)}


class PluginUploadFromPkgApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = user.current_tenant_id

        file = request.files["pkg"]
        content = file.read()
        response = PluginService.upload_pkg(tenant_id, content)

        return {
            "plugin_unique_identifier": response,
        }


class PluginUploadFromGithubApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("repo", type=str, required=True, location="json")
        parser.add_argument("version", type=str, required=True, location="json")
        parser.add_argument("package", type=str, required=True, location="json")
        args = parser.parse_args()

        response = PluginService.upload_pkg_from_github(tenant_id, args["repo"], args["version"], args["package"])

        return {
            "plugin_unique_identifier": response,
        }


class PluginInstallFromPkgApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("plugin_unique_identifier", type=str, required=True, location="json")
        args = parser.parse_args()

        response = PluginService.install_from_local_pkg(tenant_id, args["plugin_unique_identifier"])

        return response.model_dump()


class PluginInstallFromGithubApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("repo", type=str, required=True, location="json")
        parser.add_argument("version", type=str, required=True, location="json")
        parser.add_argument("package", type=str, required=True, location="json")
        parser.add_argument("plugin_unique_identifier", type=str, required=True, location="json")
        args = parser.parse_args()

        response = PluginService.install_from_github(
            tenant_id, args["repo"], args["version"], args["package"], args["plugin_unique_identifier"]
        )

        return response.model_dump()


class PluginInstallFromMarketplaceApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("plugin_unique_identifier", type=str, required=True, location="json")
        args = parser.parse_args()

        response = PluginService.install_from_marketplace_pkg(tenant_id, args["plugin_unique_identifier"])

        return response.model_dump()


class PluginFetchManifestApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user

        parser = reqparse.RequestParser()
        parser.add_argument("plugin_unique_identifier", type=str, required=True, location="args")
        args = parser.parse_args()

        tenant_id = user.current_tenant_id

        return jsonable_encoder(
            {"manifest": PluginService.fetch_plugin_manifest(tenant_id, args["plugin_unique_identifier"]).model_dump()}
        )


class PluginFetchInstallTasksApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = user.current_tenant_id

        return {"tasks": PluginService.fetch_install_tasks(tenant_id)}


class PluginFetchInstallTaskApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, task_id: str):
        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = user.current_tenant_id

        return {"task": PluginService.fetch_install_task(tenant_id, task_id)}


class PluginUninstallApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        req = reqparse.RequestParser()
        req.add_argument("plugin_installation_id", type=str, required=True, location="json")
        args = req.parse_args()

        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = user.current_tenant_id

        return {"success": PluginService.uninstall(tenant_id, args["plugin_installation_id"])}


api.add_resource(PluginDebuggingKeyApi, "/workspaces/current/plugin/debugging-key")
api.add_resource(PluginListApi, "/workspaces/current/plugin/list")
api.add_resource(PluginIconApi, "/workspaces/current/plugin/icon")
api.add_resource(PluginUploadFromPkgApi, "/workspaces/current/plugin/upload/pkg")
api.add_resource(PluginUploadFromGithubApi, "/workspaces/current/plugin/upload/github")
api.add_resource(PluginInstallFromPkgApi, "/workspaces/current/plugin/install/pkg")
api.add_resource(PluginInstallFromGithubApi, "/workspaces/current/plugin/install/github")
api.add_resource(PluginInstallFromMarketplaceApi, "/workspaces/current/plugin/install/marketplace")
api.add_resource(PluginFetchManifestApi, "/workspaces/current/plugin/fetch-manifest")
api.add_resource(PluginFetchInstallTasksApi, "/workspaces/current/plugin/tasks")
api.add_resource(PluginFetchInstallTaskApi, "/workspaces/current/plugin/tasks/<task_id>")
api.add_resource(PluginUninstallApi, "/workspaces/current/plugin/uninstall")
