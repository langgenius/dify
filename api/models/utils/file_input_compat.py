from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, cast

from core.workflow.file_reference import parse_file_reference
from dify_graph.file import File, FileTransferMethod


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
    boundary, instead of pushing tenant data back into `dify_graph.file.File`.
    """

    # NOTE: It's not the best way to implement this, but it's the only way to avoid circular import for now.
    from factories import file_factory

    mapping = dict(file_mapping)
    record_id = resolve_file_record_id(mapping)

    if mapping["transfer_method"] == FileTransferMethod.TOOL_FILE:
        mapping["tool_file_id"] = record_id
    elif mapping["transfer_method"] in [FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL]:
        mapping["upload_file_id"] = record_id

    tenant_id = resolve_file_mapping_tenant_id(file_mapping=mapping, tenant_resolver=tenant_resolver)
    return cast(File, file_factory.build_from_mapping(mapping=mapping, tenant_id=tenant_id))
