from configs import dify_config
from dify_app import DifyApp


def is_enabled() -> bool:
    return dify_config.API_COMPRESSION_ENABLED


def init_app(app: DifyApp):
    from flask_compress import Compress  # type: ignore

    compress = Compress()
    compress.init_app(app)
