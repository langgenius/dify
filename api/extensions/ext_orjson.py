from flask_orjson import OrjsonProvider

from dify_app import DifyApp


def init_app(app: DifyApp):
    """Initialize Flask-Orjson extension for faster JSON serialization"""
    app.json = OrjsonProvider(app)
