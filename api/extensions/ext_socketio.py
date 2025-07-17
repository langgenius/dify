from flask_socketio import SocketIO

from configs import dify_config
from dify_app import DifyApp

ext_socketio = SocketIO()


def init_app(app: DifyApp):
    ext_socketio.init_app(app, async_mode="gevent", cors_allowed_origins=dify_config.CONSOLE_CORS_ALLOW_ORIGINS)
