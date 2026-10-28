from core.hosting_configuration import HostingConfiguration
from dify_app import DifyApp

hosting_configuration = HostingConfiguration()


def init_app(app: DifyApp):
    hosting_configuration.init_app(app)
