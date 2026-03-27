from __future__ import annotations

from collections.abc import Callable, Mapping
from functools import lru_cache
from typing import Any

from graphon.file import File, FileTransferMethod

from core.workflow.file_reference import parse_file_reference


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

    if transfer_method == FileTransferMethod.TOOL_FILE and record_id:
        mapping["tool_file_id"] = record_id
    elif transfer_method in [FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL] and record_id:
        mapping["upload_file_id"] = record_id
    elif transfer_method == FileTransferMethod.DATASOURCE_FILE and record_id:
        mapping["datasource_file_id"] = record_id

    if transfer_method == FileTransferMethod.REMOTE_URL and record_id is None:
        remote_url = mapping.get("remote_url")
        if not isinstance(remote_url, str) or not remote_url:
            url = mapping.get("url")
            if isinstance(url, str) and url:
                mapping["remote_url"] = url
        return File.model_validate(mapping)

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
