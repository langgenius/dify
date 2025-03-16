from flask import Blueprint
from libs.external_api import ExternalApi

bp = Blueprint("admin_api", __name__, url_prefix="/admin/api")
api = ExternalApi(bp)

from .auth import login
from .settings import settings
from .stats import stats
from .students import conversation, message, students
