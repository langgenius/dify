import pytest

from core.workflow.file_reference import build_file_reference
from models.agent_config_entities import (
    DeclaredArrayItem,
    DeclaredOutputChildConfig,
    DeclaredOutputConfig,
    DeclaredOutputType,
)


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


def test_declared_array_item_rejects_nested_arrays_and_non_object_children() -> None:
    with pytest.raises(ValueError, match="nested arrays"):
        DeclaredArrayItem(type=DeclaredOutputType.ARRAY)

    with pytest.raises(ValueError, match="array_item.children"):
        DeclaredArrayItem(
            type=DeclaredOutputType.STRING,
            children=[DeclaredOutputChildConfig(name="label", type=DeclaredOutputType.STRING)],
        )


def test_declared_output_child_validates_shape_and_defaults() -> None:
    file_child = DeclaredOutputChildConfig(name="report", type=DeclaredOutputType.FILE)
    assert file_child.file is not None

    array_child = DeclaredOutputChildConfig(name="items", type=DeclaredOutputType.ARRAY)
    assert array_child.array_item is not None
    assert array_child.array_item.type == DeclaredOutputType.OBJECT

    with pytest.raises(ValueError, match="output child name"):
        DeclaredOutputChildConfig(name="bad-name", type=DeclaredOutputType.STRING)

    with pytest.raises(ValueError, match="file metadata"):
        DeclaredOutputChildConfig(name="title", type=DeclaredOutputType.STRING, file={})

    with pytest.raises(ValueError, match="array_item is only allowed"):
        DeclaredOutputChildConfig(
            name="title",
            type=DeclaredOutputType.STRING,
            array_item={"type": DeclaredOutputType.STRING},
        )

    with pytest.raises(ValueError, match="children is only allowed"):
        DeclaredOutputChildConfig(
            name="title",
            type=DeclaredOutputType.STRING,
            children=[DeclaredOutputChildConfig(name="label", type=DeclaredOutputType.STRING)],
        )


def test_declared_output_validates_shape_and_defaults() -> None:
    file_output = DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE)
    assert file_output.file is not None

    array_output = DeclaredOutputConfig(name="items", type=DeclaredOutputType.ARRAY)
    assert array_output.array_item is not None
    assert array_output.array_item.type == DeclaredOutputType.OBJECT

    default_failure_strategy = DeclaredOutputConfig.model_validate(
        {"name": "summary", "type": "string", "failure_strategy": None}
    )
    assert default_failure_strategy.failure_strategy.on_failure == "stop"

    with pytest.raises(ValueError, match="output name"):
        DeclaredOutputConfig(name="bad-name", type=DeclaredOutputType.STRING)

    with pytest.raises(ValueError, match="file metadata"):
        DeclaredOutputConfig(name="summary", type=DeclaredOutputType.STRING, file={})

    with pytest.raises(ValueError, match="array_item is only allowed"):
        DeclaredOutputConfig(
            name="summary",
            type=DeclaredOutputType.STRING,
            array_item={"type": DeclaredOutputType.STRING},
        )

    with pytest.raises(ValueError, match="children is only allowed"):
        DeclaredOutputConfig(
            name="summary",
            type=DeclaredOutputType.STRING,
            children=[DeclaredOutputChildConfig(name="title", type=DeclaredOutputType.STRING)],
        )

    with pytest.raises(ValueError, match="output check is only allowed"):
        DeclaredOutputConfig.model_validate(
            {
                "name": "summary",
                "type": "string",
                "check": {
                    "enabled": True,
                    "prompt": "Compare output",
                    "benchmark_file_ref": {"name": "expected.pdf"},
                },
            }
        )
