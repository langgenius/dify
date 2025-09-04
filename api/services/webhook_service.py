import json
import logging
from collections.abc import Mapping
from typing import Any

from flask import request
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.file.models import FileTransferMethod
from core.tools.tool_file_manager import ToolFileManager
from core.variables.types import SegmentType
from extensions.ext_database import db
from factories import file_factory
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import AppTrigger, AppTriggerStatus, AppTriggerType, Workflow, WorkflowWebhookTrigger
from services.async_workflow_service import AsyncWorkflowService
from services.workflow.entities import TriggerData

logger = logging.getLogger(__name__)


class WebhookService:
    """Service for handling webhook operations."""

    @classmethod
    def get_webhook_trigger_and_workflow(
        cls, webhook_id: str
    ) -> tuple[WorkflowWebhookTrigger, Workflow, Mapping[str, Any]]:
        """Get webhook trigger, workflow, and node configuration."""
        with Session(db.engine) as session:
            # Get webhook trigger
            webhook_trigger = (
                session.query(WorkflowWebhookTrigger).filter(WorkflowWebhookTrigger.webhook_id == webhook_id).first()
            )
            if not webhook_trigger:
                raise ValueError(f"Webhook not found: {webhook_id}")

            # Check if the corresponding AppTrigger is enabled
            app_trigger = (
                session.query(AppTrigger)
                .filter(
                    AppTrigger.app_id == webhook_trigger.app_id,
                    AppTrigger.node_id == webhook_trigger.node_id,
                    AppTrigger.trigger_type == AppTriggerType.TRIGGER_WEBHOOK,
                )
                .first()
            )

            if not app_trigger:
                raise ValueError(f"App trigger not found for webhook {webhook_id}")

            if app_trigger.status != AppTriggerStatus.ENABLED:
                raise ValueError(f"Webhook trigger is disabled for webhook {webhook_id}")

            # Get workflow
            workflow = (
                session.query(Workflow)
                .filter(
                    Workflow.app_id == webhook_trigger.app_id,
                    Workflow.version != Workflow.VERSION_DRAFT,
                )
                .order_by(Workflow.created_at.desc())
                .first()
            )
            if not workflow:
                raise ValueError(f"Workflow not found for app {webhook_trigger.app_id}")

            node_config = workflow.get_node_config_by_id(webhook_trigger.node_id)

            return webhook_trigger, workflow, node_config

    @classmethod
    def extract_webhook_data(cls, webhook_trigger: WorkflowWebhookTrigger) -> dict[str, Any]:
        """Extract and process data from incoming webhook request."""
        data = {
            "method": request.method,
            "headers": dict(request.headers),
            "query_params": dict(request.args),
            "body": {},
            "files": {},
        }

        content_type = request.headers.get("Content-Type", "").lower()

        # Extract body data based on content type
        if "application/json" in content_type:
            try:
                data["body"] = request.get_json() or {}
            except Exception:
                data["body"] = {}
        elif "application/x-www-form-urlencoded" in content_type:
            data["body"] = dict(request.form)
        elif "multipart/form-data" in content_type:
            data["body"] = dict(request.form)
            # Handle file uploads
            if request.files:
                data["files"] = cls._process_file_uploads(request.files, webhook_trigger)
        elif "application/octet-stream" in content_type:
            # Binary data - process as file using ToolFileManager
            try:
                file_content = request.get_data()
                if file_content:
                    tool_file_manager = ToolFileManager()

                    # Create file using ToolFileManager
                    tool_file = tool_file_manager.create_file_by_raw(
                        user_id=webhook_trigger.created_by,
                        tenant_id=webhook_trigger.tenant_id,
                        conversation_id=None,
                        file_binary=file_content,
                        mimetype="application/octet-stream",
                    )

                    # Build File object
                    mapping = {
                        "tool_file_id": tool_file.id,
                        "transfer_method": FileTransferMethod.TOOL_FILE.value,
                    }
                    file_obj = file_factory.build_from_mapping(
                        mapping=mapping,
                        tenant_id=webhook_trigger.tenant_id,
                    )
                    data["body"] = {"raw": file_obj.to_dict()}
                else:
                    data["body"] = {"raw": None}
            except Exception:
                logger.exception("Failed to process octet-stream data")
                data["body"] = {"raw": None}
        elif "text/plain" in content_type:
            # Text data - store as raw string
            try:
                data["body"] = {"raw": request.get_data(as_text=True)}
            except Exception:
                data["body"] = {"raw": ""}
        else:
            raise ValueError(f"Unsupported Content-Type: {content_type}")

        return data

    @classmethod
    def _process_file_uploads(cls, files, webhook_trigger: WorkflowWebhookTrigger) -> dict[str, Any]:
        """Process file uploads using ToolFileManager."""
        processed_files = {}

        for name, file in files.items():
            if file and file.filename:
                try:
                    tool_file_manager = ToolFileManager()
                    file_content = file.read()

                    # Create file using ToolFileManager
                    tool_file = tool_file_manager.create_file_by_raw(
                        user_id="webhook_user",
                        tenant_id=webhook_trigger.tenant_id,
                        conversation_id=None,
                        file_binary=file_content,
                        mimetype=file.content_type or "application/octet-stream",
                    )

                    # Build File object
                    mapping = {
                        "tool_file_id": tool_file.id,
                        "transfer_method": FileTransferMethod.TOOL_FILE.value,
                    }
                    file_obj = file_factory.build_from_mapping(
                        mapping=mapping,
                        tenant_id=webhook_trigger.tenant_id,
                    )

                    processed_files[name] = file_obj

                except Exception:
                    logger.exception("Failed to process file upload %s", name)
                    # Continue processing other files

        return processed_files

    @classmethod
    def validate_webhook_request(cls, webhook_data: dict[str, Any], node_config: Mapping[str, Any]) -> dict[str, Any]:
        """Validate webhook request against node configuration."""
        try:
            node_data = node_config.get("data", {})

            # Validate HTTP method
            configured_method = node_data.get("method", "get").upper()
            request_method = webhook_data["method"].upper()
            if configured_method != request_method:
                return {
                    "valid": False,
                    "error": f"HTTP method mismatch. Expected {configured_method}, got {request_method}",
                }

            # Validate Content-type
            configured_content_type = node_data.get("content_type", "application/json").lower()
            request_content_type = webhook_data["headers"].get("Content-Type", "").lower()
            if not request_content_type:
                request_content_type = webhook_data["headers"].get("content-type", "application/json").lower()
            if configured_content_type != request_content_type:
                return {
                    "valid": False,
                    "error": f"Content-type mismatch. Expected {configured_content_type}, got {request_content_type}",
                }

            # Validate required headers (case-insensitive)
            headers = node_data.get("headers", [])
            # Create case-insensitive header lookup
            webhook_headers_lower = {k.lower(): v for k, v in webhook_data["headers"].items()}
            for header in headers:
                if header.get("required", False):
                    header_name = header.get("name", "")
                    if header_name.lower() not in webhook_headers_lower:
                        return {"valid": False, "error": f"Required header missing: {header_name}"}

            # Validate required query parameters
            params = node_data.get("params", [])
            for param in params:
                if param.get("required", False):
                    param_name = param.get("name", "")
                    if param_name not in webhook_data["query_params"]:
                        return {"valid": False, "error": f"Required query parameter missing: {param_name}"}

            if configured_content_type == "text/plain":
                # For text/plain, just validate that we have a body if any body params are configured as required
                body_params = node_data.get("body", [])
                if body_params and any(param.get("required", False) for param in body_params):
                    body_data = webhook_data.get("body", {})
                    raw_content = body_data.get("raw", "")
                    if not raw_content or not isinstance(raw_content, str):
                        return {"valid": False, "error": "Required body content missing for text/plain request"}

            elif configured_content_type == "application/json":
                # For application/json, validate both existence and types of parameters
                body_params = node_data.get("body", [])
                body_data = webhook_data.get("body", {})

                for body_param in body_params:
                    param_name = body_param.get("name", "")
                    param_type = body_param.get("type", SegmentType.STRING)
                    is_required = body_param.get("required", False)

                    # Handle regular JSON parameters
                    param_exists = param_name in body_data

                    # Check if required parameter exists
                    if is_required and not param_exists:
                        return {"valid": False, "error": f"Required body parameter missing: {param_name}"}

                    # Validate parameter type if it exists
                    if param_exists:
                        param_value = body_data[param_name]
                        validation_result = cls._validate_json_parameter_type(param_name, param_value, param_type)
                        if not validation_result["valid"]:
                            return validation_result

            elif configured_content_type == "application/octet-stream":
                # For octet-stream, the binary data is processed as a file object
                body_params = node_data.get("body", [])
                body_data = webhook_data.get("body", {})

                if body_params and any(param.get("required", False) for param in body_params):
                    raw_file = body_data.get("raw")
                    if not raw_file:
                        return {
                            "valid": False,
                            "error": "Required binary data missing for application/octet-stream request",
                        }

            else:
                raise ValueError(f"Unsupported Content-Type for validation: {configured_content_type}")

            return {"valid": True}

        except Exception:
            logger.exception("Validation error")
            return {"valid": False, "error": "Validation failed"}

    @classmethod
    def _validate_json_parameter_type(cls, param_name: str, param_value: Any, param_type: str) -> dict[str, Any]:
        """Validate JSON parameter type against expected type."""
        try:
            if param_type == SegmentType.STRING:
                if not isinstance(param_value, str):
                    return {
                        "valid": False,
                        "error": f"Parameter '{param_name}' must be a string, got {type(param_value).__name__}",
                    }

            elif param_type == SegmentType.NUMBER:
                if not isinstance(param_value, (int, float)):
                    return {
                        "valid": False,
                        "error": f"Parameter '{param_name}' must be a number, got {type(param_value).__name__}",
                    }

            elif param_type == SegmentType.BOOLEAN:
                if not isinstance(param_value, bool):
                    return {
                        "valid": False,
                        "error": f"Parameter '{param_name}' must be a boolean, got {type(param_value).__name__}",
                    }

            elif param_type == SegmentType.OBJECT:
                if not isinstance(param_value, dict):
                    return {
                        "valid": False,
                        "error": f"Parameter '{param_name}' must be an object, got {type(param_value).__name__}",
                    }

            elif param_type == SegmentType.ARRAY_STRING:
                if not isinstance(param_value, list):
                    return {
                        "valid": False,
                        "error": f"Parameter '{param_name}' must be an array, got {type(param_value).__name__}",
                    }
                if not all(isinstance(item, str) for item in param_value):
                    return {"valid": False, "error": f"Parameter '{param_name}' must be an array of strings"}

            elif param_type == SegmentType.ARRAY_NUMBER:
                if not isinstance(param_value, list):
                    return {
                        "valid": False,
                        "error": f"Parameter '{param_name}' must be an array, got {type(param_value).__name__}",
                    }
                if not all(isinstance(item, (int, float)) for item in param_value):
                    return {"valid": False, "error": f"Parameter '{param_name}' must be an array of numbers"}

            elif param_type == SegmentType.ARRAY_BOOLEAN:
                if not isinstance(param_value, list):
                    return {
                        "valid": False,
                        "error": f"Parameter '{param_name}' must be an array, got {type(param_value).__name__}",
                    }
                if not all(isinstance(item, bool) for item in param_value):
                    return {"valid": False, "error": f"Parameter '{param_name}' must be an array of booleans"}

            elif param_type == SegmentType.ARRAY_OBJECT:
                if not isinstance(param_value, list):
                    return {
                        "valid": False,
                        "error": f"Parameter '{param_name}' must be an array, got {type(param_value).__name__}",
                    }
                if not all(isinstance(item, dict) for item in param_value):
                    return {"valid": False, "error": f"Parameter '{param_name}' must be an array of objects"}

            else:
                # Unknown type, skip validation
                logger.warning("Unknown parameter type: %s for parameter %s", param_type, param_name)

            return {"valid": True}

        except Exception:
            logger.exception("Type validation error for parameter %s", param_name)
            return {"valid": False, "error": f"Type validation failed for parameter '{param_name}'"}

    @classmethod
    def trigger_workflow_execution(
        cls, webhook_trigger: WorkflowWebhookTrigger, webhook_data: dict[str, Any], workflow: Workflow
    ) -> None:
        """Trigger workflow execution via AsyncWorkflowService."""
        try:
            with Session(db.engine) as session:
                # Get tenant owner as the user for webhook execution
                tenant_owner = session.scalar(
                    select(Account)
                    .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
                    .where(
                        TenantAccountJoin.tenant_id == webhook_trigger.tenant_id,
                        TenantAccountJoin.role == TenantAccountRole.OWNER,
                    )
                )

                if not tenant_owner:
                    logger.error("Tenant owner not found for tenant %s", webhook_trigger.tenant_id)
                    raise ValueError("Tenant owner not found")

                # Prepare inputs for the webhook node
                # The webhook node expects webhook_data in the inputs
                workflow_inputs = {
                    "webhook_data": webhook_data,
                    "webhook_headers": webhook_data.get("headers", {}),
                    "webhook_query_params": webhook_data.get("query_params", {}),
                    "webhook_body": webhook_data.get("body", {}),
                    "webhook_files": webhook_data.get("files", {}),
                }

                # Create trigger data
                trigger_data = TriggerData(
                    app_id=webhook_trigger.app_id,
                    workflow_id=workflow.id,
                    root_node_id=webhook_trigger.node_id,  # Start from the webhook node
                    trigger_type=WorkflowRunTriggeredFrom.WEBHOOK,
                    inputs=workflow_inputs,
                    tenant_id=webhook_trigger.tenant_id,
                )

                # Trigger workflow execution asynchronously
                AsyncWorkflowService.trigger_workflow_async(
                    session,
                    tenant_owner,
                    trigger_data,
                )

        except Exception:
            logger.exception("Failed to trigger workflow for webhook %s", webhook_trigger.webhook_id)
            raise

    @classmethod
    def generate_webhook_response(cls, node_config: Mapping[str, Any]) -> tuple[dict[str, Any], int]:
        """Generate HTTP response based on node configuration."""
        node_data = node_config.get("data", {})

        # Get configured status code and response body
        status_code = node_data.get("status_code", 200)
        response_body = node_data.get("response_body", "")

        # Parse response body as JSON if it's valid JSON, otherwise return as text
        try:
            if response_body:
                try:
                    response_data = (
                        json.loads(response_body)
                        if response_body.strip().startswith(("{", "["))
                        else {"message": response_body}
                    )
                except json.JSONDecodeError:
                    response_data = {"message": response_body}
            else:
                response_data = {"status": "success", "message": "Webhook processed successfully"}
        except:
            response_data = {"message": response_body or "Webhook processed successfully"}

        return response_data, status_code
