from flask import Flask


def init_app(app: Flask):
    if app.config.get('API_COMPRESSION_ENABLED', False):
        from flask_compress import Compress

        compress = Compress()
        compress.init_app(app)

