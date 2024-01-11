from core.hosting_configuration import HostingConfiguration
from flask import Flask

hosting_configuration = HostingConfiguration()


def init_app(app: Flask):
    hosting_configuration.init_app(app)
