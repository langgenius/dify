import logging
from collections.abc import Mapping
from typing import Any

from flask import request
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.file.models import FileTransferMethod
from core.tools.tool_file_manager import ToolFileManager
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
        else:
            # Raw text data
            try:
                data["body"] = {"raw": request.get_data(as_text=True)}
            except Exception:
                data["body"] = {"raw": ""}

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

            # Validate required body parameters
            body_params = node_data.get("body", [])
            for body_param in body_params:
                if body_param.get("required", False):
                    param_name = body_param.get("name", "")
                    param_type = body_param.get("type", "string")

                    # Check if parameter exists
                    if param_type == "file":
                        file_obj = webhook_data.get("files", {}).get(param_name)
                        if not file_obj:
                            return {"valid": False, "error": f"Required file parameter missing: {param_name}"}
                    else:
                        if param_name not in webhook_data.get("body", {}):
                            return {"valid": False, "error": f"Required body parameter missing: {param_name}"}

            return {"valid": True}

        except Exception:
            logger.exception("Validation error")
            return {"valid": False, "error": "Validation failed"}

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
        import json

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
