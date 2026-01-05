import json

import httpx
import yaml
from flask_restx import Resource, reqparse
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from core.plugin.impl.exc import PluginPermissionDeniedError
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models.model import App
from models.workflow import Workflow
from services.app_dsl_service import AppDslService


@console_ns.route("/workspaces/current/dsl/predict")
class DSLPredictApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user, _ = current_account_with_tenant()
        if not user.is_admin_or_owner:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("app_id", type=str, required=True, location="json")
            .add_argument("current_node_id", type=str, required=True, location="json")
        )
        args = parser.parse_args()

        app_id: str = args["app_id"]
        current_node_id: str = args["current_node_id"]

        with Session(db.engine) as session:
            app = session.query(App).filter_by(id=app_id).first()
            workflow = session.query(Workflow).filter_by(app_id=app_id, version=Workflow.VERSION_DRAFT).first()

        if not app:
            raise ValueError("App not found")
        if not workflow:
            raise ValueError("Workflow not found")

        try:
            i = 0
            for node_id, _ in workflow.walk_nodes():
                if node_id == current_node_id:
                    break
                i += 1

            dsl = yaml.safe_load(AppDslService.export_dsl(app_model=app))

            response = httpx.post(
                "http://spark-832c:8000/predict",
                json={"graph_data": dsl, "source_node_index": i},
            )
            return {
                "nodes": json.loads(response.json()),
            }
        except PluginPermissionDeniedError as e:
            raise ValueError(e.description) from e
