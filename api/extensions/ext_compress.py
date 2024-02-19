from flask import Flask
from flask_compress import Compress

compress = Compress()


def init_app(app: Flask):
    compress.init_app(app)
