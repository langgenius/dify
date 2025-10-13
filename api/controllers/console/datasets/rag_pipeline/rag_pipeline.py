import json
import logging
from typing import Any

from flask import request
from flask_restx import Resource, reqparse
from sqlalchemy.orm import Session

from controllers.console import api
from controllers.console.wraps import (
    account_initialization_required,
    enterprise_license_required,
    knowledge_pipeline_publish_enabled,
    setup_required,
)
from extensions.ext_database import db
from libs.login import login_required
from models.dataset import PipelineCustomizedTemplate
from services.entities.knowledge_entities.rag_pipeline_entities import (
    PipelineBuiltInTemplateEntity,
    PipelineBuiltInTemplateInstallEntity,
    PipelineBuiltInTemplateUpdateEntity,
    PipelineTemplateInfoEntity,
)
from services.rag_pipeline.rag_pipeline import RagPipelineService

logger = logging.getLogger(__name__)


class PipelineTemplateListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self):
        type = request.args.get("type", default="built-in", type=str)
        language = request.args.get("language", default="en-US", type=str)
        # get pipeline templates
        pipeline_templates = RagPipelineService.get_pipeline_templates(type, language)
        return pipeline_templates, 200


class PipelineTemplateDetailApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self, template_id: str):
        type = request.args.get("type", default="built-in", type=str)
        rag_pipeline_service = RagPipelineService()
        pipeline_template = rag_pipeline_service.get_pipeline_template_detail(template_id, type)
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
        RagPipelineService.update_customized_pipeline_template(template_id, pipeline_template_info)
        return 200

    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def delete(self, template_id: str):
        RagPipelineService.delete_customized_pipeline_template(template_id)
        return 200

    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def post(self, template_id: str):
        with Session(db.engine) as session:
            template = (
                session.query(PipelineCustomizedTemplate).where(PipelineCustomizedTemplate.id == template_id).first()
            )
            if not template:
                raise ValueError("Customized pipeline template not found.")

        return {"data": template.yaml_content}, 200


class PublishCustomizedPipelineTemplateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @knowledge_pipeline_publish_enabled
    def post(self, pipeline_id: str):
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
        rag_pipeline_service = RagPipelineService()
        rag_pipeline_service.publish_customized_pipeline_template(pipeline_id, args)
        return {"result": "success"}


class PipelineTemplateInstallApi(Resource):
    """API endpoint for installing built-in pipeline templates"""
    
    def post(self):
        """
        Install a built-in pipeline template
        
        Args:
            template_id: The template ID from URL parameter
            
        Returns:
            Success response or error with appropriate HTTP status
        """
        parser = reqparse.RequestParser()
        
        parser.add_argument(
            "language",
            type=str,
            location="form",
            required=True,
            default="en-US",
            choices=["en-US", "zh-CN", "ja-JP"],
            help="Template language code"
        )
        parser.add_argument(
            "name",
            type=str,
            location="form",
            required=True,
            default="New Pipeline Template",
            help="Template name (1-200 characters)"
        )
        parser.add_argument(
            "description",
            type=str,
            location="form",
            required=False,
            default="",
            help="Template description (max 1000 characters)"
        )
        parser.add_argument(
            "position",
            type=int,
            location="form",
            required=False,
            default=1,
            help="Template position"
        )
        parser.add_argument(
            "icon",
            type=str,
            location="form",
            required=False,
            help="Template icon"
        )
        
        template_args = parser.parse_args()
        
        # Additional validation
        if template_args.get("name"):
            template_args["name"] = _validate_name(template_args["name"])

        if template_args.get("icon"):
            template_args["icon"] = json.loads(template_args["icon"])
        
        if template_args.get("description") and len(template_args["description"]) > 1000:
            raise ValueError("Description must not exceed 1000 characters")
        try:
            # Extract and validate Bearer token
            auth_token = _extract_bearer_token()
            
            # Process uploaded template file
            file_content = _process_template_file()
            template_args["yaml_content"] = file_content
            
            # Create template entity
            pipeline_built_in_template_entity = PipelineBuiltInTemplateInstallEntity(**template_args)
            
            # Install the template
            rag_pipeline_service = RagPipelineService()
            rag_pipeline_service.insert_built_in_pipeline_template(
                pipeline_built_in_template_entity, auth_token
            )
            
            return {"result": "success", "message": "Template installed successfully"}, 200
            
        except ValueError as e:
            logger.exception("Validation error in template installation")
            return {"error": str(e)}, 400
        except Exception as e:
            logger.exception("Unexpected error in template installation")
            return {"error": "An unexpected error occurred during template installation"}, 500


class PipelineTemplateUnpdateApi(Resource):
    """API endpoint for updating built-in pipeline templates"""
    def patch(self, template_id: str):
        """
        Update a built-in pipeline template
        
        Args:
            template_id: The template ID to update (from URL parameter)
        """
        parser = reqparse.RequestParser()
        
        parser.add_argument(
            "language",
            type=str,
            location="form",
            required=True,
            default="en-US",
            choices=["en-US", "zh-CN", "ja-JP"],
            help="Template language code"
        )
        parser.add_argument(
            "name",
            type=str,
            location="form",
            required=True,
            default="New Pipeline Template",
            help="Template name (1-200 characters)"
        )
        parser.add_argument(
            "description",
            type=str,
            location="form",
            required=False,
            default="",
            help="Template description (max 1000 characters)"
        )
        parser.add_argument(
            "position",
            type=int,
            location="form",
            required=False,
            default=1,
            help="Template position"
        )
        parser.add_argument(
            "icon",
            type=str,
            location="form",
            required=False,
            help="Template icon"
        )
        
        template_args = parser.parse_args()
        try:
            # Extract and validate Bearer token
            auth_token = _extract_bearer_token()
            
            if template_args.get("icon"):
                template_args["icon"] = json.loads(template_args["icon"])
            
            if "file" in request.files:
                file_content = request.files["file"].read().decode("utf-8")
                template_args["yaml_content"] = file_content
            else:
                template_args["yaml_content"] = None
            
            # Validate template_id
            if not template_id or not template_id.strip():
                raise ValueError("Template ID is required")
            
            template_args["template_id"] = template_id

            pipeline_built_in_template_entity = PipelineBuiltInTemplateUpdateEntity(**template_args)
            
            # Update the template
            rag_pipeline_service = RagPipelineService()
            rag_pipeline_service.update_built_in_pipeline_template(pipeline_built_in_template_entity, auth_token)
            
            return {"result": "success", "message": "Template updated successfully"}, 200
            
        except ValueError as e:
            logger.exception("Validation error in template update")
            return {"error": str(e)}, 400
        except Exception as e:
            logger.exception("Unexpected error in template update")
            return {"error": "An unexpected error occurred during template update"}, 500

    def delete(self, template_id: str):
        """
        Uninstall a built-in pipeline template
        
        Args:
            template_id: The template ID to uninstall (from URL parameter)
        
        Returns:
            Success response or error with appropriate HTTP status
        """
        try:
            # Extract and validate Bearer token
            auth_token = _extract_bearer_token()
            
            # Validate template_id
            if not template_id or not template_id.strip():
                raise ValueError("Template ID is required")
            
            # Uninstall the template
            rag_pipeline_service = RagPipelineService()
            rag_pipeline_service.uninstall_built_in_pipeline_template(
                template_id.strip(), auth_token
            )
            
            return {"result": "success", "message": "Template uninstalled successfully"}, 200
            
        except ValueError as e:
            logger.exception("Validation error in template uninstallation")
            return {"error": str(e)}, 400
        except Exception as e:
            logger.exception("Unexpected error in template uninstallation")
            return {"error": "An unexpected error occurred during template uninstallation"}, 500
    
def _extract_bearer_token() -> str:
    """
    Extract and validate Bearer token from Authorization header
    
    Returns:
        The extracted token string
        
    Raises:
        ValueError: If token is missing or invalid
    """
    auth_header = request.headers.get("Authorization", "").strip()
    
    if not auth_header:
        raise ValueError("Authorization header is required")
    
    if not auth_header.startswith("Bearer "):
        raise ValueError("Authorization header must start with 'Bearer '")
    
    token_parts = auth_header.split(" ", 1)
    if len(token_parts) != 2:
        raise ValueError("Invalid Authorization header format")
    
    auth_token = token_parts[1].strip()
    if not auth_token:
        raise ValueError("Bearer token cannot be empty")
    
    return auth_token


def _validate_name(name: str) -> str:
    """
    Validate template name
    
    Args:
        name: Template name to validate
        
    Returns:
        Validated and trimmed name
        
    Raises:
        ValueError: If name is invalid
    """
    name = name.strip()
    if not name or len(name) < 1 or len(name) > 200:
        raise ValueError("Template name must be between 1 and 200 characters")
    return name

def _process_template_file() -> str:
    """
    Process and validate uploaded template file
    
    Returns:
        File content as string
        
    Raises:
        ValueError: If file is missing or invalid
    """
    if "file" not in request.files:
        raise ValueError("Template file is required")
    
    file = request.files["file"]
    
    # Validate file
    if not file or not file.filename:
        raise ValueError("No file selected")
    
    filename = file.filename.strip()
    if not filename:
        raise ValueError("File name cannot be empty")
    
    # Check file extension
    if not filename.lower().endswith(".pipeline"):
        raise ValueError("Template file must be a pipeline file (.pipeline)")
    
    try:
        file_content = file.read().decode("utf-8")
    except UnicodeDecodeError:
        raise ValueError("Template file must be valid UTF-8 text")
    
    return file_content


api.add_resource(
    PipelineTemplateListApi,
    "/rag/pipeline/templates",
)
api.add_resource(
    PipelineTemplateDetailApi,
    "/rag/pipeline/templates/<string:template_id>",
)
api.add_resource(
    CustomizedPipelineTemplateApi,
    "/rag/pipeline/customized/templates/<string:template_id>",
)
api.add_resource(
    PublishCustomizedPipelineTemplateApi,
    "/rag/pipelines/<string:pipeline_id>/customized/publish",
)
api.add_resource(
    PipelineTemplateInstallApi,
    "/rag/pipeline/built-in/templates/install",
)
api.add_resource(
    PipelineTemplateUninstallApi,
    "/rag/pipeline/built-in/templates/<string:template_id>/uninstall",
)