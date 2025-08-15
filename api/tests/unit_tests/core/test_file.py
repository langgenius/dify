import json

from core.file import FILE_MODEL_IDENTITY, File, FileTransferMethod, FileType, FileUploadConfig
from models.workflow import Workflow


def test_file_to_dict():
    file = File(
        id="file1",
        tenant_id="tenant1",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/image1.jpg",
        storage_key="storage_key",
    )

    file_dict = file.to_dict()
    assert "_storage_key" not in file_dict
    assert "url" in file_dict

    # Test JSON serialization fix for GitHub Issue #23905
    assert "dify_model_identity" in file_dict
    assert file_dict["dify_model_identity"] == FILE_MODEL_IDENTITY

    # Test enum values are converted to strings
    assert isinstance(file_dict["type"], str)
    assert file_dict["type"] == "image"
    assert isinstance(file_dict["transfer_method"], str)
    assert file_dict["transfer_method"] == "remote_url"

    # Test full JSON serialization works without errors
    json_str = json.dumps(file_dict)
    deserialized = json.loads(json_str)
    assert deserialized["id"] == "file1"
    assert deserialized["type"] == "image"


def test_workflow_features_with_image():
    # Create a feature dict that mimics the old structure with image config
    features = {
        "file_upload": {
            "image": {"enabled": True, "number_limits": 5, "transfer_methods": ["remote_url", "local_file"]}
        }
    }

    # Create a workflow instance with the features
    workflow = Workflow(
        tenant_id="tenant-1",
        app_id="app-1",
        type="chat",
        version="1.0",
        graph="{}",
        features=json.dumps(features),
        created_by="user-1",
        environment_variables=[],
        conversation_variables=[],
    )

    # Get the converted features through the property
    converted_features = json.loads(workflow.features)

    # Create FileUploadConfig from the converted features
    file_upload_config = FileUploadConfig.model_validate(converted_features["file_upload"])

    # Validate the config
    assert file_upload_config.number_limits == 5
    assert list(file_upload_config.allowed_file_types) == [FileType.IMAGE]
    assert list(file_upload_config.allowed_file_upload_methods) == [
        FileTransferMethod.REMOTE_URL,
        FileTransferMethod.LOCAL_FILE,
    ]
    assert list(file_upload_config.allowed_file_extensions) == []


def test_file_enum_serialization_fix():
    """Test that File enum serialization fix works for all enum types (Issue #23905)"""
    # Test different file types with appropriate transfer methods and required fields
    test_cases = [
        {
            "type": FileType.DOCUMENT,
            "transfer_method": FileTransferMethod.LOCAL_FILE,
            "related_id": "local-file-123",
            "remote_url": None
        },
        {
            "type": FileType.AUDIO,
            "transfer_method": FileTransferMethod.TOOL_FILE,
            "related_id": "tool-file-456",
            "remote_url": None,
            "extension": ".mp3"  # TOOL_FILE requires extension
        },
        {
            "type": FileType.VIDEO,
            "transfer_method": FileTransferMethod.REMOTE_URL,
            "related_id": None,
            "remote_url": "https://example.com/video.mp4"
        },
    ]

    for case in test_cases:
        file = File(
            id=f"test-{case['type'].value}",
            tenant_id="test-tenant",
            type=case["type"],
            transfer_method=case["transfer_method"],
            remote_url=case["remote_url"],
            related_id=case["related_id"],
            extension=case.get("extension"),  # Add extension if provided
            storage_key="test-storage"
        )

        file_dict = file.to_dict()

        # Verify enum conversion to strings
        assert file_dict["type"] == case["type"].value
        assert file_dict["transfer_method"] == case["transfer_method"].value
        assert isinstance(file_dict["type"], str)
        assert isinstance(file_dict["transfer_method"], str)

        # Verify JSON serialization works
        json_str = json.dumps(file_dict)
        deserialized = json.loads(json_str)
        assert deserialized["type"] == case["type"].value
        assert deserialized["transfer_method"] == case["transfer_method"].value
