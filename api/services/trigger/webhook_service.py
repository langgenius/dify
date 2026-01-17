import json
import logging
import mimetypes
import secrets
from collections.abc import Mapping
from typing import Any

import orjson
from flask import request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import RequestEntityTooLarge

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from core.file.models import FileTransferMethod
from core.tools.tool_file_manager import ToolFileManager
from core.variables.types import SegmentType
from core.workflow.enums import NodeType
from enums.quota_type import QuotaType
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from factories import file_factory
from models.enums import AppTriggerStatus, AppTriggerType
from models.model import App
from models.trigger import AppTrigger, WorkflowWebhookTrigger
from models.workflow import Workflow
from services.async_workflow_service import AsyncWorkflowService
from services.end_user_service import EndUserService
from services.errors.app import QuotaExceededError
from services.trigger.app_trigger_service import AppTriggerService
from services.workflow.entities import WebhookTriggerData

try:
    import magic
except ImportError:
    magic = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


class WebhookService:
    """Service for handling webhook operations."""

    __WEBHOOK_NODE_CACHE_KEY__ = "webhook_nodes"
    MAX_WEBHOOK_NODES_PER_WORKFLOW = 5  # Maximum allowed webhook nodes per workflow

    @staticmethod
    def _sanitize_key(key: str) -> str:
        """Normalize external keys (headers/params) to workflow-safe variables."""
        if not isinstance(key, str):
            return key
        return key.replace("-", "_")

    @classmethod
    def get_webhook_trigger_and_workflow(
        cls, webhook_id: str, is_debug: bool = False
    ) -> tuple[WorkflowWebhookTrigger, Workflow, Mapping[str, Any]]:
        """Get webhook trigger, workflow, and node configuration.

        Args:
            webhook_id: The webhook ID to look up
            is_debug: If True, use the draft workflow graph and skip the trigger enabled status check

        Returns:
            A tuple containing:
                - WorkflowWebhookTrigger: The webhook trigger object
                - Workflow: The associated workflow object
                - Mapping[str, Any]: The node configuration data

        Raises:
            ValueError: If webhook not found, app trigger not found, trigger disabled, or workflow not found
        """
        with Session(db.engine) as session:
            # Get webhook trigger
            webhook_trigger = (
                session.query(WorkflowWebhookTrigger).where(WorkflowWebhookTrigger.webhook_id == webhook_id).first()
            )
            if not webhook_trigger:
                raise ValueError(f"Webhook not found: {webhook_id}")

            if is_debug:
                workflow = (
                    session.query(Workflow)
                    .filter(
                        Workflow.app_id == webhook_trigger.app_id,
                        Workflow.version == Workflow.VERSION_DRAFT,
                    )
                    .order_by(Workflow.created_at.desc())
                    .first()
                )
            else:
                # Check if the corresponding AppTrigger exists
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

                # Only check enabled status if not in debug mode

                if app_trigger.status == AppTriggerStatus.RATE_LIMITED:
                    raise ValueError(
                        f"Webhook trigger is rate limited for webhook {webhook_id}, please upgrade your plan."
                    )

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
    def extract_and_validate_webhook_data(
        cls, webhook_trigger: WorkflowWebhookTrigger, node_config: Mapping[str, Any]
    ) -> dict[str, Any]:
        """Extract and validate webhook data in a single unified process.

        Args:
            webhook_trigger: The webhook trigger object containing metadata
            node_config: The node configuration containing validation rules

        Returns:
            dict[str, Any]: Processed and validated webhook data with correct types

        Raises:
            ValueError: If validation fails (HTTP method mismatch, missing required fields, type errors)
        """
        # Extract raw data first
        raw_data = cls.extract_webhook_data(webhook_trigger)

        # Validate HTTP metadata (method, content-type)
        node_data = node_config.get("data", {})
        validation_result = cls._validate_http_metadata(raw_data, node_data)
        if not validation_result["valid"]:
            raise ValueError(validation_result["error"])

        # Process and validate data according to configuration
        processed_data = cls._process_and_validate_data(raw_data, node_data)

        return processed_data

    @classmethod
    def extract_webhook_data(cls, webhook_trigger: WorkflowWebhookTrigger) -> dict[str, Any]:
        """Extract raw data from incoming webhook request without type conversion.

        Args:
            webhook_trigger: The webhook trigger object for file processing context

        Returns:
            dict[str, Any]: Raw webhook data containing:
                - method: HTTP method
                - headers: Request headers
                - query_params: Query parameters as strings
                - body: Request body (varies by content type; JSON parsing errors raise ValueError)
                - files: Uploaded files (if any)
        """
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
    def _process_and_validate_data(cls, raw_data: dict[str, Any], node_data: dict[str, Any]) -> dict[str, Any]:
        """Process and validate webhook data according to node configuration.

        Args:
            raw_data: Raw webhook data from extraction
            node_data: Node configuration containing validation and type rules

        Returns:
            dict[str, Any]: Processed data with validated types

        Raises:
            ValueError: If validation fails or required fields are missing
        """
        result = raw_data.copy()

        # Validate and process headers
        cls._validate_required_headers(raw_data["headers"], node_data.get("headers", []))

        # Process query parameters with type conversion and validation
        result["query_params"] = cls._process_parameters(
            raw_data["query_params"], node_data.get("params", []), is_form_data=True
        )

        # Process body parameters based on content type
        configured_content_type = node_data.get("content_type", "application/json").lower()
        result["body"] = cls._process_body_parameters(
            raw_data["body"], node_data.get("body", []), configured_content_type
        )

        return result

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
        """Extract JSON body from request.

        Returns:
            tuple: (body_data, files_data) where:
                - body_data: Parsed JSON content
                - files_data: Empty dict (JSON requests don't contain files)

        Raises:
            ValueError: If JSON parsing fails
        """
        raw_body = request.get_data(cache=True)
        if not raw_body or raw_body.strip() == b"":
            return {}, {}

        try:
            body = orjson.loads(raw_body)
        except orjson.JSONDecodeError as exc:
            logger.warning("Failed to parse JSON body: %s", exc)
            raise ValueError(f"Invalid JSON body: {exc}") from exc
        return body, {}

    @classmethod
    def _extract_form_body(cls) -> tuple[dict[str, Any], dict[str, Any]]:
        """Extract form-urlencoded body from request.

        Returns:
            tuple: (body_data, files_data) where:
                - body_data: Form data as key-value pairs
                - files_data: Empty dict (form-urlencoded requests don't contain files)
        """
        return dict(request.form), {}

    @classmethod
    def _extract_multipart_body(cls, webhook_trigger: WorkflowWebhookTrigger) -> tuple[dict[str, Any], dict[str, Any]]:
        """Extract multipart/form-data body and files from request.

        Args:
            webhook_trigger: Webhook trigger for file processing context

        Returns:
            tuple: (body_data, files_data) where:
                - body_data: Form data as key-value pairs
                - files_data: Processed file objects indexed by field name
        """
        body = dict(request.form)
        files = cls._process_file_uploads(request.files, webhook_trigger) if request.files else {}
        return body, files

    @classmethod
    def _extract_octet_stream_body(
        cls, webhook_trigger: WorkflowWebhookTrigger
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Extract binary data as file from request.

        Args:
            webhook_trigger: Webhook trigger for file processing context

        Returns:
            tuple: (body_data, files_data) where:
                - body_data: Dict with 'raw' key containing file object or None
                - files_data: Empty dict
        """
        try:
            file_content = request.get_data()
            if file_content:
                mimetype = cls._detect_binary_mimetype(file_content)
                file_obj = cls._create_file_from_binary(file_content, mimetype, webhook_trigger)
                return {"raw": file_obj.to_dict()}, {}
            else:
                return {"raw": None}, {}
        except Exception:
            logger.exception("Failed to process octet-stream data")
            return {"raw": None}, {}

    @classmethod
    def _extract_text_body(cls) -> tuple[dict[str, Any], dict[str, Any]]:
        """Extract text/plain body from request.

        Returns:
            tuple: (body_data, files_data) where:
                - body_data: Dict with 'raw' key containing text content
                - files_data: Empty dict (text requests don't contain files)
        """
        try:
            body = {"raw": request.get_data(as_text=True)}
        except Exception:
            logger.warning("Failed to extract text body")
            body = {"raw": ""}
        return body, {}

    @staticmethod
    def _detect_binary_mimetype(file_content: bytes) -> str:
        """Guess MIME type for binary payloads using python-magic when available."""
        if magic is not None:
            try:
                detected = magic.from_buffer(file_content[:1024], mime=True)
                if detected:
                    return detected
            except Exception:
                logger.debug("python-magic detection failed for octet-stream payload")
        return "application/octet-stream"

    @classmethod
    def _process_file_uploads(
        cls, files: Mapping[str, FileStorage], webhook_trigger: WorkflowWebhookTrigger
    ) -> dict[str, Any]:
        """Process file uploads using ToolFileManager.

        Args:
            files: Flask request files object containing uploaded files
            webhook_trigger: Webhook trigger for tenant and user context

        Returns:
            dict[str, Any]: Processed file objects indexed by field name
        """
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
        """Create a file object from binary content using ToolFileManager.

        Args:
            file_content: The binary content of the file
            mimetype: The MIME type of the file
            webhook_trigger: Webhook trigger for tenant and user context

        Returns:
            Any: A file object built from the binary content
        """
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
    def _process_parameters(
        cls, raw_params: dict[str, str], param_configs: list, is_form_data: bool = False
    ) -> dict[str, Any]:
        """Process parameters with unified validation and type conversion.

        Args:
            raw_params: Raw parameter values as strings
            param_configs: List of parameter configuration dictionaries
            is_form_data: Whether the parameters are from form data (requiring string conversion)

        Returns:
            dict[str, Any]: Processed parameters with validated types

        Raises:
            ValueError: If required parameters are missing or validation fails
        """
        processed = {}
        configured_params = {config.get("name", ""): config for config in param_configs}

        # Process configured parameters
        for param_config in param_configs:
            name = param_config.get("name", "")
            param_type = param_config.get("type", SegmentType.STRING)
            required = param_config.get("required", False)

            # Check required parameters
            if required and name not in raw_params:
                raise ValueError(f"Required parameter missing: {name}")

            if name in raw_params:
                raw_value = raw_params[name]
                processed[name] = cls._validate_and_convert_value(name, raw_value, param_type, is_form_data)

        # Include unconfigured parameters as strings
        for name, value in raw_params.items():
            if name not in configured_params:
                processed[name] = value

        return processed

    @classmethod
    def _process_body_parameters(
        cls, raw_body: dict[str, Any], body_configs: list, content_type: str
    ) -> dict[str, Any]:
        """Process body parameters based on content type and configuration.

        Args:
            raw_body: Raw body data from request
            body_configs: List of body parameter configuration dictionaries
            content_type: The request content type

        Returns:
            dict[str, Any]: Processed body parameters with validated types

        Raises:
            ValueError: If required body parameters are missing or validation fails
        """
        if content_type in ["text/plain", "application/octet-stream"]:
            # For text/plain and octet-stream, validate required content exists
            if body_configs and any(config.get("required", False) for config in body_configs):
                raw_content = raw_body.get("raw")
                if not raw_content:
                    raise ValueError(f"Required body content missing for {content_type} request")
            return raw_body

        # For structured data (JSON, form-data, etc.)
        processed = {}
        configured_params = {config.get("name", ""): config for config in body_configs}

        for body_config in body_configs:
            name = body_config.get("name", "")
            param_type = body_config.get("type", SegmentType.STRING)
            required = body_config.get("required", False)

            # Handle file parameters for multipart data
            if param_type == SegmentType.FILE and content_type == "multipart/form-data":
                # File validation is handled separately in extract phase
                continue

            # Check required parameters
            if required and name not in raw_body:
                raise ValueError(f"Required body parameter missing: {name}")

            if name in raw_body:
                raw_value = raw_body[name]
                is_form_data = content_type in ["application/x-www-form-urlencoded", "multipart/form-data"]
                processed[name] = cls._validate_and_convert_value(name, raw_value, param_type, is_form_data)

        # Include unconfigured parameters
        for name, value in raw_body.items():
            if name not in configured_params:
                processed[name] = value

        return processed

    @classmethod
    def _validate_and_convert_value(cls, param_name: str, value: Any, param_type: str, is_form_data: bool) -> Any:
        """Unified validation and type conversion for parameter values.

        Args:
            param_name: Name of the parameter for error reporting
            value: The value to validate and convert
            param_type: The expected parameter type (SegmentType)
            is_form_data: Whether the value is from form data (requiring string conversion)

        Returns:
            Any: The validated and converted value

        Raises:
            ValueError: If validation or conversion fails
        """
        try:
            if is_form_data:
                # Form data comes as strings and needs conversion
                return cls._convert_form_value(param_name, value, param_type)
            else:
                # JSON data should already be in correct types, just validate
                return cls._validate_json_value(param_name, value, param_type)
        except Exception as e:
            raise ValueError(f"Parameter '{param_name}' validation failed: {str(e)}")

    @classmethod
    def _convert_form_value(cls, param_name: str, value: str, param_type: str) -> Any:
        """Convert form data string values to specified types.

        Args:
            param_name: Name of the parameter for error reporting
            value: The string value to convert
            param_type: The target type to convert to (SegmentType)

        Returns:
            Any: The converted value in the appropriate type

        Raises:
            ValueError: If the value cannot be converted to the specified type
        """
        if param_type == SegmentType.STRING:
            return value
        elif param_type == SegmentType.NUMBER:
            if not cls._can_convert_to_number(value):
                raise ValueError(f"Cannot convert '{value}' to number")
            numeric_value = float(value)
            return int(numeric_value) if numeric_value.is_integer() else numeric_value
        elif param_type == SegmentType.BOOLEAN:
            lower_value = value.lower()
            bool_map = {"true": True, "false": False, "1": True, "0": False, "yes": True, "no": False}
            if lower_value not in bool_map:
                raise ValueError(f"Cannot convert '{value}' to boolean")
            return bool_map[lower_value]
        else:
            raise ValueError(f"Unsupported type '{param_type}' for form data parameter '{param_name}'")

    @classmethod
    def _validate_json_value(cls, param_name: str, value: Any, param_type: str) -> Any:
        """Validate JSON values against expected types.

        Args:
            param_name: Name of the parameter for error reporting
            value: The value to validate
            param_type: The expected parameter type (SegmentType)

        Returns:
            Any: The validated value (unchanged if valid)

        Raises:
            ValueError: If the value type doesn't match the expected type
        """
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

        validator_info = type_validators.get(SegmentType(param_type))
        if not validator_info:
            logger.warning("Unknown parameter type: %s for parameter %s", param_type, param_name)
            return value

        validator, expected_type = validator_info
        if not validator(value):
            actual_type = type(value).__name__
            raise ValueError(f"Expected {expected_type}, got {actual_type}")

        return value

    @classmethod
    def _validate_required_headers(cls, headers: dict[str, Any], header_configs: list) -> None:
        """Validate required headers are present.

        Args:
            headers: Request headers dictionary
            header_configs: List of header configuration dictionaries

        Raises:
            ValueError: If required headers are missing
        """
        headers_lower = {k.lower(): v for k, v in headers.items()}
        headers_sanitized = {cls._sanitize_key(k).lower(): v for k, v in headers.items()}
        for header_config in header_configs:
            if header_config.get("required", False):
                header_name = header_config.get("name", "")
                sanitized_name = cls._sanitize_key(header_name).lower()
                if header_name.lower() not in headers_lower and sanitized_name not in headers_sanitized:
                    raise ValueError(f"Required header missing: {header_name}")

    @classmethod
    def _validate_http_metadata(cls, webhook_data: dict[str, Any], node_data: dict[str, Any]) -> dict[str, Any]:
        """Validate HTTP method and content-type.

        Args:
            webhook_data: Extracted webhook data containing method and headers
            node_data: Node configuration containing expected method and content-type

        Returns:
            dict[str, Any]: Validation result with 'valid' key and optional 'error' key
        """
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
        """Extract and normalize content-type from headers.

        Args:
            headers: Request headers dictionary

        Returns:
            str: Normalized content-type (main type without parameters)
        """
        content_type = headers.get("Content-Type", "").lower()
        if not content_type:
            content_type = headers.get("content-type", "application/json").lower()
        # Extract the main content type (ignore parameters like boundary)
        return content_type.split(";")[0].strip()

    @classmethod
    def _validation_error(cls, error_message: str) -> dict[str, Any]:
        """Create a standard validation error response.

        Args:
            error_message: The error message to include

        Returns:
            dict[str, Any]: Validation error response with 'valid' and 'error' keys
        """
        return {"valid": False, "error": error_message}

    @classmethod
    def _can_convert_to_number(cls, value: str) -> bool:
        """Check if a string can be converted to a number."""
        try:
            float(value)
            return True
        except ValueError:
            return False

    @classmethod
    def build_workflow_inputs(cls, webhook_data: dict[str, Any]) -> dict[str, Any]:
        """Construct workflow inputs payload from webhook data.

        Args:
            webhook_data: Processed webhook data containing headers, query params, and body

        Returns:
            dict[str, Any]: Workflow inputs formatted for execution
        """
        return {
            "webhook_data": webhook_data,
            "webhook_headers": webhook_data.get("headers", {}),
            "webhook_query_params": webhook_data.get("query_params", {}),
            "webhook_body": webhook_data.get("body", {}),
        }

    @classmethod
    def trigger_workflow_execution(
        cls, webhook_trigger: WorkflowWebhookTrigger, webhook_data: dict[str, Any], workflow: Workflow
    ) -> None:
        """Trigger workflow execution via AsyncWorkflowService.

        Args:
            webhook_trigger: The webhook trigger object
            webhook_data: Processed webhook data for workflow inputs
            workflow: The workflow to execute

        Raises:
            ValueError: If tenant owner is not found
            Exception: If workflow execution fails
        """
        try:
            with Session(db.engine) as session:
                # Prepare inputs for the webhook node
                # The webhook node expects webhook_data in the inputs
                workflow_inputs = cls.build_workflow_inputs(webhook_data)

                # Create trigger data
                trigger_data = WebhookTriggerData(
                    app_id=webhook_trigger.app_id,
                    workflow_id=workflow.id,
                    root_node_id=webhook_trigger.node_id,  # Start from the webhook node
                    inputs=workflow_inputs,
                    tenant_id=webhook_trigger.tenant_id,
                )

                end_user = EndUserService.get_or_create_end_user_by_type(
                    type=InvokeFrom.TRIGGER,
                    tenant_id=webhook_trigger.tenant_id,
                    app_id=webhook_trigger.app_id,
                    user_id=None,
                )

                # consume quota before triggering workflow execution
                try:
                    QuotaType.TRIGGER.consume(webhook_trigger.tenant_id)
                except QuotaExceededError:
                    AppTriggerService.mark_tenant_triggers_rate_limited(webhook_trigger.tenant_id)
                    logger.info(
                        "Tenant %s rate limited, skipping webhook trigger %s",
                        webhook_trigger.tenant_id,
                        webhook_trigger.webhook_id,
                    )
                    raise

                # Trigger workflow execution asynchronously
                AsyncWorkflowService.trigger_workflow_async(
                    session,
                    end_user,
                    trigger_data,
                )

        except Exception:
            logger.exception("Failed to trigger workflow for webhook %s", webhook_trigger.webhook_id)
            raise

    @classmethod
    def generate_webhook_response(cls, node_config: Mapping[str, Any]) -> tuple[dict[str, Any], int]:
        """Generate HTTP response based on node configuration.

        Args:
            node_config: Node configuration containing response settings

        Returns:
            tuple[dict[str, Any], int]: Response data and HTTP status code
        """
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
            if not redis_client.get(f"{cls.__WEBHOOK_NODE_CACHE_KEY__}:{app.id}:{node_id}"):
                not_found_in_cache.append(node_id)
                continue

        lock_key = f"{cls.__WEBHOOK_NODE_CACHE_KEY__}:apps:{app.id}:lock"
        lock = redis_client.lock(lock_key, timeout=10)
        lock_acquired = False

        try:
            # acquire the lock with blocking and timeout
            lock_acquired = lock.acquire(blocking=True, blocking_timeout=10)
            if not lock_acquired:
                logger.warning("Failed to acquire lock for webhook sync, app %s", app.id)
                raise RuntimeError("Failed to acquire lock for webhook trigger synchronization")

            with Session(db.engine) as session:
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
                    session.flush()
                    cache = Cache(record_id=webhook_record.id, node_id=node_id, webhook_id=webhook_record.webhook_id)
                    redis_client.set(
                        f"{cls.__WEBHOOK_NODE_CACHE_KEY__}:{app.id}:{node_id}", cache.model_dump_json(), ex=60 * 60
                    )
                session.commit()

                # delete the nodes not found in the graph
                for node_id in nodes_id_in_db:
                    if node_id not in nodes_id_in_graph:
                        session.delete(nodes_id_in_db[node_id])
                        redis_client.delete(f"{cls.__WEBHOOK_NODE_CACHE_KEY__}:{app.id}:{node_id}")
                session.commit()
        except Exception:
            logger.exception("Failed to sync webhook relationships for app %s", app.id)
            raise
        finally:
            # release the lock only if it was acquired
            if lock_acquired:
                try:
                    lock.release()
                except Exception:
                    logger.exception("Failed to release lock for webhook sync, app %s", app.id)

    @classmethod
    def generate_webhook_id(cls) -> str:
        """
        Generate unique 24-character webhook ID

        Deduplication is not needed, DB already has unique constraint on webhook_id.
        """
        # Generate 24-character random string
        return secrets.token_urlsafe(18)[:24]  # token_urlsafe gives base64url, take first 24 chars
