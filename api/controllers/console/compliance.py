from flask_login import current_user  # type: ignore
from flask_restful import Resource  # type: ignore
from libs.login import login_required

from . import api
from .wraps import (account_initialization_required, cloud_utm_record,
                    setup_required)


class ComplianceListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        pass


class ComplianceApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        pass


api.add_resource(ComplianceListApi, "/compliance/list")
api.add_resource(ComplianceApi, "/compliance")
