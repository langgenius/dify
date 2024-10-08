import io
import json

from flask import Response, request, send_file
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
            "key": PluginService.get_plugin_debugging_key(tenant_id),
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
        plugins = PluginService.list_plugins(tenant_id)
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


class PluginInstallCheckUniqueIdentifierApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        req = reqparse.RequestParser()
        req.add_argument("plugin_unique_identifier", type=str, required=True, location="args")
        args = req.parse_args()

        user = current_user
        tenant_id = user.current_tenant_id

        return {"installed": PluginService.check_plugin_unique_identifier(tenant_id, args["plugin_unique_identifier"])}


class PluginInstallFromUniqueIdentifierApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        req = reqparse.RequestParser()
        req.add_argument("plugin_unique_identifier", type=str, required=True, location="json")
        args = req.parse_args()

        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = user.current_tenant_id

        return {
            "success": PluginService.install_plugin_from_unique_identifier(tenant_id, args["plugin_unique_identifier"])
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

        file = request.files["pkg"]
        content = file.read()

        def generator():
            response = PluginService.install_plugin_from_pkg(tenant_id, content)
            for message in response:
                yield f"data: {json.dumps(jsonable_encoder(message))}\n\n"

        return Response(generator(), mimetype="text/event-stream")


api.add_resource(PluginDebuggingKeyApi, "/workspaces/current/plugin/debugging-key")
api.add_resource(PluginListApi, "/workspaces/current/plugin/list")
api.add_resource(PluginIconApi, "/workspaces/current/plugin/icon")
api.add_resource(PluginInstallCheckUniqueIdentifierApi, "/workspaces/current/plugin/install/check_unique_identifier")
api.add_resource(PluginInstallFromUniqueIdentifierApi, "/workspaces/current/plugin/install/from_unique_identifier")
api.add_resource(PluginInstallFromPkgApi, "/workspaces/current/plugin/install/from_pkg")
