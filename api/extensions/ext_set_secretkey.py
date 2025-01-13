from configs import dify_config
from dify_app import DifyApp


def init_app(app: DifyApp):
    app.secret_key = dify_config.SECRET_KEY
