import socketio

sio = socketio.Server(async_mode="gevent", cors_allowed_origins="*")
