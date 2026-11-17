import logging
from collections.abc import Callable, Hashable, Mapping, Sequence
from typing import Any, Final, NotRequired, TypeGuard, override

from pydantic import JsonValue
from typing_extensions import TypedDict

from constants.trigger import TRIGGER_WEBHOOK_NODE_TYPE
from core.workflow.file_reference import resolve_file_record_id
from core.workflow.variable_prefixes import SYSTEM_VARIABLE_NODE_ID
from factories.variable_factory import build_segment_with_type
from graphon.enums import NodeExecutionType, WorkflowNodeExecutionStatus
from graphon.file import FileTransferMethod
from graphon.node_events import NodeRunResult
from graphon.nodes.base.node import Node
from graphon.nodes.protocols import FileReferenceFactoryProtocol
from graphon.variables.types import SegmentType
from graphon.variables.variables import FileVariable

from .entities import ContentType, Method, WebhookBodyParameter, WebhookData, WebhookParameter

logger = logging.getLogger(__name__)


class WebhookNodeConfig(TypedDict):
    """Shape of the ``config`` payload of :meth:`TriggerWebhookNode.get_default_config`."""

    method: str
    content_type: str
    headers: list[WebhookParameter]
    params: list[WebhookParameter]
    body: list[WebhookBodyParameter]
    async_mode: bool
    status_code: int
    response_body: str
    timeout: int


class WebhookNodeDefaultConfig(TypedDict):
    """Default configuration returned by :meth:`TriggerWebhookNode.get_default_config`."""

    type: str
    config: WebhookNodeConfig


type WebhookFileValue = str | int | None


class WebhookFileDict(TypedDict, extra_items=WebhookFileValue):
    """One webhook upload file entry, as produced by ``File.to_dict`` and consumed by the node.

    The webhook payload crosses an external boundary, so :func:`parse_webhook_file` parses it into
    this shape once. Every consumer below reads the declared fields directly and never re-checks
    their types. Field values keep the width of ``File.to_dict`` (JSON scalars); unknown scalars
    remain allowed through ``extra_items``.
    """

    id: NotRequired[str]
    type: NotRequired[str]
    transfer_method: NotRequired[str]
    reference: NotRequired[str]
    related_id: NotRequired[str]
    upload_file_id: NotRequired[str | None]
    tool_file_id: NotRequired[str | None]
    datasource_file_id: NotRequired[str | None]
    filename: NotRequired[str]
    extension: NotRequired[str]
    mime_type: NotRequired[str]
    url: NotRequired[str]
    size: NotRequired[int]


type WebhookFilePayload = Mapping[Hashable, JsonValue]
"""The only shape :func:`parse_webhook_file` accepts as an already-mapping payload."""


def _is_webhook_file_value(value: JsonValue, field: str) -> TypeGuard[WebhookFileValue]:
    """Return whether ``value`` matches the type :class:`WebhookFileDict` declares for ``field``.

    Declared fields only pass through in their declared type, which is what lets every consumer
    read them without re-checking. Unknown fields keep the width of ``File.to_dict`` (a JSON
    scalar) so they can still travel through ``extra_items``.
    """
    kind = _WEBHOOK_FILE_FIELD_KINDS.get(field)
    if kind is not None:
        return kind(value)
    return _is_json_scalar(value)


def _is_str(value: JsonValue) -> TypeGuard[str]:
    return isinstance(value, str)


def _is_optional_str(value: JsonValue) -> TypeGuard[str | None]:
    return value is None or isinstance(value, str)


def _is_int(value: JsonValue) -> TypeGuard[int]:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_json_scalar(value: JsonValue) -> TypeGuard[WebhookFileValue]:
    return value is None or _is_str(value) or _is_int(value)


_WEBHOOK_FILE_FIELD_KINDS: Final[dict[str, Callable[[JsonValue], TypeGuard[WebhookFileValue]]]] = {
    "id": _is_str,
    "type": _is_str,
    "transfer_method": _is_str,
    "reference": _is_str,
    "related_id": _is_str,
    "upload_file_id": _is_optional_str,
    "tool_file_id": _is_optional_str,
    "datasource_file_id": _is_optional_str,
    "filename": _is_str,
    "extension": _is_str,
    "mime_type": _is_str,
    "url": _is_str,
    "size": _is_int,
}


def _parse_webhook_file_fields(raw: WebhookFilePayload) -> WebhookFileDict | None:
    """Parse the fields of one raw webhook file mapping into the declared :class:`WebhookFileDict` shape.

    Preconditions: ``raw`` is a mapping reached from the untrusted webhook inputs.
    Postconditions: returns every field whose value matches the type declared for that field,
    plus any unknown string-keyed JSON scalar, as a ``WebhookFileDict``; returns ``None`` when no
    entry survives. ``raw`` is never mutated, so the parsed result is the only trusted view of the
    payload.
    """
    parsed: WebhookFileDict = {}
    kept: list[tuple[str, WebhookFileValue]] = []
    for key, value in raw.items():
        if isinstance(key, str) and _is_webhook_file_value(value, key):
            kept.append((key, value))
    parsed.update(kept)
    return parsed or None


def parse_webhook_file(raw: WebhookFilePayload | Sequence[JsonValue] | None) -> WebhookFileDict | None:
    """Parse one external webhook file entry into :class:`WebhookFileDict`.

    Preconditions: ``raw`` is any value reached from the untrusted webhook inputs. This is the only
    place webhook file shapes are parsed; callers consume the returned typed payload directly.
    Postconditions: returns the fields of ``raw`` that match their declared type (plus unknown
    JSON scalars) as a ``WebhookFileDict`` when at least one survives, and ``None`` otherwise.
    ``raw`` is never mutated.
    """
    if not isinstance(raw, Mapping):
        return None
    return _parse_webhook_file_fields(raw)


def _webhook_file_record_id(file: WebhookFileDict) -> str | None:
    """Return the file reference id carried by ``file``, if any.

    Preconditions: ``file`` is a parsed webhook file entry; its fields were validated once by
    :func:`parse_webhook_file`, so no field is re-validated here.
    Postconditions: returns the first non-empty string among ``reference`` and ``related_id``,
    or ``None`` when neither carries one.
    """
    reference = file.get("reference")
    if reference:
        return reference
    related_id = file.get("related_id")
    if related_id:
        return related_id
    return None


class TriggerWebhookNode(Node[WebhookData]):
    node_type = TRIGGER_WEBHOOK_NODE_TYPE
    execution_type = NodeExecutionType.ROOT

    _file_reference_factory: FileReferenceFactoryProtocol

    @override
    def post_init(self) -> None:
        from core.workflow.node_runtime import DifyFileReferenceFactory

        self._file_reference_factory = DifyFileReferenceFactory(self.run_context)

    @classmethod
    @override
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> WebhookNodeDefaultConfig:
        """Return the default configuration of the webhook trigger node.

        Preconditions:
            ``filters`` is accepted for API parity with
            :meth:`graphon.nodes.base.node.Node.get_default_config` and is not used.

        Postconditions:
            The returned mapping always carries ``type`` and a fully populated
            ``config`` mapping; a fresh instance is returned on every call, so
            callers may mutate the result without affecting later calls.
        """
        return {
            "type": "webhook",
            "config": {
                "method": Method.GET.value,
                "content_type": ContentType.JSON.value,
                "headers": [],
                "params": [],
                "body": [],
                "async_mode": True,
                "status_code": 200,
                "response_body": "",
                "timeout": 30,
            },
        }

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(self) -> NodeRunResult:
        """
        Run the webhook node.

        Like the start node, this simply takes the webhook data from the variable pool
        and makes it available to downstream nodes. The actual webhook handling
        happens in the trigger controller.
        """
        # Get webhook data from variable pool (injected by Celery task)
        webhook_inputs = dict(self.runtime_state.variable_pool.get_by_prefix(self.id))

        # Extract webhook-specific outputs based on node configuration
        outputs = self._extract_configured_outputs(webhook_inputs)
        system_inputs = self.runtime_state.variable_pool.get_by_prefix(SYSTEM_VARIABLE_NODE_ID)

        for variable_name, value in system_inputs.items():
            outputs[f"{SYSTEM_VARIABLE_NODE_ID}.{variable_name}"] = value
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=webhook_inputs,
            outputs=outputs,
        )

    def generate_file_var(self, param_name: str, file: WebhookFileDict) -> FileVariable | None:
        """Build the ``FileVariable`` output for one webhook file parameter.

        Preconditions: ``file`` is a parsed webhook file entry; its fields were validated once by
        :func:`parse_webhook_file`, so they are consumed directly without re-validation.
        Postconditions: returns the file variable when the entry can be resolved into a stored file,
        and ``None`` otherwise. ``file`` is annotated in place with the transfer-method-specific id.
        """
        file_id = resolve_file_record_id(_webhook_file_record_id(file))
        transfer_method_value = file.get("transfer_method")
        if transfer_method_value:
            transfer_method = FileTransferMethod.value_of(transfer_method_value)
            match transfer_method:
                case FileTransferMethod.LOCAL_FILE | FileTransferMethod.REMOTE_URL:
                    file["upload_file_id"] = file_id
                case FileTransferMethod.TOOL_FILE:
                    file["tool_file_id"] = file_id
                case FileTransferMethod.DATASOURCE_FILE:
                    file["datasource_file_id"] = file_id

            try:
                file_obj = self._file_reference_factory.build_from_mapping(mapping=file)
                file_segment = build_segment_with_type(SegmentType.FILE, file_obj)
                return FileVariable(name=param_name, value=file_segment.value, selector=[self.id, param_name])
            except ValueError:
                logger.error(
                    "Failed to build FileVariable for webhook file parameter %s",
                    param_name,
                    exc_info=True,
                )
        return None

    def _extract_configured_outputs(self, webhook_inputs: dict[str, Any]) -> dict[str, Any]:
        """Extract outputs based on node configuration from webhook inputs."""
        outputs = {}

        # Get the raw webhook data (should be injected by Celery task)
        webhook_data = webhook_inputs.get("webhook_data", {})

        def _to_sanitized(name: str) -> str:
            return name.replace("-", "_")

        def _get_normalized(mapping: dict[str, Any], key: str) -> Any:
            if not isinstance(mapping, dict):
                return None
            if key in mapping:
                return mapping[key]
            alternate = key.replace("-", "_") if "-" in key else key.replace("_", "-")
            if alternate in mapping:
                return mapping[alternate]
            return None

        # Extract configured headers (case-insensitive)
        webhook_headers = webhook_data.get("headers", {})
        webhook_headers_lower = {k.lower(): v for k, v in webhook_headers.items()}

        for header in self.node_data.headers:
            header_name = header.name
            value = _get_normalized(webhook_headers, header_name)
            if value is None:
                value = _get_normalized(webhook_headers_lower, header_name.lower())
            sanitized_name = _to_sanitized(header_name)
            outputs[sanitized_name] = value

        # Extract configured query parameters
        for param in self.node_data.params:
            param_name = param.name
            outputs[param_name] = webhook_data.get("query_params", {}).get(param_name)

        # Extract configured body parameters
        for body_param in self.node_data.body:
            param_name = body_param.name
            param_type = body_param.type

            if self.node_data.content_type == ContentType.TEXT:
                # For text/plain, the entire body is a single string parameter
                outputs[param_name] = str(webhook_data.get("body", {}).get("raw", ""))
                continue
            elif self.node_data.content_type == ContentType.BINARY:
                # Binary uploads arrive as a single ``File.to_dict()`` payload under ``raw``.
                # The raw value crosses the webhook boundary untyped; parse it once and consume
                # the typed result, keeping the raw payload as the fallback output.
                raw_data = webhook_data.get("body", {}).get("raw", {})
                parsed_file = parse_webhook_file(raw_data)
                file_var = self.generate_file_var(param_name, parsed_file) if parsed_file else None
                if file_var:
                    outputs[param_name] = file_var
                else:
                    outputs[param_name] = raw_data
                continue

            match param_type:
                case SegmentType.FILE:
                    # Get File object (already processed by webhook controller)
                    files = webhook_data.get("files", {})
                    if files and isinstance(files, dict):
                        file = files.get(param_name)
                        parsed_file = parse_webhook_file(file)
                        file_var = self.generate_file_var(param_name, parsed_file) if parsed_file else None
                        if file_var:
                            outputs[param_name] = file_var
                        else:
                            outputs[param_name] = files
                    else:
                        outputs[param_name] = files
                case _:
                    # Get regular body parameter
                    outputs[param_name] = webhook_data.get("body", {}).get(param_name)

        # Include raw webhook data for debugging/advanced use
        outputs["_webhook_raw"] = webhook_data
        return outputs
