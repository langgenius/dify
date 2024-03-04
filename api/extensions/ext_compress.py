from flask import Flask


def init_app(app: Flask):
    from flask_compress import Compress

    if app.config['API_COMPRESSION_ENABLED']:
        compress = Compress()
        compress.init_app(app)
