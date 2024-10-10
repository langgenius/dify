from flask import Flask

from configs import dify_config
from libs.threading import apply_gevent_threading_patch
from server.blueprints_assembly import BluePrintsAssembly
from server.commands_assembly import CommandsAssembly
from server.config_assembly import ConfigAssembly
from server.extensions_assembly import ExtensionsAssembly
from server.logger_assembly import LoggerAssembly
from server.module_assembly import PreloadModuleAssembly
from server.security_assembly import SecurityAssembly
from server.timezone_assembly import TimezoneAssembly


def create_app() -> Flask:
    dify_app = Flask(__name__)

    assemblies = [
        ConfigAssembly,
        TimezoneAssembly,
        LoggerAssembly,
        SecurityAssembly,
        PreloadModuleAssembly,
        ExtensionsAssembly,
        CommandsAssembly,
        BluePrintsAssembly,
    ]
    for assem in assemblies:
        assem().prepare_app(dify_app)

    return dify_app


# create app
app = create_app()
celery = app.extensions["celery"]

if __name__ == "__main__":
    if dify_config.DEBUG:
        apply_gevent_threading_patch()

    if dify_config.TESTING:
        print("App is running in TESTING mode")

    app.run(host="0.0.0.0", port=5001)
