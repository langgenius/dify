import json
from enum import StrEnum

from flask_login import current_user
from flask_restful import Resource, marshal_with, reqparse
from werkzeug.exceptions import NotFound

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from fields.app_fields import app_server_fields
from libs.login import login_required
from models.model import AppMCPServer


class AppMCPServerStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class AppMCPServerController(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_server_fields)
    def get(self, app_model):
        server = db.session.query(AppMCPServer).filter(AppMCPServer.app_id == app_model.id).first()
        return server

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_server_fields)
    def post(self, app_model):
        # The role of the current user in the ta table must be editor, admin, or owner
        if not current_user.is_editor:
            raise NotFound()
        parser = reqparse.RequestParser()
        parser.add_argument("description", type=str, required=True, location="json")
        parser.add_argument("parameters", type=dict, required=True, location="json")
        args = parser.parse_args()
        server = AppMCPServer(
            name=app_model.name,
            description=args["description"],
            parameters=json.dumps(args["parameters"], ensure_ascii=False),
            status=AppMCPServerStatus.ACTIVE,
            app_id=app_model.id,
            tenant_id=current_user.current_tenant_id,
            server_code=AppMCPServer.generate_server_code(16),
        )
        db.session.add(server)
        db.session.commit()
        return server

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_server_fields)
    def put(self, app_model):
        if not current_user.is_editor:
            raise NotFound()
        parser = reqparse.RequestParser()
        parser.add_argument("id", type=str, required=True, location="json")
        parser.add_argument("description", type=str, required=True, location="json")
        parser.add_argument("parameters", type=dict, required=True, location="json")
        parser.add_argument("status", type=str, required=False, location="json")
        args = parser.parse_args()
        server = db.session.query(AppMCPServer).filter(AppMCPServer.id == args["id"]).first()
        if not server:
            raise NotFound()
        server.description = args["description"]
        server.parameters = json.dumps(args["parameters"], ensure_ascii=False)
        if args["status"]:
            if args["status"] not in [status.value for status in AppMCPServerStatus]:
                raise ValueError("Invalid status")
            server.status = args["status"]
        db.session.commit()
        return server


class AppMCPServerRefreshController(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_server_fields)
    def get(self, server_id):
        if not current_user.is_editor:
            raise NotFound()
        server = (
            db.session.query(AppMCPServer)
            .filter(AppMCPServer.id == server_id)
            .filter(AppMCPServer.tenant_id == current_user.current_tenant_id)
            .first()
        )
        if not server:
            raise NotFound()
        server.server_code = AppMCPServer.generate_server_code(16)
        db.session.commit()
        return server


class AppMCPServerGenerateDescriptionController(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def post(self, app_model):
        """Generate MCP server description automatically based on app information"""
        if not current_user.is_editor:
            raise NotFound()

        from core.llm_generator.llm_generator import LLMGenerator

        # Extract app information for description generation
        app_name = app_model.name
        app_description = app_model.description or ""
        app_type = app_model.mode or ""

        # Provide default descriptions if app_description is empty
        if not app_description:
            if app_type == "chat":
                app_description = "An interactive conversational AI application for natural language communication"
            elif app_type == "completion":
                app_description = "A text generation application for creating high-quality content"
            elif app_type == "agent-chat":
                app_description = "An intelligent agent application with autonomous tool capabilities"
            elif app_type == "workflow":
                app_description = "A workflow-based application for automated task processing"
            elif app_type == "advanced-chat":
                app_description = "An advanced conversational AI with enhanced memory and reasoning"
            else:
                app_description = "An AI-powered application providing intelligent assistance"

        # Get key features from app configuration
        key_features = ""
        if app_model.app_model_config:
            model_config = app_model.app_model_config.to_dict()
            features = []

            # Basic app features based on mode
            if app_type == "chat":
                features.append("Interactive chat conversations")
            elif app_type == "completion":
                features.append("Text generation and completion")
            elif app_type == "agent-chat":
                features.append("Intelligent agent with tool capabilities")
            elif app_type == "workflow":
                features.append("Workflow-based automation")
            elif app_type == "advanced-chat":
                features.append("Advanced conversational AI with memory")

            # Configuration-based features
            if model_config.get("opening_statement"):
                features.append("Custom greeting messages")
            if model_config.get("suggested_questions"):
                features.append("Suggested conversation starters")
            if model_config.get("speech_to_text", {}).get("enabled"):
                features.append("Voice input support")
            if model_config.get("text_to_speech", {}).get("enabled"):
                features.append("Voice response output")
            if model_config.get("retriever_resource"):
                features.append("Knowledge base integration")
            if model_config.get("annotation_reply", {}).get("enabled"):
                features.append("Enhanced response annotations")
            if model_config.get("more_like_this", {}).get("enabled"):
                features.append("Similar content suggestions")
            if model_config.get("sensitive_word_avoidance", {}).get("enabled"):
                features.append("Content moderation")

            # Model-based capabilities
            if model_config.get("model", {}).get("name"):
                model_name = model_config.get("model", {}).get("name", "")
                if "gpt-4" in model_name.lower():
                    features.append("Advanced reasoning capabilities")
                elif "claude" in model_name.lower():
                    features.append("Enhanced text analysis")

            key_features = ", ".join(features) if features else "AI-powered assistance"

        try:
            # Generate description using LLM
            description = LLMGenerator.generate_mcp_description(
                tenant_id=current_user.current_tenant_id,
                app_name=app_name,
                app_description=app_description,
                app_type=app_type,
                key_features=key_features,
                app_id=app_model.id,
            )

            return {"description": description}

        except Exception as e:
            # Log the error for debugging
            import logging

            logging.exception("MCP description generation failed")

            # Fallback to a basic description if generation fails
            fallback_description = (
                f"A {app_type or 'AI'} application '{app_name}' that provides "
                f"intelligent assistance and automated capabilities for enhanced "
                f"user productivity and task completion."
            )

            return {"description": fallback_description, "error": str(e), "fallback": True}


api.add_resource(AppMCPServerController, "/apps/<uuid:app_id>/server")
api.add_resource(AppMCPServerRefreshController, "/apps/<uuid:server_id>/server/refresh")
api.add_resource(AppMCPServerGenerateDescriptionController, "/apps/<uuid:app_id>/server/generate-description")
