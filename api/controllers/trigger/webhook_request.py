"""HTTP parsing and response formatting for native webhook triggers."""

import json
import logging
import math
import mimetypes
from collections.abc import Callable, Mapping, Sequence
from typing import Any, NotRequired, TypedDict

import orjson
from flask import Request
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import RequestEntityTooLarge

from configs import dify_config
from core.workflow.nodes.trigger_webhook.entities import (
    ContentType,
    WebhookBodyParameter,
    WebhookData,
    WebhookParameter,
)
from graphon.entities.graph_config import NodeConfigDict
from graphon.file import File
from graphon.variables.types import ArrayValidation, SegmentType
from services.trigger.webhook_service import RawWebhookDataDict, WebhookContext, WebhookFiles
from services.workflow.entities import TriggerActor

try:
    import magic
except ImportError:
    magic = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


class ValidationResultDict(TypedDict):
    valid: bool
    error: NotRequired[str]


class WebhookRequestValidationError(ValueError):
    """Expose only messages intentionally generated for invalid webhook requests."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.public_message = message


class WebhookRequestParser:
    def __init__(
        self,
        *,
        request: Request,
        files: WebhookFiles,
        resolve_actor: Callable[[WebhookContext], TriggerActor] | None = None,
    ) -> None:
        self._request = request
        self._files = files
        self._resolve_actor = resolve_actor
        self.actor: TriggerActor | None = None

    @staticmethod
    def _sanitize_key(key: str) -> str:
        if not isinstance(key, str):
            return key
        return key.replace("-", "_")

    def extract_and_validate_webhook_data(
        self, webhook_trigger: WebhookContext, node_config: NodeConfigDict
    ) -> RawWebhookDataDict:
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
        raw_data = self.extract_webhook_data(webhook_trigger)

        # Validate HTTP metadata (method, content-type)
        node_data = WebhookData.model_validate(node_config["data"], from_attributes=True)
        validation_result = self._validate_http_metadata(raw_data, node_data)
        if not validation_result["valid"]:
            raise WebhookRequestValidationError(validation_result.get("error", "Validation failed"))

        # Process and validate data according to configuration
        processed_data = self._process_and_validate_data(raw_data, node_data)

        return processed_data

    def extract_webhook_data(self, webhook_trigger: WebhookContext) -> RawWebhookDataDict:
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
        self._validate_content_length()

        data: RawWebhookDataDict = {
            "method": self._request.method,
            "headers": dict(self._request.headers),
            "query_params": dict(self._request.args),
            "body": {},
            "files": {},
        }

        # Extract and normalize content type
        content_type = self._extract_content_type(dict(self._request.headers))

        # Route to appropriate extractor based on content type
        extractors: dict[str, Callable[[], tuple[dict[str, Any], dict[str, Any]]]] = {
            "application/json": self._extract_json_body,
            "application/x-www-form-urlencoded": self._extract_form_body,
            "multipart/form-data": lambda: self._extract_multipart_body(webhook_trigger),
            "application/octet-stream": lambda: self._extract_octet_stream_body(webhook_trigger),
            "text/plain": self._extract_text_body,
        }

        extractor = extractors.get(content_type)
        if not extractor:
            # Default to text/plain for unknown content types
            logger.warning("Unknown Content-Type: %s, treating as text/plain", content_type)
            extractor = self._extract_text_body

        # Extract body and files
        body_data, files_data = extractor()
        data["body"] = body_data
        data["files"] = files_data

        return data

    def _process_and_validate_data(self, raw_data: RawWebhookDataDict, node_data: WebhookData) -> RawWebhookDataDict:
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
        self._validate_required_headers(raw_data["headers"], node_data.headers)

        # Process query parameters with type conversion and validation
        result["query_params"] = self._process_parameters(raw_data["query_params"], node_data.params, is_form_data=True)

        # Process body parameters based on content type
        result["body"] = self._process_body_parameters(raw_data["body"], node_data.body, node_data.content_type)

        return result

    def _validate_content_length(self) -> None:
        """Validate request content length against maximum allowed size."""
        content_length = self._request.content_length
        if content_length and content_length > dify_config.WEBHOOK_REQUEST_BODY_MAX_SIZE:
            raise RequestEntityTooLarge(
                f"Webhook request too large: {content_length} bytes exceeds maximum allowed size "
                f"of {dify_config.WEBHOOK_REQUEST_BODY_MAX_SIZE} bytes"
            )

    def _extract_json_body(self) -> tuple[dict[str, Any], dict[str, Any]]:
        """Extract JSON body from self._request.

        Returns:
            tuple: (body_data, files_data) where:
                - body_data: Parsed JSON content
                - files_data: Empty dict (JSON requests don't contain files)

        Raises:
            ValueError: If JSON parsing fails
        """
        raw_body = self._request.get_data(cache=True)
        if not raw_body or raw_body.strip() == b"":
            return {}, {}

        try:
            body = orjson.loads(raw_body)
        except orjson.JSONDecodeError as exc:
            logger.warning("Failed to parse JSON body: %s", exc)
            message = f"{exc.msg}: line {exc.lineno} column {exc.colno} (char {exc.pos})"
            raise WebhookRequestValidationError(f"Invalid JSON body: {message}") from exc
        return body, {}

    def _extract_form_body(self) -> tuple[dict[str, Any], dict[str, Any]]:
        """Extract form-urlencoded body from self._request.

        Returns:
            tuple: (body_data, files_data) where:
                - body_data: Form data as key-value pairs
                - files_data: Empty dict (form-urlencoded requests don't contain files)
        """
        return dict(self._request.form), {}

    def _extract_multipart_body(self, webhook_trigger: WebhookContext) -> tuple[dict[str, Any], dict[str, Any]]:
        """Extract multipart/form-data body and files from self._request.

        Args:
            webhook_trigger: Webhook trigger for file processing context

        Returns:
            tuple: (body_data, files_data) where:
                - body_data: Form data as key-value pairs
                - files_data: Processed file objects indexed by field name
        """
        body = dict(self._request.form)
        files = self._process_file_uploads(self._request.files, webhook_trigger) if self._request.files else {}
        return body, files

    def _extract_octet_stream_body(self, webhook_trigger: WebhookContext) -> tuple[dict[str, Any], dict[str, Any]]:
        """Extract binary data as file from self._request.

        Args:
            webhook_trigger: Webhook trigger for file processing context

        Returns:
            tuple: (body_data, files_data) where:
                - body_data: Dict with 'raw' key containing file object or None
                - files_data: Empty dict
        """
        try:
            file_content = self._request.get_data()
            if file_content:
                mimetype = self._detect_binary_mimetype(file_content)
                file_obj = self._create_file_from_binary(file_content, mimetype, webhook_trigger)
                return {"raw": file_obj.to_dict()}, {}
            else:
                return {"raw": None}, {}
        except Exception:
            logger.exception("Failed to process octet-stream data")
            return {"raw": None}, {}

    def _extract_text_body(self) -> tuple[dict[str, Any], dict[str, Any]]:
        """Extract text/plain body from self._request.

        Returns:
            tuple: (body_data, files_data) where:
                - body_data: Dict with 'raw' key containing text content
                - files_data: Empty dict (text requests don't contain files)
        """
        try:
            body = {"raw": self._request.get_data(as_text=True)}
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

    def _process_file_uploads(
        self, files: Mapping[str, FileStorage], webhook_trigger: WebhookContext
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
                    file_content = file.stream.read()
                    mimetype = file.content_type or mimetypes.guess_type(file.filename)[0] or "application/octet-stream"
                    file_obj = self._create_file_from_binary(file_content, mimetype, webhook_trigger)
                    processed_files[name] = file_obj.to_dict()
                except Exception:
                    logger.exception("Failed to process file upload '%s'", name)
                    # Continue processing other files

        return processed_files

    def _create_file_from_binary(self, file_content: bytes, mimetype: str, webhook_trigger: WebhookContext) -> File:
        if self.actor is None and self._resolve_actor is not None:
            self.actor = self._resolve_actor(webhook_trigger)
        user_id = self.actor.id if self.actor is not None else webhook_trigger.created_by
        return self._files.create(
            tenant_id=webhook_trigger.tenant_id,
            user_id=user_id,
            content=file_content,
            mimetype=mimetype,
        )

    def _process_parameters(
        self,
        raw_params: dict[str, str],
        param_configs: Sequence[WebhookParameter],
        *,
        is_form_data: bool = False,
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
        configured_params = {config.name: config for config in param_configs}

        # Process configured parameters
        for param_config in param_configs:
            name = param_config.name
            param_type = param_config.type
            required = param_config.required

            # Check required parameters
            if required and name not in raw_params:
                raise WebhookRequestValidationError(f"Required parameter missing: {name}")

            if name in raw_params:
                raw_value = raw_params[name]
                processed[name] = self._validate_and_convert_value(name, raw_value, param_type, is_form_data)

        # Include unconfigured parameters as strings
        for name, value in raw_params.items():
            if name not in configured_params:
                processed[name] = value

        return processed

    def _process_body_parameters(
        self,
        raw_body: dict[str, Any],
        body_configs: Sequence[WebhookBodyParameter],
        content_type: ContentType,
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
        match content_type:
            case ContentType.TEXT | ContentType.BINARY:
                # For text/plain and octet-stream, validate required content exists
                if body_configs and any(config.required for config in body_configs):
                    raw_content = raw_body.get("raw")
                    if not raw_content:
                        raise WebhookRequestValidationError(f"Required body content missing for {content_type} request")
                return raw_body
            case _:
                pass

        # For structured data (JSON, form-data, etc.)
        processed = {}
        configured_params: dict[str, WebhookBodyParameter] = {config.name: config for config in body_configs}

        for body_config in body_configs:
            name = body_config.name
            param_type = body_config.type
            required = body_config.required

            # Multipart file validation is handled separately in the extraction phase.
            if not (param_type == SegmentType.FILE and content_type == ContentType.FORM_DATA):
                if required and name not in raw_body:
                    raise WebhookRequestValidationError(f"Required body parameter missing: {name}")

                if name in raw_body:
                    raw_value = raw_body[name]
                    is_form_data = content_type in [ContentType.FORM_URLENCODED, ContentType.FORM_DATA]
                    processed[name] = self._validate_and_convert_value(name, raw_value, param_type, is_form_data)

        # Include unconfigured parameters
        for name, value in raw_body.items():
            if name not in configured_params:
                processed[name] = value

        return processed

    def _validate_and_convert_value(
        self, param_name: str, value: Any, param_type: SegmentType | str, is_form_data: bool
    ) -> Any:
        """Unified validation and type conversion for parameter values.

        Args:
            param_name: Name of the parameter for error reporting
            value: The value to validate and convert
            param_type: The expected parameter type (SegmentType)
            is_form_data: Whether the value is from form data (requiring string conversion)

        Returns:
            Any: The validated and converted value

        Raises:
            ValueError: If validation or conversion fails. The original validation
                error is preserved as ``__cause__`` for debugging.
        """
        try:
            if is_form_data:
                # Form data comes as strings and needs conversion
                return self._convert_form_value(param_name, value, param_type)
            else:
                # JSON data should already be in correct types, just validate
                return self._validate_json_value(param_name, value, param_type)
        except WebhookRequestValidationError as error:
            raise WebhookRequestValidationError(
                f"Parameter '{param_name}' validation failed: {error.public_message}"
            ) from error

    def _convert_form_value(self, param_name: str, value: str, param_type: SegmentType | str) -> Any:
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
        match param_type:
            case SegmentType.STRING:
                return value
            case SegmentType.NUMBER:
                if not self._can_convert_to_number(value):
                    raise WebhookRequestValidationError(f"Cannot convert '{value}' to number")
                try:
                    # Parse integers exactly before float conversion can round them.
                    return int(value)
                except ValueError:
                    pass
                numeric_value = float(value)
                return int(numeric_value) if numeric_value.is_integer() else numeric_value
            case SegmentType.BOOLEAN:
                lower_value = value.lower()
                bool_map = {"true": True, "false": False, "1": True, "0": False, "yes": True, "no": False}
                if lower_value not in bool_map:
                    raise WebhookRequestValidationError(f"Cannot convert '{value}' to boolean")
                return bool_map[lower_value]
            case (
                SegmentType.OBJECT
                | SegmentType.FILE
                | SegmentType.ARRAY_ANY
                | SegmentType.ARRAY_STRING
                | SegmentType.ARRAY_NUMBER
                | SegmentType.ARRAY_OBJECT
                | SegmentType.ARRAY_FILE
                | SegmentType.ARRAY_BOOLEAN
                | SegmentType.SECRET
                | SegmentType.INTEGER
                | SegmentType.FLOAT
                | SegmentType.NONE
                | SegmentType.GROUP
            ):
                raise WebhookRequestValidationError(
                    f"Unsupported type '{param_type}' for form data parameter '{param_name}'"
                )
            case _:
                raise WebhookRequestValidationError(
                    f"Unsupported type '{param_type}' for form data parameter '{param_name}'"
                )

    def _validate_json_value(self, param_name: str, value: Any, param_type: SegmentType | str) -> Any:
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
        param_type_enum = self._coerce_segment_type(param_type, param_name=param_name)
        if param_type_enum is None:
            return value

        if not param_type_enum.is_valid(value, array_validation=ArrayValidation.ALL) or self._is_boolean_for_number(
            value, param_type_enum
        ):
            actual_type = type(value).__name__
            expected_type = self._expected_type_label(param_type_enum)
            raise WebhookRequestValidationError(f"Expected {expected_type}, got {actual_type}")

        return value

    @staticmethod
    def _is_boolean_for_number(value: Any, param_type: SegmentType) -> bool:
        match param_type:
            case SegmentType.NUMBER | SegmentType.INTEGER | SegmentType.FLOAT:
                return isinstance(value, bool)
            case SegmentType.ARRAY_NUMBER:
                return isinstance(value, list) and any(isinstance(item, bool) for item in value)
            case _:
                return False

    def _coerce_segment_type(self, param_type: SegmentType | str, *, param_name: str) -> SegmentType | None:
        if isinstance(param_type, SegmentType):
            return param_type
        try:
            return SegmentType(param_type)
        except Exception:
            logger.warning("Unknown parameter type: %s for parameter %s", param_type, param_name)
            return None

    @staticmethod
    def _expected_type_label(param_type: SegmentType) -> str:
        match param_type:
            case SegmentType.ARRAY_STRING:
                return "array of strings"
            case SegmentType.ARRAY_NUMBER:
                return "array of numbers"
            case SegmentType.ARRAY_BOOLEAN:
                return "array of booleans"
            case SegmentType.ARRAY_OBJECT:
                return "array of objects"
            case _:
                return param_type.value

    def _validate_required_headers(self, headers: dict[str, Any], header_configs: Sequence[WebhookParameter]) -> None:
        """Validate required headers are present.

        Args:
            headers: Request headers dictionary
            header_configs: List of header configuration dictionaries

        Raises:
            ValueError: If required headers are missing
        """
        headers_lower = {k.lower(): v for k, v in headers.items()}
        headers_sanitized = {self._sanitize_key(k).lower(): v for k, v in headers.items()}
        for header_config in header_configs:
            if header_config.required:
                header_name = header_config.name
                sanitized_name = self._sanitize_key(header_name).lower()
                if header_name.lower() not in headers_lower and sanitized_name not in headers_sanitized:
                    raise WebhookRequestValidationError(f"Required header missing: {header_name}")

    def _validate_http_metadata(self, webhook_data: RawWebhookDataDict, node_data: WebhookData) -> ValidationResultDict:
        """Validate HTTP method and content-type.

        Args:
            webhook_data: Extracted webhook data containing method and headers
            node_data: Node configuration containing expected method and content-type

        Returns:
            dict[str, Any]: Validation result with 'valid' key and optional 'error' key
        """
        # Validate HTTP method
        configured_method = node_data.method.value.upper()
        request_method = webhook_data["method"].upper()
        if configured_method != request_method:
            return self._validation_error(f"HTTP method mismatch. Expected {configured_method}, got {request_method}")

        # Validate Content-type
        configured_content_type = node_data.content_type.value.lower()
        request_content_type = self._extract_content_type(webhook_data["headers"])

        if configured_content_type != request_content_type:
            return self._validation_error(
                f"Content-type mismatch. Expected {configured_content_type}, got {request_content_type}"
            )

        return {"valid": True}

    def _extract_content_type(self, headers: dict[str, Any]) -> str:
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

    def _validation_error(self, error_message: str) -> ValidationResultDict:
        """Create a standard validation error response.

        Args:
            error_message: The error message to include

        Returns:
            dict[str, Any]: Validation error response with 'valid' and 'error' keys
        """
        return {"valid": False, "error": error_message}

    def _can_convert_to_number(self, value: str) -> bool:
        """Check if a string can be converted to a finite number."""
        try:
            return math.isfinite(float(value))
        except ValueError:
            return False

    def generate_webhook_response(self, node_config: NodeConfigDict) -> tuple[Any, int]:
        """Generate HTTP response based on node configuration.

        Args:
            node_config: Node configuration containing response settings

        Returns:
            tuple[dict[str, Any], int]: Response data and HTTP status code
        """
        node_data = WebhookData.model_validate(node_config["data"], from_attributes=True)

        # Get configured status code and response body
        status_code = node_data.status_code
        response_body = node_data.response_body

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
        except Exception:
            response_data = {"message": response_body or "Webhook processed successfully"}

        return response_data, status_code
