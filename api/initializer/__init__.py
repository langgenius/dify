from flask import Flask
from . import (
    account,
    workflow,
    plugin
)
from .decorator import _initializers

def run_initializers(app: Flask):
    with app.app_context():
        for func, _ in sorted(_initializers, key=lambda x: x[1]):
            func()