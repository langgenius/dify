from dify_app import DifyApp


def init_app(app: DifyApp):

    from flasgger import Swagger

    Swagger(app) 