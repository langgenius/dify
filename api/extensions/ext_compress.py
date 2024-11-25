from flask import Flask

from configs import dify_config


def init_app(app: Flask):
    if dify_config.API_COMPRESSION_ENABLED:
        from flask_compress import Compress

        app.config["COMPRESS_MIMETYPES"] = [
            "application/json",
            "image/svg+xml",
            "text/html",
        ]

        compress = Compress()
        compress.init_app(app)
