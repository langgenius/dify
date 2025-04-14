from flask import request
from flask_login import current_user  # type: ignore  # type: ignore
from flask_restful import Resource, marshal  # type: ignore

from controllers.console import api
from controllers.console.wraps import (
    account_initialization_required,
    enterprise_license_required,
    setup_required,
)
from core.model_runtime.entities.model_entities import ModelType
from core.plugin.entities.plugin import ModelProviderID
from core.provider_manager import ProviderManager
from fields.dataset_fields import dataset_detail_fields
from libs.login import login_required
from services.dataset_service import DatasetPermissionService, DatasetService


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
        return response, 200


api.add_resource(PipelineTemplateListApi, "/rag/pipeline/templates")
