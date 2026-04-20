from __future__ import annotations

from collections.abc import Callable, Mapping
from functools import lru_cache
from typing import Any

from core.workflow.file_reference import parse_file_reference
from graphon.file import File, FileTransferMethod, FileType
from graphon.file.constants import FILE_MODEL_IDENTITY, maybe_file_object


@lru_cache(maxsize=1)
def _get_file_access_controller():
    from core.app.file_access import DatabaseFileAccessController

    return DatabaseFileAccessController()


def resolve_file_record_id(file_mapping: Mapping[str, Any]) -> str | None:
    reference = file_mapping.get("reference")
    if isinstance(reference, str) and reference:
        parsed_reference = parse_file_reference(reference)
        if parsed_reference is not None:
            return parsed_reference.record_id

    related_id = file_mapping.get("related_id")
    if isinstance(related_id, str) and related_id:
        parsed_reference = parse_file_reference(related_id)
        if parsed_reference is not None:
            return parsed_reference.record_id

    return None


def resolve_file_mapping_tenant_id(
    *,
    file_mapping: Mapping[str, Any],
    tenant_resolver: Callable[[], str],
) -> str:
    tenant_id = file_mapping.get("tenant_id")
    if isinstance(tenant_id, str) and tenant_id:
        return tenant_id

    return tenant_resolver()


def build_file_from_mapping_without_lookup(*, file_mapping: Mapping[str, Any]) -> File:
    """Build a graph `File` directly from serialized metadata."""

    def _coerce_file_type(value: Any) -> FileType:
        if isinstance(value, FileType):
            return value
        if isinstance(value, str):
            return FileType.value_of(value)
        raise ValueError("file type is required in file mapping")

    mapping = dict(file_mapping)
    transfer_method_value = mapping.get("transfer_method")
    if isinstance(transfer_method_value, FileTransferMethod):
        transfer_method = transfer_method_value
    elif isinstance(transfer_method_value, str):
        transfer_method = FileTransferMethod.value_of(transfer_method_value)
    else:
        raise ValueError("transfer_method is required in file mapping")

    file_id = mapping.get("file_id")
    if not isinstance(file_id, str) or not file_id:
        legacy_id = mapping.get("id")
        file_id = legacy_id if isinstance(legacy_id, str) and legacy_id else None

    related_id = resolve_file_record_id(mapping)
    if related_id is None:
        raw_related_id = mapping.get("related_id")
        related_id = raw_related_id if isinstance(raw_related_id, str) and raw_related_id else None

    remote_url = mapping.get("remote_url")
    if not isinstance(remote_url, str) or not remote_url:
        url = mapping.get("url")
        remote_url = url if isinstance(url, str) and url else None

    reference = mapping.get("reference")
    if not isinstance(reference, str) or not reference:
        reference = None

    filename = mapping.get("filename")
    if not isinstance(filename, str):
        filename = None

    extension = mapping.get("extension")
    if not isinstance(extension, str):
        extension = None

    mime_type = mapping.get("mime_type")
    if not isinstance(mime_type, str):
        mime_type = None

    size = mapping.get("size", -1)
    if not isinstance(size, int):
        size = -1

    storage_key = mapping.get("storage_key")
    if not isinstance(storage_key, str):
        storage_key = None

    tenant_id = mapping.get("tenant_id")
    if not isinstance(tenant_id, str):
        tenant_id = None

    dify_model_identity = mapping.get("dify_model_identity")
    if not isinstance(dify_model_identity, str):
        dify_model_identity = FILE_MODEL_IDENTITY

    tool_file_id = mapping.get("tool_file_id")
    if not isinstance(tool_file_id, str):
        tool_file_id = None

    upload_file_id = mapping.get("upload_file_id")
    if not isinstance(upload_file_id, str):
        upload_file_id = None

    datasource_file_id = mapping.get("datasource_file_id")
    if not isinstance(datasource_file_id, str):
        datasource_file_id = None

    return File(
        file_id=file_id,
        tenant_id=tenant_id,
        file_type=_coerce_file_type(mapping.get("file_type", mapping.get("type"))),
        transfer_method=transfer_method,
        remote_url=remote_url,
        reference=reference,
        related_id=related_id,
        filename=filename,
        extension=extension,
        mime_type=mime_type,
        size=size,
        storage_key=storage_key,
        dify_model_identity=dify_model_identity,
        url=remote_url,
        tool_file_id=tool_file_id,
        upload_file_id=upload_file_id,
        datasource_file_id=datasource_file_id,
    )


def rebuild_serialized_graph_files_without_lookup(value: Any) -> Any:
    """Recursively rebuild serialized graph file payloads into `File` objects.

    `graphon` 0.2.2 no longer accepts legacy serialized file mappings via
    `model_validate_json()`. Dify keeps this recovery path at the model boundary
    so historical JSON blobs remain readable without reintroducing global graph
    patches or test-local coercion.
    """
    if isinstance(value, list):
        return [rebuild_serialized_graph_files_without_lookup(item) for item in value]

    if isinstance(value, dict):
        if maybe_file_object(value):
            return build_file_from_mapping_without_lookup(file_mapping=value)
        return {key: rebuild_serialized_graph_files_without_lookup(item) for key, item in value.items()}

    return value


def build_file_from_stored_mapping(
    *,
    file_mapping: Mapping[str, Any],
    tenant_id: str,
) -> File:
    """
    Canonicalize a persisted file payload against the current tenant context.

    Stored JSON rows can outlive file schema changes, so rebuild storage-backed
    files through the workflow factory instead of trusting serialized metadata.
    Pure external ``REMOTE_URL`` payloads without a backing upload row are
    passed through because there is no server-owned record to rebind.
    """

    # NOTE: It's not the best way to implement this, but it's the only way to avoid circular import for now.
    from factories import file_factory

    mapping = dict(file_mapping)
    mapping.pop("tenant_id", None)
    record_id = resolve_file_record_id(mapping)
    transfer_method = FileTransferMethod.value_of(mapping["transfer_method"])

    match transfer_method:
        case FileTransferMethod.TOOL_FILE if record_id:
            mapping["tool_file_id"] = record_id
        case FileTransferMethod.LOCAL_FILE | FileTransferMethod.REMOTE_URL if record_id:
            mapping["upload_file_id"] = record_id
        case FileTransferMethod.DATASOURCE_FILE if record_id:
            mapping["datasource_file_id"] = record_id
        case _:
            pass

    if transfer_method == FileTransferMethod.REMOTE_URL and record_id is None:
        return build_file_from_mapping_without_lookup(file_mapping=mapping)

    return file_factory.build_from_mapping(
        mapping=mapping,
        tenant_id=tenant_id,
        access_controller=_get_file_access_controller(),
    )


def build_file_from_input_mapping(
    *,
    file_mapping: Mapping[str, Any],
    tenant_resolver: Callable[[], str],
) -> File:
    """
    Rehydrate persisted model input payloads into graph `File` objects.

    This compatibility layer exists because model JSON rows can outlive file payload
    schema changes. Legacy rows may carry `related_id` and `tenant_id`, while newer
    rows may only carry `reference`. Keep ownership resolution here, at the model
    boundary, instead of pushing tenant data back into `graphon.file.File`.
    """

    transfer_method = FileTransferMethod.value_of(file_mapping["transfer_method"])
    record_id = resolve_file_record_id(file_mapping)
    if transfer_method == FileTransferMethod.REMOTE_URL and record_id is None:
        return build_file_from_stored_mapping(
            file_mapping=file_mapping,
            tenant_id="",
        )

    tenant_id = resolve_file_mapping_tenant_id(file_mapping=file_mapping, tenant_resolver=tenant_resolver)
    return build_file_from_stored_mapping(
        file_mapping=file_mapping,
        tenant_id=tenant_id,
    )
