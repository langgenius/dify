import pytest

from core.workflow.file_reference import build_file_reference
from models.agent_config_entities import DeclaredOutputConfig, DeclaredOutputType


def test_file_default_value_accepts_canonical_reference_mapping() -> None:
    reference = build_file_reference(record_id="tool-file-1")

    config = DeclaredOutputConfig.model_validate(
        {
            "name": "report",
            "type": "file",
            "failure_strategy": {
                "on_failure": "default_value",
                "default_value": {
                    "transfer_method": "tool_file",
                    "reference": reference,
                },
            },
        }
    )

    assert config.type == DeclaredOutputType.FILE


def test_file_default_value_rejects_legacy_file_id_shape() -> None:
    with pytest.raises(ValueError, match="default_value shape"):
        _ = DeclaredOutputConfig.model_validate(
            {
                "name": "report",
                "type": "file",
                "failure_strategy": {
                    "on_failure": "default_value",
                    "default_value": {
                        "file_id": "legacy-file-id",
                    },
                },
            }
        )


def test_file_default_value_rejects_non_canonical_reference() -> None:
    with pytest.raises(ValueError, match="default_value shape"):
        _ = DeclaredOutputConfig.model_validate(
            {
                "name": "report",
                "type": "file",
                "failure_strategy": {
                    "on_failure": "default_value",
                    "default_value": {
                        "transfer_method": "tool_file",
                        "reference": "raw-tool-file-uuid",
                    },
                },
            }
        )


def test_array_file_default_value_accepts_canonical_mappings() -> None:
    first_reference = build_file_reference(record_id="tool-file-1")
    second_reference = build_file_reference(record_id="tool-file-2")

    config = DeclaredOutputConfig.model_validate(
        {
            "name": "reports",
            "type": "array",
            "array_item": {"type": "file"},
            "failure_strategy": {
                "on_failure": "default_value",
                "default_value": [
                    {"transfer_method": "tool_file", "reference": first_reference},
                    {"transfer_method": "tool_file", "reference": second_reference},
                ],
            },
        }
    )

    assert config.type == DeclaredOutputType.ARRAY


def test_array_file_default_value_rejects_legacy_item_shape() -> None:
    with pytest.raises(ValueError, match="default_value shape"):
        _ = DeclaredOutputConfig.model_validate(
            {
                "name": "reports",
                "type": "array",
                "array_item": {"type": "file"},
                "failure_strategy": {
                    "on_failure": "default_value",
                    "default_value": [{"file_id": "legacy-file-id"}],
                },
            }
        )
