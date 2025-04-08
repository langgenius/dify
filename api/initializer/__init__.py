from flask import Flask
from . import (
    account,
    workflow,
    plugin
)
from .decorator import _initializers
import os


def run_initializers(app: Flask):
    if os.environ.get("MODE") != "api":
        return
    if os.environ.get("APO_INIT") == "false":
        return
    with app.app_context():
        for func, _ in sorted(_initializers, key=lambda x: x[1]):
            func()