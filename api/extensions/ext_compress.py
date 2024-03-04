from flask import Flask
from flask_compress import Compress




def init_app(app: Flask):
    if app.config['API_COMPRESSION_ENABLED']:
        compress = Compress()
        compress.init_app(app)
