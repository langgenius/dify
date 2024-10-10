import os

from flask import Flask

from server.basic_assembly import BasicAssembly


class ConfigAssembly(BasicAssembly):
    def prepare_app(self, app: Flask):
        prepare_flask_configs(app)


def prepare_flask_configs(app: Flask):
    from configs import dify_config

    app.config.from_mapping(dify_config.model_dump())

    # populate configs into system environment variables
    for key, value in app.config.items():
        if isinstance(value, str):
            os.environ[key] = value
        elif isinstance(value, int | float | bool):
            os.environ[key] = str(value)
        elif value is None:
            os.environ[key] = ""
