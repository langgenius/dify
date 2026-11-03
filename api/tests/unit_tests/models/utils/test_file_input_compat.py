from unittest.mock import MagicMock

import pytest
from pydantic import JsonValue

from graphon.file import File, FileTransferMethod, FileType
from models.utils.file_input_compat import (
    build_file_from_mapping_without_lookup,
    build_file_from_stored_mapping,
    rebuild_serialized_graph_files_without_lookup,
    resolve_file_mapping_tenant_id,
    restore_input_files,
)


def test_build_file_from_mapping_without_lookup_accepts_legacy_payload() -> None:
    file = build_file_from_mapping_without_lookup(
        file_mapping={
            "id": "test-file",
            "tenant_id": "test-tenant-id",
            "type": "image",
            "transfer_method": "tool_file",
            "related_id": "test-related-id",
            "filename": "image.png",
            "extension": ".png",
            "mime_type": "image/png",
            "size": 67,
            "storage_key": "test-storage-key",
            "url": "https://example.com/image.png",
            "tool_file_id": "tool-file-123",
            "upload_file_id": "upload-file-456",
            "datasource_file_id": "datasource-file-789",
        }
    )

    assert file.related_id == "test-related-id"
    assert file.storage_key == "test-storage-key"
    assert file.type == FileType.IMAGE


@pytest.mark.parametrize(
    ("file_mapping", "expected_message"),
    [
        (
            {
                "id": "test-file",
                "transfer_method": "local_file",
            },
            "file type is required in file mapping",
        ),
        (
            {
                "id": "test-file",
                "type": "image",
            },
            "transfer_method is required in file mapping",
        ),
    ],
)
def test_build_file_from_mapping_without_lookup_requires_required_fields(
    file_mapping: dict[str, object],
    expected_message: str,
) -> None:
    with pytest.raises(ValueError, match=expected_message):
        build_file_from_mapping_without_lookup(file_mapping=file_mapping)


def test_build_file_from_mapping_without_lookup_normalizes_invalid_metadata_types() -> None:
    file = build_file_from_mapping_without_lookup(
        file_mapping={
            "id": "test-file",
            "type": "image",
            "transfer_method": "local_file",
            "reference": "upload-file-1",
            "filename": 123,
            "size": "large",
        }
    )

    assert file.filename is None
    assert file.size == -1


def test_build_file_from_mapping_without_lookup_accepts_enum_inputs() -> None:
    file = build_file_from_mapping_without_lookup(
        file_mapping={
            "id": "test-file",
            "type": FileType.IMAGE,
            "transfer_method": FileTransferMethod.REMOTE_URL,
            "url": "https://example.com/image.png",
        }
    )

    assert file.type == FileType.IMAGE
    assert file.transfer_method == FileTransferMethod.REMOTE_URL


def test_rebuild_serialized_graph_files_without_lookup_rehydrates_nested_files() -> None:
    rebuilt = rebuild_serialized_graph_files_without_lookup(
        {
            "file": {
                "dify_model_identity": "__dify__file__",
                "id": "test-file",
                "type": "document",
                "transfer_method": "local_file",
                "reference": "upload-file-123",
                "filename": "doc.txt",
            },
            "items": [
                {
                    "dify_model_identity": "__dify__file__",
                    "type": "image",
                    "transfer_method": "remote_url",
                    "url": "https://example.com/image.png",
                    "filename": "image.png",
                }
            ],
        }
    )

    assert isinstance(rebuilt["file"], File)
    assert rebuilt["file"].related_id == "upload-file-123"
    assert isinstance(rebuilt["items"][0], File)
    assert rebuilt["items"][0].transfer_method == FileTransferMethod.REMOTE_URL


def test_rebuild_serialized_graph_files_without_lookup_preserves_scalar_values() -> None:
    assert rebuild_serialized_graph_files_without_lookup("plain-text") == "plain-text"


def test_build_file_from_stored_mapping_rebuilds_remote_urls_without_record_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rebuilt_file = File(
        file_type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/image.png",
        filename="image.png",
    )
    build_without_lookup = MagicMock(return_value=rebuilt_file)
    monkeypatch.setattr("models.utils.file_input_compat.build_file_from_mapping_without_lookup", build_without_lookup)

    result = build_file_from_stored_mapping(
        file_mapping={
            "type": "image",
            "transfer_method": "remote_url",
            "url": "https://example.com/image.png",
            "filename": "image.png",
        },
        tenant_id="tenant-1",
    )

    build_without_lookup.assert_called_once()
    assert result is rebuilt_file


def _unexpected_tenant_lookup() -> str:
    raise AssertionError("These file inputs must not resolve the app tenant")


def _remote_file_mapping() -> dict[str, JsonValue]:
    return {
        "dify_model_identity": "__dify__file__",
        "type": "image",
        "transfer_method": "remote_url",
        "url": "https://example.com/image.png",
        "filename": "image.png",
    }


def test_restore_input_files_rebuilds_single_file_and_file_list_without_tenant_lookup() -> None:
    mapping = _remote_file_mapping()
    inputs: dict[str, JsonValue | File | list[File]] = {"file": mapping, "files": [mapping]}

    restored = restore_input_files(inputs=inputs, tenant_resolver=_unexpected_tenant_lookup)

    file = restored["file"]
    assert isinstance(file, File)
    assert file.remote_url == "https://example.com/image.png"
    files = restored["files"]
    assert isinstance(files, list)
    assert len(files) == 1
    assert isinstance(files[0], File)
    assert files[0].model_dump() == file.model_dump()
    assert inputs == {"file": mapping, "files": [mapping]}
    assert restored is not inputs


def test_restore_input_files_preserves_mixed_lists_nested_mappings_and_scalar_values() -> None:
    mapping = _remote_file_mapping()
    inputs: dict[str, JsonValue | File | list[File]] = {
        "mixed": [mapping, "ordinary-value"],
        "nested": {"file": mapping},
        "empty": [],
        "null": None,
        "zero": 0,
        "false": False,
        "string": "",
    }

    restored = restore_input_files(inputs=inputs, tenant_resolver=_unexpected_tenant_lookup)

    assert restored == inputs
    assert restored["mixed"] is inputs["mixed"]
    assert restored["nested"] is inputs["nested"]


def test_restore_input_files_preserves_existing_file_objects() -> None:
    file = build_file_from_mapping_without_lookup(file_mapping=_remote_file_mapping())
    files = [file]

    restored = restore_input_files(
        inputs={"file": file, "files": files},
        tenant_resolver=_unexpected_tenant_lookup,
    )

    assert restored["file"] is file
    assert restored["files"] is files


def test_restore_input_files_propagates_missing_owner_for_storage_backed_files() -> None:
    def resolve_missing_tenant() -> str:
        raise ValueError("Unable to resolve tenant_id for app app-1")

    with pytest.raises(ValueError, match="Unable to resolve tenant_id for app app-1"):
        restore_input_files(
            inputs={
                "file": {
                    "dify_model_identity": "__dify__file__",
                    "type": "document",
                    "transfer_method": "local_file",
                    "related_id": "upload-file-id",
                }
            },
            tenant_resolver=resolve_missing_tenant,
        )


def test_resolve_file_mapping_tenant_id_preserves_legacy_serialized_owner() -> None:
    assert (
        resolve_file_mapping_tenant_id(
            file_mapping={"tenant_id": "serialized-tenant"},
            tenant_resolver=_unexpected_tenant_lookup,
        )
        == "serialized-tenant"
    )


@pytest.mark.parametrize("tenant_id", [None, "", 42])
def test_resolve_file_mapping_tenant_id_falls_back_for_missing_or_invalid_owner(tenant_id: JsonValue) -> None:
    assert (
        resolve_file_mapping_tenant_id(
            file_mapping={"tenant_id": tenant_id},
            tenant_resolver=lambda: "app-tenant",
        )
        == "app-tenant"
    )
