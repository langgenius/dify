import socketio

from configs import dify_config

sio = socketio.Server(async_mode="gevent", cors_allowed_origins=dify_config.CONSOLE_CORS_ALLOW_ORIGINS)
