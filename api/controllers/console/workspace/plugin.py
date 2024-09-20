from flask_login import current_user
from flask_restful import Resource
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from libs.login import login_required
from services.plugin.plugin_debugging_service import PluginDebuggingService


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
            "key": PluginDebuggingService.get_plugin_debugging_key(tenant_id)
        }


api.add_resource(PluginDebuggingKeyApi, "/workspaces/current/plugin/debugging-key")