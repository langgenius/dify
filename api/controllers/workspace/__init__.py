from flask import Blueprint
from flask_restful import Api

# Create blueprint for workspace management API
bp = Blueprint("workspace", __name__, url_prefix="/v1/workspaces")
api = Api(bp)

from . import apps, members, workspace
