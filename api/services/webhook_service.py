import json
import logging
import mimetypes
import secrets
from collections.abc import Mapping
from typing import Any

from flask import request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import RequestEntityTooLarge

from configs import dify_config
from core.file.models import FileTransferMethod
from core.tools.tool_file_manager import ToolFileManager
from core.variables.types import SegmentType
from core.workflow.nodes.enums import NodeType
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from factories import file_factory
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.enums import WorkflowRunTriggeredFrom
from models.model import App
from models.workflow import AppTrigger, AppTriggerStatus, AppTriggerType, Workflow, WorkflowWebhookTrigger
from services.async_workflow_service import AsyncWorkflowService
from services.workflow.entities import TriggerData

logger = logging.getLogger(__name__)


class WebhookService:
    """Service for handling webhook operations."""

    __WEBHOOK_NODE_CACHE_KEY__ = "webhook_nodes"
    MAX_WEBHOOK_NODES_PER_WORKFLOW = 5  # Maximum allowed webhook nodes per workflow

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
        cls._validate_content_length()

        data = {
            "method": request.method,
            "headers": dict(request.headers),
            "query_params": dict(request.args),
            "body": {},
            "files": {},
        }

        # Extract and normalize content type
        content_type = cls._extract_content_type(dict(request.headers))

        # Route to appropriate extractor based on content type
        extractors = {
            "application/json": cls._extract_json_body,
            "application/x-www-form-urlencoded": cls._extract_form_body,
            "multipart/form-data": lambda: cls._extract_multipart_body(webhook_trigger),
            "application/octet-stream": lambda: cls._extract_octet_stream_body(webhook_trigger),
            "text/plain": cls._extract_text_body,
        }

        extractor = extractors.get(content_type)
        if not extractor:
            # Default to text/plain for unknown content types
            logger.warning("Unknown Content-Type: %s, treating as text/plain", content_type)
            extractor = cls._extract_text_body

        # Extract body and files
        body_data, files_data = extractor()
        data["body"] = body_data
        data["files"] = files_data

        return data

    @classmethod
    def _validate_content_length(cls) -> None:
        """Validate request content length against maximum allowed size."""
        content_length = request.content_length
        if content_length and content_length > dify_config.WEBHOOK_REQUEST_BODY_MAX_SIZE:
            raise RequestEntityTooLarge(
                f"Webhook request too large: {content_length} bytes exceeds maximum allowed size "
                f"of {dify_config.WEBHOOK_REQUEST_BODY_MAX_SIZE} bytes"
            )

    @classmethod
    def _extract_json_body(cls) -> tuple[dict[str, Any], dict[str, Any]]:
        """Extract JSON body from request."""
        try:
            body = request.get_json() or {}
        except Exception:
            logger.warning("Failed to parse JSON body")
            body = {}
        return body, {}

    @classmethod
    def _extract_form_body(cls) -> tuple[dict[str, Any], dict[str, Any]]:
        """Extract form-urlencoded body from request."""
        return dict(request.form), {}

    @classmethod
    def _extract_multipart_body(cls, webhook_trigger: WorkflowWebhookTrigger) -> tuple[dict[str, Any], dict[str, Any]]:
        """Extract multipart/form-data body and files from request."""
        body = dict(request.form)
        files = cls._process_file_uploads(request.files, webhook_trigger) if request.files else {}
        return body, files

    @classmethod
    def _extract_octet_stream_body(
        cls, webhook_trigger: WorkflowWebhookTrigger
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Extract binary data as file from request."""
        try:
            file_content = request.get_data()
            if file_content:
                file_obj = cls._create_file_from_binary(file_content, "application/octet-stream", webhook_trigger)
                return {"raw": file_obj.to_dict()}, {}
            else:
                return {"raw": None}, {}
        except Exception:
            logger.exception("Failed to process octet-stream data")
            return {"raw": None}, {}

    @classmethod
    def _extract_text_body(cls) -> tuple[dict[str, Any], dict[str, Any]]:
        """Extract text/plain body from request."""
        try:
            body = {"raw": request.get_data(as_text=True)}
        except Exception:
            logger.warning("Failed to extract text body")
            body = {"raw": ""}
        return body, {}

    @classmethod
    def _process_file_uploads(cls, files, webhook_trigger: WorkflowWebhookTrigger) -> dict[str, Any]:
        """Process file uploads using ToolFileManager."""
        processed_files = {}

        for name, file in files.items():
            if file and file.filename:
                try:
                    file_content = file.read()
                    mimetype = file.content_type or mimetypes.guess_type(file.filename)[0] or "application/octet-stream"
                    file_obj = cls._create_file_from_binary(file_content, mimetype, webhook_trigger)
                    processed_files[name] = file_obj.to_dict()
                except Exception:
                    logger.exception("Failed to process file upload '%s'", name)
                    # Continue processing other files

        return processed_files

    @classmethod
    def _create_file_from_binary(
        cls, file_content: bytes, mimetype: str, webhook_trigger: WorkflowWebhookTrigger
    ) -> Any:
        """Create a file object from binary content using ToolFileManager."""
        tool_file_manager = ToolFileManager()

        # Create file using ToolFileManager
        tool_file = tool_file_manager.create_file_by_raw(
            user_id=webhook_trigger.created_by,
            tenant_id=webhook_trigger.tenant_id,
            conversation_id=None,
            file_binary=file_content,
            mimetype=mimetype,
        )

        # Build File object
        mapping = {
            "tool_file_id": tool_file.id,
            "transfer_method": FileTransferMethod.TOOL_FILE.value,
        }
        return file_factory.build_from_mapping(
            mapping=mapping,
            tenant_id=webhook_trigger.tenant_id,
        )

    @classmethod
    def validate_webhook_request(cls, webhook_data: dict[str, Any], node_config: Mapping[str, Any]) -> dict[str, Any]:
        """Validate webhook request against node configuration."""
        if node_config is None:
            return cls._validation_error("Validation failed: Invalid node configuration")

        node_data = node_config.get("data", {})

        # Early validation of HTTP method and content-type
        validation_result = cls._validate_http_metadata(webhook_data, node_data)
        if not validation_result["valid"]:
            return validation_result

        # Validate headers and query params
        validation_result = cls._validate_headers_and_params(webhook_data, node_data)
        if not validation_result["valid"]:
            return validation_result

        # Validate body based on content type
        configured_content_type = node_data.get("content_type", "application/json").lower()
        return cls._validate_body_by_content_type(webhook_data, node_data, configured_content_type)

    @classmethod
    def _validate_http_metadata(cls, webhook_data: dict[str, Any], node_data: dict[str, Any]) -> dict[str, Any]:
        """Validate HTTP method and content-type."""
        # Validate HTTP method
        configured_method = node_data.get("method", "get").upper()
        request_method = webhook_data["method"].upper()
        if configured_method != request_method:
            return cls._validation_error(f"HTTP method mismatch. Expected {configured_method}, got {request_method}")

        # Validate Content-type
        configured_content_type = node_data.get("content_type", "application/json").lower()
        request_content_type = cls._extract_content_type(webhook_data["headers"])

        if configured_content_type != request_content_type:
            return cls._validation_error(
                f"Content-type mismatch. Expected {configured_content_type}, got {request_content_type}"
            )

        return {"valid": True}

    @classmethod
    def _extract_content_type(cls, headers: dict[str, Any]) -> str:
        """Extract and normalize content-type from headers."""
        content_type = headers.get("Content-Type", "").lower()
        if not content_type:
            content_type = headers.get("content-type", "application/json").lower()
        # Extract the main content type (ignore parameters like boundary)
        return content_type.split(";")[0].strip()

    @classmethod
    def _validate_headers_and_params(cls, webhook_data: dict[str, Any], node_data: dict[str, Any]) -> dict[str, Any]:
        """Validate required headers and query parameters."""
        # Validate required headers (case-insensitive)
        webhook_headers_lower = {k.lower(): v for k, v in webhook_data["headers"].items()}
        for header in node_data.get("headers", []):
            if header.get("required", False):
                header_name = header.get("name", "")
                if header_name.lower() not in webhook_headers_lower:
                    return cls._validation_error(f"Required header missing: {header_name}")

        # Validate required query parameters
        for param in node_data.get("params", []):
            if param.get("required", False):
                param_name = param.get("name", "")
                if param_name not in webhook_data["query_params"]:
                    return cls._validation_error(f"Required query parameter missing: {param_name}")

        return {"valid": True}

    @classmethod
    def _validate_body_by_content_type(
        cls, webhook_data: dict[str, Any], node_data: dict[str, Any], content_type: str
    ) -> dict[str, Any]:
        """Route body validation to appropriate validator based on content type."""
        validators = {
            "text/plain": cls._validate_text_plain_body,
            "application/octet-stream": cls._validate_octet_stream_body,
            "application/json": cls._validate_json_body,
            "application/x-www-form-urlencoded": cls._validate_form_urlencoded_body,
            "multipart/form-data": cls._validate_multipart_body,
        }

        validator = validators.get(content_type)
        if not validator:
            raise ValueError(f"Unsupported Content-Type for validation: {content_type}")

        return validator(webhook_data, node_data)

    @classmethod
    def _validate_text_plain_body(cls, webhook_data: dict[str, Any], node_data: dict[str, Any]) -> dict[str, Any]:
        """Validate text/plain body."""
        body_params = node_data.get("body", [])
        if body_params and any(param.get("required", False) for param in body_params):
            body_data = webhook_data.get("body", {})
            raw_content = body_data.get("raw", "")
            if not raw_content or not isinstance(raw_content, str):
                return cls._validation_error("Required body content missing for text/plain request")
        return {"valid": True}

    @classmethod
    def _validate_octet_stream_body(cls, webhook_data: dict[str, Any], node_data: dict[str, Any]) -> dict[str, Any]:
        """Validate application/octet-stream body."""
        body_params = node_data.get("body", [])
        if body_params and any(param.get("required", False) for param in body_params):
            body_data = webhook_data.get("body", {})
            raw_content = body_data.get("raw", "")
            if not raw_content or not isinstance(raw_content, bytes):
                return cls._validation_error("Required body content missing for application/octet-stream request")
        return {"valid": True}

    @classmethod
    def _validate_json_body(cls, webhook_data: dict[str, Any], node_data: dict[str, Any]) -> dict[str, Any]:
        """Validate application/json body."""
        body_params = node_data.get("body", [])
        body_data = webhook_data.get("body", {})

        for body_param in body_params:
            param_name = body_param.get("name", "")
            param_type = body_param.get("type", SegmentType.STRING)
            is_required = body_param.get("required", False)

            param_exists = param_name in body_data

            if is_required and not param_exists:
                return cls._validation_error(f"Required body parameter missing: {param_name}")

            if param_exists:
                param_value = body_data[param_name]
                validation_result = cls._validate_json_parameter_type(param_name, param_value, param_type)
                if not validation_result["valid"]:
                    return validation_result

        return {"valid": True}

    @classmethod
    def _validate_form_urlencoded_body(cls, webhook_data: dict[str, Any], node_data: dict[str, Any]) -> dict[str, Any]:
        """Validate application/x-www-form-urlencoded body."""
        body_params = node_data.get("body", [])
        body_data = webhook_data.get("body", {})

        for body_param in body_params:
            param_name = body_param.get("name", "")
            param_type = body_param.get("type", SegmentType.STRING)
            is_required = body_param.get("required", False)

            param_exists = param_name in body_data
            if is_required and not param_exists:
                return cls._validation_error(f"Required body parameter missing: {param_name}")

            if param_exists and param_type != SegmentType.STRING:
                param_value = body_data[param_name]
                validation_result = cls._validate_form_parameter_type(param_name, param_value, param_type)
                if not validation_result["valid"]:
                    return validation_result

        return {"valid": True}

    @classmethod
    def _validate_multipart_body(cls, webhook_data: dict[str, Any], node_data: dict[str, Any]) -> dict[str, Any]:
        """Validate multipart/form-data body."""
        body_params = node_data.get("body", [])
        body_data = webhook_data.get("body", {})

        for body_param in body_params:
            param_name = body_param.get("name", "")
            param_type = body_param.get("type", SegmentType.STRING)
            is_required = body_param.get("required", False)

            if param_type == SegmentType.FILE:
                file_obj = webhook_data.get("files", {}).get(param_name)
                if is_required and not file_obj:
                    return cls._validation_error(f"Required file parameter missing: {param_name}")
            else:
                param_exists = param_name in body_data

                if is_required and not param_exists:
                    return cls._validation_error(f"Required body parameter missing: {param_name}")

                if param_exists and param_type != SegmentType.STRING:
                    param_value = body_data[param_name]
                    validation_result = cls._validate_form_parameter_type(param_name, param_value, param_type)
                    if not validation_result["valid"]:
                        return validation_result

        return {"valid": True}

    @classmethod
    def _validation_error(cls, error_message: str) -> dict[str, Any]:
        """Create a standard validation error response."""
        return {"valid": False, "error": error_message}

    @classmethod
    def _validate_json_parameter_type(cls, param_name: str, param_value: Any, param_type: str) -> dict[str, Any]:
        """Validate JSON parameter type against expected type."""
        try:
            # Define type validators
            type_validators = {
                SegmentType.STRING: (lambda v: isinstance(v, str), "string"),
                SegmentType.NUMBER: (lambda v: isinstance(v, (int, float)), "number"),
                SegmentType.BOOLEAN: (lambda v: isinstance(v, bool), "boolean"),
                SegmentType.OBJECT: (lambda v: isinstance(v, dict), "object"),
                SegmentType.ARRAY_STRING: (
                    lambda v: isinstance(v, list) and all(isinstance(item, str) for item in v),
                    "array of strings",
                ),
                SegmentType.ARRAY_NUMBER: (
                    lambda v: isinstance(v, list) and all(isinstance(item, (int, float)) for item in v),
                    "array of numbers",
                ),
                SegmentType.ARRAY_BOOLEAN: (
                    lambda v: isinstance(v, list) and all(isinstance(item, bool) for item in v),
                    "array of booleans",
                ),
                SegmentType.ARRAY_OBJECT: (
                    lambda v: isinstance(v, list) and all(isinstance(item, dict) for item in v),
                    "array of objects",
                ),
            }

            # Get validator for the type
            validator_info = type_validators.get(SegmentType(param_type))
            if not validator_info:
                logger.warning("Unknown parameter type: %s for parameter %s", param_type, param_name)
                return {"valid": True}

            validator, expected_type = validator_info

            # Validate the parameter
            if not validator(param_value):
                # Check if it's an array type first
                if param_type.startswith("array") and not isinstance(param_value, list):
                    actual_type = type(param_value).__name__
                    error_msg = f"Parameter '{param_name}' must be an array, got {actual_type}"
                else:
                    actual_type = type(param_value).__name__
                    # Format error message based on expected type
                    if param_type.startswith("array"):
                        error_msg = f"Parameter '{param_name}' must be an {expected_type}"
                    elif expected_type in ["string", "number", "boolean"]:
                        error_msg = f"Parameter '{param_name}' must be a {expected_type}, got {actual_type}"
                    else:
                        error_msg = f"Parameter '{param_name}' must be an {expected_type}, got {actual_type}"

                return {"valid": False, "error": error_msg}

            return {"valid": True}

        except Exception:
            logger.exception("Type validation error for parameter %s", param_name)
            return {"valid": False, "error": f"Type validation failed for parameter '{param_name}'"}

    @classmethod
    def _validate_form_parameter_type(cls, param_name: str, param_value: str, param_type: str) -> dict[str, Any]:
        """Validate form parameter type against expected type. Form data are always strings but can be converted."""
        try:
            # Define form type converters and validators
            form_validators = {
                SegmentType.STRING: (lambda _: True, None),  # String is always valid
                SegmentType.NUMBER: (lambda v: cls._can_convert_to_number(v), "a valid number"),
                SegmentType.BOOLEAN: (
                    lambda v: v.lower() in ["true", "false", "1", "0", "yes", "no"],
                    "a boolean value",
                ),
            }

            # Get validator for the type
            validator_info = form_validators.get(SegmentType(param_type))
            if not validator_info:
                # Unsupported type for form data
                return {
                    "valid": False,
                    "error": f"Parameter '{param_name}' type '{param_type}' is not supported for form data.",
                }

            validator, expected_format = validator_info

            # Validate the parameter
            if not validator(param_value):
                return {
                    "valid": False,
                    "error": f"Parameter '{param_name}' must be {expected_format}, got '{param_value}'",
                }

            return {"valid": True}

        except Exception:
            logger.exception("Form type validation error for parameter %s", param_name)
            return {"valid": False, "error": f"Form type validation failed for parameter '{param_name}'"}

    @classmethod
    def _can_convert_to_number(cls, value: str) -> bool:
        """Check if a string can be converted to a number."""
        try:
            float(value)
            return True
        except ValueError:
            return False

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

    @classmethod
    def sync_webhook_relationships(cls, app: App, workflow: Workflow):
        """
        Sync webhook relationships in DB.

        1. Check if the workflow has any webhook trigger nodes
        2. Fetch the nodes from DB, see if there were any webhook records already
        3. Diff the nodes and the webhook records, create/update/delete the webhook records as needed

        Approach:
        Frequent DB operations may cause performance issues, using Redis to cache it instead.
        If any record exists, cache it.

        Limits:
        - Maximum 5 webhook nodes per workflow
        """

        class Cache(BaseModel):
            """
            Cache model for webhook nodes
            """

            record_id: str
            node_id: str
            webhook_id: str

        nodes_id_in_graph = [node_id for node_id, _ in workflow.walk_nodes(NodeType.TRIGGER_WEBHOOK)]

        # Check webhook node limit
        if len(nodes_id_in_graph) > cls.MAX_WEBHOOK_NODES_PER_WORKFLOW:
            raise ValueError(
                f"Workflow exceeds maximum webhook node limit. "
                f"Found {len(nodes_id_in_graph)} webhook nodes, maximum allowed is {cls.MAX_WEBHOOK_NODES_PER_WORKFLOW}"
            )

        not_found_in_cache: list[str] = []
        for node_id in nodes_id_in_graph:
            # firstly check if the node exists in cache
            if not redis_client.get(f"{cls.__WEBHOOK_NODE_CACHE_KEY__}:{node_id}"):
                not_found_in_cache.append(node_id)
                continue

        with Session(db.engine) as session:
            try:
                # lock the concurrent webhook trigger creation
                redis_client.lock(f"{cls.__WEBHOOK_NODE_CACHE_KEY__}:apps:{app.id}:lock", timeout=10)
                # fetch the non-cached nodes from DB
                all_records = session.scalars(
                    select(WorkflowWebhookTrigger).where(
                        WorkflowWebhookTrigger.app_id == app.id,
                        WorkflowWebhookTrigger.tenant_id == app.tenant_id,
                    )
                ).all()

                nodes_id_in_db = {node.node_id: node for node in all_records}

                # get the nodes not found both in cache and DB
                nodes_not_found = [node_id for node_id in not_found_in_cache if node_id not in nodes_id_in_db]

                # create new webhook records
                for node_id in nodes_not_found:
                    webhook_record = WorkflowWebhookTrigger(
                        app_id=app.id,
                        tenant_id=app.tenant_id,
                        node_id=node_id,
                        webhook_id=cls.generate_webhook_id(),
                        created_by=app.created_by,
                    )
                    session.add(webhook_record)
                    cache = Cache(record_id=webhook_record.id, node_id=node_id, webhook_id=webhook_record.webhook_id)
                    redis_client.set(f"{cls.__WEBHOOK_NODE_CACHE_KEY__}:{node_id}", cache.model_dump_json(), ex=60 * 60)
                session.commit()

                # delete the nodes not found in the graph
                for node_id in nodes_id_in_db:
                    if node_id not in nodes_id_in_graph:
                        session.delete(nodes_id_in_db[node_id])
                        redis_client.delete(f"{cls.__WEBHOOK_NODE_CACHE_KEY__}:{node_id}")
                session.commit()
            except Exception:
                logger.exception("Failed to sync webhook relationships for app %s", app.id)
                raise
            finally:
                redis_client.delete(f"{cls.__WEBHOOK_NODE_CACHE_KEY__}:apps:{app.id}:lock")

    @classmethod
    def generate_webhook_id(cls) -> str:
        """Generate unique 24-character webhook ID"""
        # Generate 24-character random string
        return secrets.token_urlsafe(18)[:24]  # token_urlsafe gives base64url, take first 24 chars
