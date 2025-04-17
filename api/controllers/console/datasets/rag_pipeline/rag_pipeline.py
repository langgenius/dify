import json
import logging
from typing import cast

from flask import abort, request
from flask_restful import Resource, inputs, marshal_with, reqparse  # type: ignore  # type: ignore
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from configs import dify_config
from controllers.console import api
from controllers.console.app.error import (
    ConversationCompletedError,
    DraftWorkflowNotExist,
    DraftWorkflowNotSync,
)
from controllers.console.app.wraps import get_app_model
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.wraps import (
    account_initialization_required,
    enterprise_license_required,
    setup_required,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from factories import variable_factory
from fields.workflow_fields import workflow_fields, workflow_pagination_fields
from fields.workflow_run_fields import workflow_run_node_execution_fields
from libs import helper
from libs.helper import TimestampField
from libs.login import current_user, login_required
from models import App
from models.account import Account
from models.dataset import Pipeline
from models.model import AppMode
from services.app_generate_service import AppGenerateService
from services.entities.knowledge_entities.rag_pipeline_entities import PipelineTemplateInfoEntity
from services.errors.app import WorkflowHashNotEqualError
from services.errors.llm import InvokeRateLimitError
from services.rag_pipeline.rag_pipeline import RagPipelineService
from services.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError, WorkflowService

logger = logging.getLogger(__name__)


def _validate_name(name):
    if not name or len(name) < 1 or len(name) > 40:
        raise ValueError("Name must be between 1 to 40 characters.")
    return name


def _validate_description_length(description):
    if len(description) > 400:
        raise ValueError("Description cannot exceed 400 characters.")
    return description


class PipelineTemplateListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self):
        type = request.args.get("type", default="built-in", type=str, choices=["built-in", "customized"])
        language = request.args.get("language", default="en-US", type=str)
        # get pipeline templates
        pipeline_templates = RagPipelineService.get_pipeline_templates(type, language)
        return pipeline_templates, 200


class PipelineTemplateDetailApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self, pipeline_id: str):
        pipeline_template = RagPipelineService.get_pipeline_template_detail(pipeline_id)
        return pipeline_template, 200


class CustomizedPipelineTemplateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def patch(self, template_id: str):
        parser = reqparse.RequestParser()
        parser.add_argument(
            "name",
            nullable=False,
            required=True,
            help="Name must be between 1 to 40 characters.",
            type=_validate_name,
        )
        parser.add_argument(
            "description",
            type=str,
            nullable=True,
            required=False,
            default="",
        )
        parser.add_argument(
            "icon_info",
            type=dict,
            location="json",
            nullable=True,
        )
        args = parser.parse_args()
        pipeline_template_info = PipelineTemplateInfoEntity(**args)
        pipeline_template = RagPipelineService.update_customized_pipeline_template(template_id, pipeline_template_info)
        return pipeline_template, 200

    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def delete(self, template_id: str):
        RagPipelineService.delete_customized_pipeline_template(template_id)
        return 200


api.add_resource(
    PipelineTemplateListApi,
    "/rag/pipeline/templates",
)
api.add_resource(
    PipelineTemplateDetailApi,
    "/rag/pipeline/templates/<string:pipeline_id>",
)
api.add_resource(
    CustomizedPipelineTemplateApi,
    "/rag/pipeline/templates/<string:template_id>",
)
